import type { AppConfig } from '../config/app-config.js';
import { type Env, validateEnv } from '../config/env.js';
import { DatabaseService } from '../database/database.service.js';
import { SchemaCatalogService } from '../database/schema/schema-catalog.service.js';
import { LlmService } from '../llm/llm.service.js';
import { ModelPricingService } from '../llm/model-pricing.service.js';
import { AnalystService } from '../query/analyst/analyst.service.js';
import { AskService } from '../query/ask.service.js';
import { ExamplesService } from '../query/examples.service.js';
import { QueryCacheService } from '../query/query-cache.service.js';
import { TranslatorService } from '../query/translator.service.js';

export interface Pipeline {
  env: Env;
  db: DatabaseService;
  catalog: SchemaCatalogService;
  llm: LlmService;
  examples: ExamplesService;
  ask: AskService;
  /** The chat agent over the same services. */
  analyst: AnalystService;
  close(): Promise<void>;
}

/**
 * The production services, wired by hand with one variant's settings. Using
 * the real classes (not a re-implementation) means the harness measures
 * exactly what the API serves.
 */
export function buildPipeline(raw: Record<string, string | undefined>): Pipeline {
  const env = validateEnv(raw);
  const config = { get: (k: keyof Env) => env[k] } as AppConfig;
  const db = new DatabaseService(config);
  const catalog = new SchemaCatalogService(config, db);
  const llm = new LlmService(config, new ModelPricingService(config));
  const examples = new ExamplesService(config);
  const cache = new QueryCacheService(config);
  const translator = new TranslatorService(llm);
  const ask = new AskService(config, db, catalog, llm, cache, examples, translator);
  const analyst = new AnalystService(config, db, catalog, llm, cache, translator);
  return { env, db, catalog, llm, examples, ask, analyst, close: () => db.onApplicationShutdown() };
}
