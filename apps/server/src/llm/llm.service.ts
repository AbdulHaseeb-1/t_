import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import OpenAI, { APIConnectionError, APIError } from 'openai';
import type { ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat/completions';
import { AppConfig } from '../config/app-config.js';
import type { ProviderMode, ProviderName } from '../config/env.js';
import { LlmRequestError, LlmUnavailableError } from '../common/errors.js';
import { CircuitBreaker } from './circuit-breaker.js';
import { ModelPricingService } from './model-pricing.service.js';
import type { CallUsage, ChatRequest, ChatResult, Tier, UsageMeter } from './llm.types.js';

interface Provider {
  name: ProviderName;
  client: OpenAI;
  models: Record<Tier, string>;
  reasoning: Partial<Record<Tier, string>>;
  breaker: CircuitBreaker;
}

export interface ProviderStats {
  calls: number;
  failures: number;
  promptTokens: number;
  cachedPromptTokens: number;
  completionTokens: number;
  costUsd: number;
}

/** Optional parameters we can drop when a model rejects them (e.g. temperature on reasoning models). */
const DROPPABLE_PARAMS = new Set([
  'temperature',
  'reasoning_effort',
  'reasoning',
  'prompt_cache_key',
  'provider',
]);

/** Returns the rejected optional parameter, if the error is an "unsupported parameter/value" 400. */
export function rejectedParam(err: unknown): string | undefined {
  if (!(err instanceof APIError) || err.status !== 400) return undefined;
  // OpenAI phrases it several ways: param field set, 'quoted' name, or "Unrecognized request argument supplied: reasoning_effort".
  const candidate = err.param ?? /'(\w+)'/.exec(err.message)?.[1] ?? /argument supplied:\s*(\w+)/i.exec(err.message)?.[1];
  if (!candidate || !DROPPABLE_PARAMS.has(candidate)) return undefined;
  return /unsupported|not supported|does not support|unrecognized|unknown/i.test(err.message)
    ? candidate
    : undefined;
}

/** Some reasoning models accept tools on Chat Completions only with reasoning disabled. */
export function toolsNeedNoReasoning(err: unknown): boolean {
  return (
    err instanceof APIError &&
    err.status === 400 &&
    /tools?/i.test(err.message) &&
    /reasoning_effort/i.test(err.message) &&
    /'none'/.test(err.message)
  );
}

/** Upstream failures worth failing over for; anything else is our bug or bad input. */
function isFailoverError(err: unknown): boolean {
  if (err instanceof APIConnectionError) return true; // includes timeouts
  if (err instanceof APIError) {
    const s = err.status ?? 0;
    return s === 401 || s === 402 || s === 403 || s === 404 || s === 408 || s === 429 || s >= 500;
  }
  return false;
}

const REASONING_HEADROOM: Record<string, number> = { none: 0, minimal: 1_000, low: 2_000, medium: 6_000, high: 16_000 };

/** Extra output tokens a reasoning effort may consume before the visible answer. Unset = model default (~medium). */
export function reasoningHeadroom(effort: string | undefined): number {
  return REASONING_HEADROOM[effort ?? 'medium'] ?? REASONING_HEADROOM.medium;
}

/**
 * One OpenAI-compatible code path for OpenAI and OpenRouter. The mode is
 * switchable at runtime; `auto` walks the fallback order, skipping providers
 * whose circuit breaker is open.
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly providers = new Map<ProviderName, Provider>();
  private readonly stats = new Map<ProviderName, ProviderStats>();
  /** `provider:model` -> parameters that model rejected; learned at runtime, never re-sent. */
  private readonly unsupported = new Map<string, Set<string>>();
  /** `provider:model` keys that require `reasoning_effort: 'none'` when tools are sent. */
  private readonly noReasoningWithTools = new Set<string>();
  private mode: ProviderMode;
  private order: ProviderName[];

  constructor(
    private readonly config: AppConfig,
    private readonly pricing: ModelPricingService,
  ) {
    const hasFallback =
      config.get('LLM_PROVIDER') === 'auto' &&
      !!config.get('OPENAI_API_KEY') &&
      !!config.get('OPENROUTER_API_KEY');
    // With a fallback, fail over fast; without one, wait out rate limits (the SDK honours retry-after).
    const common = {
      timeout: config.get('LLM_TIMEOUT_MS'),
      maxRetries: hasFallback ? 1 : config.get('LLM_MAX_RETRIES'),
    };
    const breaker = () =>
      new CircuitBreaker(config.get('LLM_BREAKER_THRESHOLD'), config.get('LLM_BREAKER_COOLDOWN_MS'));
    const reasoning = {
      fast: config.get('LLM_REASONING_EFFORT_FAST'),
      smart: config.get('LLM_REASONING_EFFORT_SMART'),
    };

    const openaiKey = config.get('OPENAI_API_KEY');
    if (openaiKey) {
      this.providers.set('openai', {
        name: 'openai',
        client: new OpenAI({ ...common, apiKey: openaiKey, baseURL: config.get('OPENAI_BASE_URL') }),
        models: { fast: config.get('OPENAI_MODEL_FAST'), smart: config.get('OPENAI_MODEL_SMART') },
        reasoning,
        breaker: breaker(),
      });
    }
    const openrouterKey = config.get('OPENROUTER_API_KEY');
    if (openrouterKey) {
      this.providers.set('openrouter', {
        name: 'openrouter',
        client: new OpenAI({
          ...common,
          apiKey: openrouterKey,
          baseURL: config.get('OPENROUTER_BASE_URL'),
          defaultHeaders: { 'X-Title': config.get('OPENROUTER_APP_NAME') },
        }),
        models: {
          fast: config.get('OPENROUTER_MODEL_FAST'),
          smart: config.get('OPENROUTER_MODEL_SMART'),
        },
        reasoning,
        breaker: breaker(),
      });
    }

    this.mode = config.get('LLM_PROVIDER');
    this.order = config.get('LLM_FALLBACK_ORDER');
    if (this.providers.size === 0) {
      this.logger.warn('No LLM API key configured: /query/ask is disabled, /query/sql still works');
    }
  }

  get configured(): boolean {
    return this.providers.size > 0;
  }

  getState() {
    return {
      mode: this.mode,
      fallbackOrder: this.order,
      providers: [...this.providers.values()].map((p) => ({
        name: p.name,
        models: p.models,
        breaker: p.breaker.state(),
        stats: this.stats.get(p.name) ?? null,
      })),
    };
  }

  setMode(mode: ProviderMode, order?: ProviderName[]): void {
    if (mode !== 'auto' && !this.providers.has(mode)) {
      throw new BadRequestException(`Provider "${mode}" has no API key configured`);
    }
    this.mode = mode;
    if (order?.length) this.order = order;
    this.logger.log(`LLM mode -> ${mode} (order: ${this.order.join(' > ')})`);
  }

  async chat(req: ChatRequest, meter?: UsageMeter): Promise<ChatResult> {
    const candidates = this.candidates();
    if (candidates.length === 0) {
      throw new LlmUnavailableError(
        'No LLM provider configured. Set OPENAI_API_KEY and/or OPENROUTER_API_KEY.',
      );
    }

    let lastError: unknown;
    for (const provider of candidates) {
      try {
        const result = await this.call(provider, req);
        provider.breaker.success();
        meter?.add(result.usage);
        return result;
      } catch (err) {
        lastError = err;
        this.bump(provider.name, { failures: 1 });
        if (!isFailoverError(err)) {
          if (err instanceof APIError) throw new LlmRequestError(provider.name, err.message);
          throw err;
        }
        provider.breaker.failure();
        this.logger.warn(`${provider.name} failed (${(err as Error).message}); trying next provider`);
      }
    }
    throw new LlmUnavailableError(`All LLM providers failed: ${(lastError as Error)?.message ?? 'unknown'}`);
  }

  private candidates(): Provider[] {
    if (this.mode !== 'auto') {
      const p = this.providers.get(this.mode);
      return p ? [p] : [];
    }
    const ordered = [...this.order, ...[...this.providers.keys()].filter((n) => !this.order.includes(n))]
      .map((n) => this.providers.get(n))
      .filter((p): p is Provider => !!p);
    const healthy = ordered.filter((p) => !p.breaker.isOpen);
    // If every breaker is open, still try them: failing fast beats refusing outright.
    return healthy.length ? healthy : ordered;
  }

  private async call(p: Provider, req: ChatRequest): Promise<ChatResult> {
    const key = `${p.name}:${p.models[req.tier]}`;
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.send(p, req);
      } catch (err) {
        // A parallel call may have learned the fix while this one was in flight: retry either way.
        // The next attempt omits what was learned, so the same error cannot repeat forever.
        if (attempt >= DROPPABLE_PARAMS.size) throw err;
        if (req.tools?.length && toolsNeedNoReasoning(err)) {
          if (!this.noReasoningWithTools.has(key)) {
            this.noReasoningWithTools.add(key);
            this.logger.warn(`${key} needs reasoning_effort=none with tools; applying from now on`);
          }
          continue;
        }
        const param = rejectedParam(err);
        if (!param) throw err;
        const known = this.unsupported.get(key) ?? new Set<string>();
        if (!known.has(param)) {
          known.add(param);
          this.unsupported.set(key, known);
          this.logger.warn(`${key} rejects "${param}"; omitting it from now on`);
        }
      }
    }
  }

  private async send(p: Provider, req: ChatRequest): Promise<ChatResult> {
    const model = p.models[req.tier];
    const effort = req.reasoningEffort ?? p.reasoning[req.tier];
    // Reasoning tokens count against the output cap. Without headroom a hard
    // question spends the whole budget thinking and returns empty content.
    const maxTokens =
      (req.maxTokens ?? this.config.get('LLM_MAX_OUTPUT_TOKENS')) + reasoningHeadroom(effort);

    const body: ChatCompletionCreateParamsNonStreaming & Record<string, unknown> = {
      model,
      messages: req.messages,
      ...(req.tools?.length ? { tools: req.tools, tool_choice: 'auto' as const } : {}),
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    };
    if (p.name === 'openai') {
      body.max_completion_tokens = maxTokens;
      if (req.cacheKey) body.prompt_cache_key = req.cacheKey;
      if (effort)
        body.reasoning_effort = effort as ChatCompletionCreateParamsNonStreaming['reasoning_effort'];
    } else {
      body.max_tokens = maxTokens;
      body.usage = { include: true }; // exact per-call cost in the response
      const sort = this.config.get('OPENROUTER_PROVIDER_SORT');
      if (sort) body.provider = { sort };
      if (effort) body.reasoning = { effort };
    }

    const key = `${p.name}:${model}`;
    if (req.tools?.length && this.noReasoningWithTools.has(key)) body.reasoning_effort = 'none';
    for (const param of this.unsupported.get(key) ?? []) delete body[param];

    const started = performance.now();
    const res = await p.client.chat.completions.create(body);
    const latencyMs = Math.round(performance.now() - started);

    const choice = res.choices[0];
    if (!choice) throw new APIError(502, undefined, 'Provider returned no choices', undefined);

    const u = res.usage as (NonNullable<typeof res.usage> & { cost?: number }) | undefined;
    const promptTokens = u?.prompt_tokens ?? 0;
    const cachedPromptTokens = u?.prompt_tokens_details?.cached_tokens ?? 0;
    const completionTokens = u?.completion_tokens ?? 0;
    const costUsd =
      typeof u?.cost === 'number'
        ? u.cost
        : await this.pricing.estimate(
            p.name,
            // Priced by the model we asked for: the response may name a dated snapshot the catalog lacks.
            model,
            promptTokens,
            cachedPromptTokens,
            completionTokens,
          );

    const usage: CallUsage = {
      provider: p.name,
      model: res.model ?? model,
      purpose: req.purpose,
      promptTokens,
      cachedPromptTokens,
      completionTokens,
      costUsd,
      latencyMs,
    };
    this.bump(p.name, {
      calls: 1,
      promptTokens,
      cachedPromptTokens,
      completionTokens,
      costUsd: costUsd ?? 0,
    });
    this.logger.debug(usage);
    return { message: choice.message, usage };
  }

  private bump(name: ProviderName, delta: Partial<ProviderStats>): void {
    const s = this.stats.get(name) ?? {
      calls: 0,
      failures: 0,
      promptTokens: 0,
      cachedPromptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
    };
    for (const [k, v] of Object.entries(delta) as [keyof ProviderStats, number][]) s[k] += v;
    this.stats.set(name, s);
  }
}
