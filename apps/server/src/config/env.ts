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
  SCHEMA_EXCLUDE: csv,
  SCHEMA_CACHE_FILE: z.string().default('.cache/schema.json'),
  /** Below this rendered size the whole schema is sent (stable prefix => provider cache hits). */
  SCHEMA_FULL_CONTEXT_MAX_CHARS: z.coerce.number().int().positive().default(24_000),
  SCHEMA_MAX_TABLES: z.coerce.number().int().positive().default(10),

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
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
