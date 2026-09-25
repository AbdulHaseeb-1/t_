import { Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../config/app-config.js';
import type { ProviderName } from '../config/env.js';

export interface ModelInfo {
  /** Model id as the provider expects it (gpt-6-luna, deepseek/deepseek-v4-flash). */
  id: string;
  provider: ProviderName;
  name: string;
  /** A key for this provider is configured, so the model can be benchmarked. */
  available: boolean;
  /** USD per million tokens. */
  promptPerM?: number;
  completionPerM?: number;
  cachedPerM?: number;
  contextLength?: number;
  /** Accepts a reasoning-effort setting. */
  reasoning?: boolean;
  /** The server currently uses this model for the fast or smart tier. */
  current?: 'fast' | 'smart';
}

export interface ModelCatalog {
  models: ModelInfo[];
  errors: string[];
  loadedAt: string;
}

interface OpenRouterModel {
  id: string;
  name?: string;
  context_length?: number;
  supported_parameters?: string[];
  architecture?: { output_modalities?: string[] };
  pricing?: { prompt?: string; completion?: string; input_cache_read?: string };
}

const TTL_MS = 60 * 60 * 1000;
/** OpenAI ids that are not chat-completion text models. */
const OPENAI_NON_CHAT = /audio|realtime|transcribe|tts|image|search|embedding|moderation|dall-e|whisper|babbage|davinci|instruct|computer-use/i;

const DATED = /-(\d{4}-\d{2}-\d{2}|\d{4})$/;

const perM = (v?: string) => {
  const n = Number(v);
  return v !== undefined && Number.isFinite(n) && n >= 0 ? Math.round(n * 1e6 * 1e4) / 1e4 : undefined;
};

/**
 * Models that can be benchmarked: the OpenAI account's chat models (when a key
 * is set) and OpenRouter's public catalog, with prices from that catalog.
 */
@Injectable()
export class ModelsService {
  private readonly logger = new Logger(ModelsService.name);
  private cache?: { at: number; value: ModelCatalog };
  private inflight?: Promise<ModelCatalog>;

  constructor(private readonly config: AppConfig) {}

  list(refresh = false): Promise<ModelCatalog> {
    if (!refresh && this.cache && Date.now() - this.cache.at < TTL_MS) return Promise.resolve(this.cache.value);
    this.inflight ??= this.load().finally(() => (this.inflight = undefined));
    return this.inflight;
  }

  private async load(): Promise<ModelCatalog> {
    const errors: string[] = [];
    const [router, openai] = await Promise.all([
      this.openRouterCatalog().catch((err: Error) => {
        errors.push(`OpenRouter catalog: ${err.message}`);
        return [] as OpenRouterModel[];
      }),
      this.openAiModels().catch((err: Error) => {
        errors.push(`OpenAI models: ${err.message}`);
        return [] as string[];
      }),
    ]);
    const hasOpenAi = !!this.config.get('OPENAI_API_KEY');
    const hasRouter = !!this.config.get('OPENROUTER_API_KEY');
    const byId = new Map(router.map((m) => [m.id, m]));
    const tier = (provider: ProviderName, id: string): ModelInfo['current'] => {
      const p = provider === 'openai' ? 'OPENAI' : 'OPENROUTER';
      if (this.config.get(`${p}_MODEL_FAST`) === id) return 'fast';
      if (this.config.get(`${p}_MODEL_SMART`) === id) return 'smart';
      return undefined;
    };
    const fromRouter = (m: OpenRouterModel, provider: ProviderName, id: string, available: boolean): ModelInfo => ({
      id,
      provider,
      name: m.name ?? id,
      available,
      promptPerM: perM(m.pricing?.prompt),
      completionPerM: perM(m.pricing?.completion),
      cachedPerM: m.pricing?.input_cache_read ? perM(m.pricing.input_cache_read) : undefined,
      contextLength: m.context_length,
      reasoning: m.supported_parameters?.includes('reasoning'),
      current: tier(provider, id),
    });

    const models: ModelInfo[] = [];
    // OpenAI direct: the account's own list (what the key can actually call), priced from the catalog.
    const chat = openai.filter((id) => /^(gpt-|o\d|chatgpt-)/.test(id) && !OPENAI_NON_CHAT.test(id));
    // Dated snapshots (gpt-4.1-2025-04-14) duplicate their alias: keep the alias only.
    const aliases = new Set(chat);
    const openAiIds = new Set(chat.filter((id) => !(DATED.test(id) && aliases.has(id.replace(DATED, '')))));
    for (const id of [this.config.get('OPENAI_MODEL_FAST'), this.config.get('OPENAI_MODEL_SMART')]) {
      if (hasOpenAi) openAiIds.add(id);
    }
    for (const id of openAiIds) {
      const m = byId.get(`openai/${id}`);
      models.push(
        m
          ? { ...fromRouter(m, 'openai', id, hasOpenAi), name: (m.name ?? id).replace(/^OpenAI:\s*/, '') }
          : { id, provider: 'openai', name: id, available: hasOpenAi, current: tier('openai', id) },
      );
    }
    for (const m of router) {
      if (m.architecture?.output_modalities && !m.architecture.output_modalities.includes('text')) continue;
      models.push(fromRouter(m, 'openrouter', m.id, hasRouter));
    }
    models.sort(
      (a, b) =>
        Number(b.available) - Number(a.available) ||
        Number(!!b.current) - Number(!!a.current) ||
        a.provider.localeCompare(b.provider) ||
        a.name.localeCompare(b.name),
    );
    const value = { models, errors, loadedAt: new Date().toISOString() };
    for (const e of errors) this.logger.warn(e);
    // A failed load is retried on the next request rather than cached for an hour.
    if (!errors.length) this.cache = { at: Date.now(), value };
    return value;
  }

  private async openRouterCatalog(): Promise<OpenRouterModel[]> {
    const res = await fetch(`${this.config.get('OPENROUTER_BASE_URL')}/models`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return ((await res.json()) as { data: OpenRouterModel[] }).data;
  }

  private async openAiModels(): Promise<string[]> {
    const key = this.config.get('OPENAI_API_KEY');
    if (!key) return [];
    const base = this.config.get('OPENAI_BASE_URL') ?? 'https://api.openai.com/v1';
    const res = await fetch(`${base.replace(/\/$/, '')}/models`, {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return ((await res.json()) as { data: { id: string }[] }).data.map((m) => m.id);
  }
}
