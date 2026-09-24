import { z } from 'zod';

const bool = (fallback: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => (v === undefined ? fallback : v === 'true' || v === '1'));

const csv = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v?.trim() ? v.trim() : undefined));

export const PROVIDERS = ['openai', 'openrouter'] as const;
export type ProviderName = (typeof PROVIDERS)[number];
export type ProviderMode = ProviderName | 'auto';

const reasoningEffort = z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']).optional();

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  /** When set, every request except /health must send `x-api-key`. */
  API_KEY: optionalString,
  CORS_ORIGINS: csv,
  THROTTLE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(60),

  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.coerce.number().int().positive().default(1433),
  DB_NAME: z.string().default('MDS_EPD'),
  DB_USER: z.string().default('sa'),
  DB_PASSWORD: z.string().default(''),
  DB_ENCRYPT: bool(false),
  DB_TRUST_SERVER_CERT: bool(true),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),
  DB_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  /** Hard cap on rows returned by any generated query. */
  DB_MAX_ROWS: z.coerce.number().int().positive().default(1000),
  /** Dirty reads avoid blocking OLTP writers; disable if exactness matters more than contention. */
  DB_READ_UNCOMMITTED: bool(true),

  /** Glob patterns on `schema.table`, e.g. `dbo.*,sales.*`. Empty = everything. */
  SCHEMA_INCLUDE: csv,
  /**
   * Column-name globs that must never be read (secrets and identity numbers).
   * They are hidden from the model and any SQL naming them is rejected. For full
   * protection also DENY them to the reader login (infra/mssql/harden.sql).
   */
  DB_DENY_COLUMNS: csv.transform((v) => (v.length ? v : ['*password*', '*passwd*', '*pwd*', '*secret*', '*token*', '*cnic*', '*ssn*'])),
  SCHEMA_EXCLUDE: csv,
  SCHEMA_CACHE_FILE: z.string().default('.cache/schema.json'),
  /** JSON of curated table/column notes (grain, which amount is "sales"...). See schema-notes.ts. */
  SCHEMA_NOTES_FILE: z.string().default(''),
  /** Below this rendered size the whole schema is sent (stable prefix => provider cache hits). */
  SCHEMA_FULL_CONTEXT_MAX_CHARS: z.coerce.number().int().positive().default(24_000),
  SCHEMA_MAX_TABLES: z.coerce.number().int().positive().default(10),

  /**
   * Sample distinct values of low-cardinality text columns into the schema
   * (e.g. Status {Shipped|Cancelled}) so filters use real codes. Columns whose
   * names look personal are never sampled.
   */
  SCHEMA_VALUE_HINTS: bool(true),
  SCHEMA_VALUE_HINTS_MAX_DISTINCT: z.coerce.number().int().positive().default(25),
  SCHEMA_VALUE_HINTS_MAX_TABLE_ROWS: z.coerce.number().int().positive().default(5_000_000),
  SCHEMA_VALUE_HINTS_MAX_COLUMNS: z.coerce.number().int().positive().default(400),
  SCHEMA_VALUE_HINTS_EXCLUDE: z
    .string()
    .default(
      'name|mail|email|phone|ph|cell|mobile|tel|fax|address|addr|street|zip|postal|ssn|cnic|nic|passport|password|pwd|token|secret|iban|card|account|acc|birth|dob|salary|note|notes|comment|remarks|description|desc|url|ip|loc|location|gps|lat|lng|lon|cheque|chq|insr|updt|by|user|contact',
    ),

  /** Verified question -> SQL pairs used as few-shot examples. */
  EXAMPLES_FILE: z.string().default('examples.json'),
  /**
   * Off by default: on the retail eval, few-shot gave no gain (88.3% vs 88.3%) and
   * one regression. Enable (e.g. 3) once you have curated examples, and verify with the eval.
   */
  ASK_FEWSHOT_K: z.coerce.number().int().nonnegative().default(0),
  /** Parallel SQL candidates with result voting (self-consistency). 1 = off. */
  ASK_SQL_CANDIDATES: z.coerce.number().int().positive().max(7).default(1),
  /** Translate Urdu / Roman Urdu questions to English before retrieval and SQL generation. */
  ASK_TRANSLATE_NON_ENGLISH: bool(true),
  /** Re-examine text filters once when a query returns no rows. */
  ASK_EMPTY_RESULT_RECHECK: bool(true),

  /** Speech-to-text model (OpenAI audio API). */
  TRANSCRIBE_MODEL: z.string().default('gpt-4o-transcribe'),
  /** Reading images: high detail + a little reasoning was needed to read small Urdu text reliably. */
  VISION_REASONING_EFFORT: z.enum(['none', 'minimal', 'low', 'medium', 'high']).default('low'),
  MEDIA_MAX_AUDIO_MB: z.coerce.number().positive().default(10),
  MEDIA_MAX_IMAGE_MB: z.coerce.number().positive().default(8),

  LLM_PROVIDER: z.enum(['auto', ...PROVIDERS]).default('auto'),
  /** Try order for `auto`. The first configured provider is primary. */
  LLM_FALLBACK_ORDER: z
    .string()
    .default('openai,openrouter')
    .transform((v, ctx) => {
      const order = v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      for (const p of order) {
        if (!(PROVIDERS as readonly string[]).includes(p)) {
          ctx.addIssue({ code: 'custom', message: `unknown provider "${p}"` });
        }
      }
      return order as ProviderName[];
    }),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),
  /**
   * SDK retries (honouring retry-after) when a provider has no fallback.
   * Providers with a fallback in auto mode retry once, then fail over fast.
   */
  LLM_MAX_RETRIES: z.coerce.number().int().nonnegative().default(3),
  LLM_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(1500),
  LLM_REASONING_EFFORT_FAST: reasoningEffort,
  LLM_REASONING_EFFORT_SMART: reasoningEffort,
  /** Consecutive failures before a provider is skipped, and for how long. */
  LLM_BREAKER_THRESHOLD: z.coerce.number().int().positive().default(3),
  LLM_BREAKER_COOLDOWN_MS: z.coerce.number().int().positive().default(60_000),

  OPENAI_API_KEY: optionalString,
  OPENAI_BASE_URL: optionalString,
  OPENAI_MODEL_FAST: z.string().default('gpt-6-luna'),
  OPENAI_MODEL_SMART: z.string().default('gpt-6-sol'),

  OPENROUTER_API_KEY: optionalString,
  OPENROUTER_BASE_URL: z.string().default('https://openrouter.ai/api/v1'),
  OPENROUTER_MODEL_FAST: z.string().default('deepseek/deepseek-v4-flash'),
  OPENROUTER_MODEL_SMART: z.string().default('anthropic/claude-sonnet-5'),
  /** OpenRouter upstream routing preference. */
  OPENROUTER_PROVIDER_SORT: z.enum(['price', 'throughput', 'latency']).optional(),
  OPENROUTER_APP_NAME: z.string().default('db-intelligence'),

  CACHE_MAX_ENTRIES: z.coerce.number().int().positive().default(1000),
  /** Question -> SQL. Long-lived: re-running cached SQL costs zero tokens and returns fresh data. */
  CACHE_SQL_TTL_S: z.coerce.number().int().nonnegative().default(86_400),
  /** Question -> full answer. Short-lived because data changes. */
  CACHE_ANSWER_TTL_S: z.coerce.number().int().nonnegative().default(120),

  ASK_MAX_REPAIRS: z.coerce.number().int().nonnegative().default(2),
  ASK_ANSWER_MAX_ROWS: z.coerce.number().int().positive().default(60),
  AGENT_MAX_STEPS: z.coerce.number().int().positive().default(8),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  // `KEY=` in a .env file means "unset", not "empty string": fall back to the default.
  const present = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== ''));
  const parsed = envSchema.safeParse(present);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
