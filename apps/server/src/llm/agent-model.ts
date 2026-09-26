import type { Model, ModelRequest, ModelResponse, ModelSettings, StreamEvent } from '@openai/agents';
import { APIUserAbortError } from 'openai';
import type { ProviderName } from '../config/env.js';

/** One provider + model the agent can call, through the SDK adapter that fits its API. */
export interface AgentRoute {
  provider: ProviderName;
  model: string;
  adapter: Model;
  /** Provider settings (reasoning, output cap, caching); they win over the agent's own. */
  settings: ModelSettings;
}

/** Token counts for one model call, as the SDK reports them. */
export interface TurnUsage {
  promptTokens: number;
  cachedPromptTokens: number;
  completionTokens: number;
  /** Exact price when the provider reports it (OpenRouter). */
  costUsd?: number;
}

export interface AgentRouteHooks {
  /** Request as this route should receive it: its settings, minus parameters the model rejected. */
  prepare(route: AgentRoute, request: ModelRequest): ModelRequest;
  /** True when the error taught us a parameter to drop, so the same route is retried. */
  learn(route: AgentRoute, err: unknown, withTools: boolean): boolean;
  succeeded(route: AgentRoute, usage: TurnUsage, latencyMs: number): Promise<void>;
  /** Records the failure; true when the next route should be tried. */
  failed(route: AgentRoute, err: unknown): boolean;
  /** Records a failure after output was streamed (too late to switch routes, but it still counts against the provider). */
  interrupted(route: AgentRoute, err: unknown): void;
  /** The error to surface when no route can answer. */
  toError(err: unknown, route: AgentRoute | undefined, exhausted: boolean): Error;
}

/** Enough to learn every droppable parameter once and still stop. */
const MAX_ATTEMPTS_PER_ROUTE = 8;

function isAbort(err: unknown, signal?: AbortSignal): boolean {
  return !!signal?.aborted || err instanceof APIUserAbortError || (err as Error)?.name === 'AbortError';
}

function sum(details: unknown, key: string): number {
  const list = Array.isArray(details) ? details : [details];
  return list.reduce<number>((n, d) => n + (Number((d as Record<string, unknown> | undefined)?.[key]) || 0), 0);
}

export function turnUsage(
  usage: { inputTokens?: number; outputTokens?: number; inputTokensDetails?: unknown } | undefined,
  raw?: Record<string, unknown>,
): TurnUsage {
  return {
    promptTokens: usage?.inputTokens ?? 0,
    cachedPromptTokens: sum(usage?.inputTokensDetails, 'cached_tokens'),
    completionTokens: usage?.outputTokens ?? 0,
    ...(typeof raw?.cost === 'number' ? { costUsd: raw.cost } : {}),
  };
}

/**
 * An Agents SDK model that walks provider routes in order. A route that fails
 * before producing output hands over to the next one; once a streamed answer
 * has started, errors surface (replaying it elsewhere would duplicate text).
 */
export class FailoverAgentModel implements Model {
  constructor(
    private readonly routes: AgentRoute[],
    private readonly hooks: AgentRouteHooks,
  ) {}

  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    let lastError: unknown;
    let lastRoute: AgentRoute | undefined;
    for (const route of this.routes) {
      lastRoute = route;
      for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_ROUTE; attempt++) {
        const started = performance.now();
        try {
          const res = await route.adapter.getResponse(this.hooks.prepare(route, request));
          await this.hooks.succeeded(route, turnUsage(res.usage, res.rawUsage), Math.round(performance.now() - started));
          return res;
        } catch (err) {
          if (isAbort(err, request.signal)) throw err;
          if (attempt < MAX_ATTEMPTS_PER_ROUTE - 1 && this.hooks.learn(route, err, request.tools.length > 0)) continue;
          lastError = err;
          if (!this.hooks.failed(route, err)) throw this.hooks.toError(err, route, false);
          break;
        }
      }
    }
    throw this.hooks.toError(lastError, lastRoute, true);
  }

  async *getStreamedResponse(request: ModelRequest): AsyncIterable<StreamEvent> {
    let lastError: unknown;
    let lastRoute: AgentRoute | undefined;
    for (const route of this.routes) {
      lastRoute = route;
      for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_ROUTE; attempt++) {
        const started = performance.now();
        let emitted = false;
        try {
          for await (const event of route.adapter.getStreamedResponse(this.hooks.prepare(route, request))) {
            if (event.type === 'response_done') {
              const r = event.response as { usage?: Parameters<typeof turnUsage>[0]; rawUsage?: Record<string, unknown> };
              await this.hooks.succeeded(route, turnUsage(r.usage, r.rawUsage), Math.round(performance.now() - started));
            }
            emitted = true;
            yield event;
          }
          return;
        } catch (err) {
          if (isAbort(err, request.signal)) throw err;
          if (emitted) {
            this.hooks.interrupted(route, err);
            throw err;
          }
          if (attempt < MAX_ATTEMPTS_PER_ROUTE - 1 && this.hooks.learn(route, err, request.tools.length > 0)) continue;
          lastError = err;
          if (!this.hooks.failed(route, err)) throw this.hooks.toError(err, route, false);
          break;
        }
      }
    }
    throw this.hooks.toError(lastError, lastRoute, true);
  }
}

/**
 * Removes parameters a model rejected, using the request body's names
 * (`reasoning_effort`, `prompt_cache_key`...) as the API reported them.
 */
export function withoutParams(settings: ModelSettings, drop: Iterable<string>): ModelSettings {
  const s: ModelSettings = { ...settings, providerData: { ...settings.providerData } };
  const data = s.providerData!;
  for (const p of drop) {
    switch (p) {
      case 'reasoning':
      case 'reasoning_effort':
        delete s.reasoning;
        delete data.reasoning;
        delete data.reasoning_effort;
        break;
      case 'temperature':
        delete s.temperature;
        break;
      case 'parallel_tool_calls':
        delete s.parallelToolCalls;
        break;
      case 'store':
        delete s.store;
        break;
      case 'max_tokens':
      case 'max_output_tokens':
      case 'max_completion_tokens':
        delete s.maxTokens;
        break;
      default:
        delete data[p];
    }
  }
  return s;
}
