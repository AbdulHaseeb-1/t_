import type {
  ChatCompletionMessage,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';
import type { ProviderName } from '../config/env.js';

/** `fast` = cheap default for SQL generation and summaries; `smart` = escalation only. */
export type Tier = 'fast' | 'smart';

export interface ChatRequest {
  tier: Tier;
  messages: ChatCompletionMessageParam[];
  tools?: ChatCompletionTool[];
  maxTokens?: number;
  temperature?: number;
  /** Routes requests sharing a prompt prefix to the same cache shard (OpenAI). */
  cacheKey?: string;
}

export interface CallUsage {
  provider: ProviderName;
  model: string;
  promptTokens: number;
  cachedPromptTokens: number;
  completionTokens: number;
  /** USD; undefined when the price is unknown. */
  costUsd?: number;
  latencyMs: number;
}

export interface ChatResult {
  message: ChatCompletionMessage;
  usage: CallUsage;
}

/** Aggregates LLM spend for one API request so callers can report it. */
export class UsageMeter {
  readonly calls: CallUsage[] = [];

  add(u: CallUsage): void {
    this.calls.push(u);
  }

  summary() {
    let promptTokens = 0;
    let cachedPromptTokens = 0;
    let completionTokens = 0;
    let costUsd: number | undefined = 0;
    for (const c of this.calls) {
      promptTokens += c.promptTokens;
      cachedPromptTokens += c.cachedPromptTokens;
      completionTokens += c.completionTokens;
      costUsd = c.costUsd === undefined || costUsd === undefined ? undefined : costUsd + c.costUsd;
    }
    return {
      llmCalls: this.calls.length,
      promptTokens,
      cachedPromptTokens,
      completionTokens,
      costUsd: costUsd === undefined ? undefined : Number(costUsd.toFixed(6)),
      models: [...new Set(this.calls.map((c) => `${c.provider}:${c.model}`))],
    };
  }
}

export type UsageSummary = ReturnType<UsageMeter['summary']>;
