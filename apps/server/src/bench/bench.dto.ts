import { z } from 'zod';
import { PROVIDERS } from '../config/env.js';

export const EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

export const modelSpecSchema = z.object({
  provider: z.enum(PROVIDERS),
  model: z.string().trim().min(1).max(200),
  /** Omitted: the server's configured effort for the fast tier. */
  reasoningEffort: z.enum(EFFORTS).optional(),
  label: z.string().trim().max(60).optional(),
});

/** Pipeline features, identical for every model in a run so only the model differs. */
export const featuresSchema = z
  .object({
    valueHints: z.boolean().optional(),
    emptyRecheck: z.boolean().optional(),
    candidates: z.number().int().min(1).max(7).optional(),
    fewShot: z.boolean().optional(),
    /** Run the chat agent (what the app and WhatsApp use) instead of one-shot text-to-SQL. */
    agent: z.boolean().optional(),
  })
  .default({});

export const startRunSchema = z.object({
  dataset: z.string().regex(/^[\w.-]+$/, 'dataset file name'),
  // Six: one validated categorical colour per model in the charts.
  models: z.array(modelSpecSchema).min(1).max(6),
  repeats: z.number().int().min(1).max(10).default(1),
  concurrency: z.number().int().min(1).max(8).default(4),
  /** Only these case ids (default: all). */
  caseIds: z.array(z.string()).max(1000).optional(),
  /** Regex over case ids and tags. */
  filter: z.string().max(200).optional(),
  answers: z.boolean().default(false),
  features: featuresSchema,
});

export const compareSchema = z.object({
  question: z.string().trim().min(3).max(2000),
  models: z.array(modelSpecSchema).min(1).max(6),
  features: featuresSchema,
});

export type ModelSpec = z.infer<typeof modelSpecSchema>;
export type Features = z.infer<typeof featuresSchema>;
export type StartRunInput = z.infer<typeof startRunSchema>;
export type CompareInput = z.infer<typeof compareSchema>;

/** Environment overrides that make the ask pipeline use exactly this model (escalation included). */
export function modelOverrides(m: ModelSpec, f: Features = {}): Record<string, string> {
  const p = m.provider === 'openai' ? 'OPENAI' : 'OPENROUTER';
  const o: Record<string, string> = {
    LLM_PROVIDER: m.provider,
    [`${p}_MODEL_FAST`]: m.model,
    [`${p}_MODEL_SMART`]: m.model,
  };
  if (m.reasoningEffort) {
    o.LLM_REASONING_EFFORT_FAST = m.reasoningEffort;
    o.AGENT_REASONING_EFFORT = m.reasoningEffort;
  }
  if (f.valueHints !== undefined) o.SCHEMA_VALUE_HINTS = String(f.valueHints);
  if (f.emptyRecheck !== undefined) o.ASK_EMPTY_RESULT_RECHECK = String(f.emptyRecheck);
  if (f.candidates !== undefined) o.ASK_SQL_CANDIDATES = String(f.candidates);
  if (f.fewShot) {
    o.ASK_FEWSHOT_K = '3';
    o.EVAL_FEWSHOT = 'dataset';
  }
  if (f.agent) o.EVAL_PIPELINE = 'chat';
  return o;
}

/** Display names, unique within a run: "gpt-6-luna", "gpt-6-luna · high", "gpt-6-luna · high #2". */
export function variantNames(models: ModelSpec[]): string[] {
  const seen = new Map<string, number>();
  return models.map((m) => {
    const base = m.label || (m.reasoningEffort ? `${m.model} · ${m.reasoningEffort}` : m.model);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base} #${n}`;
  });
}
