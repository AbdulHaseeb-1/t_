import { Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../config/app-config.js';
import type { ProviderName } from '../config/env.js';

interface Price {
  prompt: number;
  completion: number;
  cacheRead?: number;
}

interface CatalogModel {
  id: string;
  pricing?: { prompt?: string; completion?: string; input_cache_read?: string };
}

const REFRESH_MS = 24 * 60 * 60 * 1000;

/**
 * USD-per-token prices from OpenRouter's public model catalog (no key needed).
 * Used to estimate OpenAI-direct spend; OpenRouter responses carry exact cost.
 */
@Injectable()
export class ModelPricingService {
  private readonly logger = new Logger(ModelPricingService.name);
  private prices = new Map<string, Price>();
  private loadedAt = 0;
  private inflight?: Promise<void>;

  constructor(private readonly config: AppConfig) {}

  async estimate(
    provider: ProviderName,
    model: string,
    promptTokens: number,
    cachedPromptTokens: number,
    completionTokens: number,
  ): Promise<number | undefined> {
    await this.ensureLoaded();
    const id = provider === 'openai' ? `openai/${model}` : model;
    // gpt-4.1-mini-2025-04-14 is priced as its alias gpt-4.1-mini.
    const price = this.prices.get(id) ?? this.prices.get(id.replace(/-\d{4}-\d{2}-\d{2}$/, ''));
    if (!price) return undefined;
    const cacheRead = price.cacheRead ?? price.prompt;
    return (
      (promptTokens - cachedPromptTokens) * price.prompt +
      cachedPromptTokens * cacheRead +
      completionTokens * price.completion
    );
  }

  private ensureLoaded(): Promise<void> {
    if (Date.now() - this.loadedAt < REFRESH_MS) return Promise.resolve();
    this.inflight ??= this.load().finally(() => (this.inflight = undefined));
    return this.inflight;
  }

  private async load(): Promise<void> {
    // Mark as loaded up front so a failing catalog is retried daily, not per request.
    this.loadedAt = Date.now();
    try {
      const res = await fetch(`${this.config.get('OPENROUTER_BASE_URL')}/models`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { data: CatalogModel[] };
      const next = new Map<string, Price>();
      for (const m of body.data) {
        const prompt = Number(m.pricing?.prompt);
        const completion = Number(m.pricing?.completion);
        if (!Number.isFinite(prompt) || !Number.isFinite(completion)) continue;
        const cacheRead = Number(m.pricing?.input_cache_read);
        next.set(m.id, {
          prompt,
          completion,
          cacheRead: Number.isFinite(cacheRead) && m.pricing?.input_cache_read ? cacheRead : undefined,
        });
      }
      this.prices = next;
      this.logger.log(`Loaded prices for ${next.size} models`);
    } catch (err) {
      this.logger.warn(`Model price catalog unavailable: ${(err as Error).message}`);
    }
  }
}
