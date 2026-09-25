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
  /** Overrides the tier's configured reasoning effort for this call. */
  reasoningEffort?: string;
  /** What the call was for; reported per call to clients. */
  purpose?: CallPurpose;
}

export type CallPurpose = 'sql' | 'answer' | 'recheck' | 'translate' | 'transcribe' | 'vision' | 'agent';

export interface CallUsage {
  provider: ProviderName | 'gemini';
  model: string;
  purpose?: CallPurpose;
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
    let costUsd = 0;
    let costComplete = true;
    for (const c of this.calls) {
      promptTokens += c.promptTokens;
      cachedPromptTokens += c.cachedPromptTokens;
      completionTokens += c.completionTokens;
      if (c.costUsd === undefined) costComplete = false;
      else costUsd += c.costUsd;
    }
    return {
      llmCalls: this.calls.length,
      promptTokens,
      cachedPromptTokens,
      completionTokens,
      /** Sum of known prices; see costComplete. */
      costUsd: Number(costUsd.toFixed(6)),
      /** False when some call (e.g. transcription) had no known price. */
      costComplete,
      models: [...new Set(this.calls.map((c) => `${c.provider}:${c.model}`))],
      /** Per-call breakdown, in call order. */
      calls: this.calls.map((c) => ({
        purpose: c.purpose ?? 'sql',
        model: `${c.provider}:${c.model}`,
        promptTokens: c.promptTokens,
        cachedPromptTokens: c.cachedPromptTokens,
        completionTokens: c.completionTokens,
        latencyMs: c.latencyMs,
        ...(c.costUsd !== undefined ? { costUsd: c.costUsd } : {}),
      })),
    };
  }
}

export type UsageSummary = ReturnType<UsageMeter['summary']>;
