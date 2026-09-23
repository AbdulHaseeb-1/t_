import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import OpenAI, { APIConnectionError, APIError } from 'openai';
import type { ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat/completions';
import { AppConfig } from '../config/app-config.js';
import type { ProviderMode, ProviderName } from '../config/env.js';
import { LlmUnavailableError } from '../common/errors.js';
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

/** Upstream failures worth failing over for; anything else is our bug or bad input. */
function isFailoverError(err: unknown): boolean {
  if (err instanceof APIConnectionError) return true; // includes timeouts
  if (err instanceof APIError) {
    const s = err.status ?? 0;
    return s === 401 || s === 402 || s === 403 || s === 404 || s === 408 || s === 429 || s >= 500;
  }
  return false;
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
  private mode: ProviderMode;
  private order: ProviderName[];

  constructor(
    private readonly config: AppConfig,
    private readonly pricing: ModelPricingService,
  ) {
    const common = { timeout: config.get('LLM_TIMEOUT_MS'), maxRetries: 1 };
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
        if (!isFailoverError(err)) throw err;
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
    const model = p.models[req.tier];
    const maxTokens = req.maxTokens ?? this.config.get('LLM_MAX_OUTPUT_TOKENS');
    const effort = p.reasoning[req.tier];

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
            res.model ?? model,
            promptTokens,
            cachedPromptTokens,
            completionTokens,
          );

    const usage: CallUsage = {
      provider: p.name,
      model: res.model ?? model,
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
