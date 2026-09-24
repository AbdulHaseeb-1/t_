import type { CaseResult, Category, ModelInfo, ModelSpec, VariantSummary } from './types';

/** 95% Wilson score interval for a proportion: honest at small n and at 0% / 100%. */
export function wilson(correct: number, total: number, z = 1.96): { lo: number; hi: number } {
  if (total <= 0) return { lo: 0, hi: 0 };
  const p = correct / total;
  const z2 = z * z;
  const denom = 1 + z2 / total;
  const centre = (p + z2 / (2 * total)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total))) / denom;
  return { lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}

/** Scored runs behind a summary (provider outages excluded), from its per-difficulty tallies. */
export function counts(s: VariantSummary): { correct: number; total: number } {
  let correct = 0;
  let total = 0;
  for (const r of Object.values(s.byDifficulty)) {
    correct += r.correct;
    total += r.total;
  }
  return { correct, total };
}

/**
 * Models no other model beats on both accuracy and cost: the ones worth
 * choosing between. Returns their keys, cheapest first.
 */
export function pareto<T extends { key: string; cost: number; accuracy: number }>(points: T[]): string[] {
  const sorted = [...points].sort((a, b) => a.cost - b.cost || b.accuracy - a.accuracy);
  const out: string[] = [];
  let best = -Infinity;
  for (const p of sorted) {
    if (p.accuracy > best) {
      out.push(p.key);
      best = p.accuracy;
    }
  }
  return out;
}

export interface MatrixCell {
  correct: number;
  total: number;
  results: CaseResult[];
}

export interface MatrixRow {
  id: string;
  question: string;
  tags: string[];
  difficulty: string;
  cells: Record<string, MatrixCell>;
  /** Models reached different majority verdicts on this case. */
  disagree: boolean;
  /** Every model got it wrong: often a gold or schema problem worth a look. */
  allWrong: boolean;
}

/** Cases x models, in dataset order, with each model's repeats folded into one cell. */
export function caseMatrix(results: CaseResult[], variants: string[]): MatrixRow[] {
  const rows = new Map<string, MatrixRow>();
  for (const r of results) {
    let row = rows.get(r.id);
    if (!row) {
      row = { id: r.id, question: r.question, tags: r.tags, difficulty: r.difficulty, cells: {}, disagree: false, allWrong: false };
      rows.set(r.id, row);
    }
    const cell = (row.cells[r.variant] ??= { correct: 0, total: 0, results: [] });
    cell.results.push(r);
    if (r.category === 'llm_error') continue; // not scored
    cell.total++;
    if (r.verdict === 'correct') cell.correct++;
  }
  for (const row of rows.values()) {
    const verdicts = variants
      .map((v) => row.cells[v])
      .filter((c): c is MatrixCell => !!c && c.total > 0)
      .map((c) => c.correct * 2 > c.total);
    row.disagree = new Set(verdicts).size > 1;
    row.allWrong = verdicts.length > 0 && verdicts.every((ok) => !ok);
  }
  return [...rows.values()];
}

/** Average tokens one case costs, from earlier results (the best predictor of the next run). */
export function averageUsage(results: CaseResult[]): { prompt: number; cached: number; completion: number } | undefined {
  const withUsage = results.filter((r) => r.usage && r.usage.llmCalls > 0);
  if (!withUsage.length) return undefined;
  const sum = (f: (r: CaseResult) => number) => withUsage.reduce((s, r) => s + f(r), 0) / withUsage.length;
  return {
    prompt: sum((r) => r.usage!.promptTokens),
    cached: sum((r) => r.usage!.cachedPromptTokens),
    completion: sum((r) => r.usage!.completionTokens),
  };
}

/** Typical one-call text-to-SQL case when no history exists: whole-schema prompt, half of it cache hits. */
export const DEFAULT_CASE_USAGE = { prompt: 8_000, cached: 4_000, completion: 150 };

/** Estimated USD for running `caseRuns` cases on each model; undefined when a model has no known price. */
export function estimateCost(
  models: ModelSpec[],
  catalog: ModelInfo[],
  caseRuns: number,
  usage = DEFAULT_CASE_USAGE,
): { perModel: (number | undefined)[]; total?: number } {
  const perModel = models.map((m) => {
    const info = catalog.find((c) => c.provider === m.provider && c.id === m.model);
    if (info?.promptPerM === undefined || info.completionPerM === undefined) return undefined;
    const cached = info.cachedPerM ?? info.promptPerM;
    const perCase =
      ((usage.prompt - usage.cached) * info.promptPerM + usage.cached * cached + usage.completion * info.completionPerM) / 1e6;
    return perCase * caseRuns;
  });
  const known = perModel.filter((x): x is number => x !== undefined);
  return { perModel, total: known.length === perModel.length ? known.reduce((a, b) => a + b, 0) : undefined };
}

export const CATEGORY_LABEL: Record<Category, string> = {
  correct: 'Correct',
  wrong_rows: 'Wrong rows',
  wrong_columns: 'Missing column',
  wrong_values: 'Wrong values',
  wrong_order: 'Wrong order',
  false_refusal: 'Refused wrongly',
  missed_refusal: 'Should have refused',
  sql_error: 'SQL error',
  unsafe_sql: 'Unsafe SQL',
  llm_error: 'Provider error',
  other_error: 'Error',
};

// ── Formatting ─────────────────────────────────────────────────────────

export function pct(x: number, digits = 1): string {
  return `${(x * 100).toFixed(digits).replace(/\.0+$/, '')}%`;
}

/** Tiny API costs stay readable: 0.000123 -> "$0.000123", 1.5 -> "$1.50". */
export function usd(x: number | undefined): string {
  if (x === undefined || !Number.isFinite(x)) return '—';
  if (x === 0) return '$0';
  if (x >= 1) return `$${x.toFixed(2)}`;
  if (x >= 0.01) return `$${x.toFixed(3)}`;
  return `$${x.toPrecision(3).replace(/0+$/, '').replace(/\.$/, '')}`;
}

export function ms(x: number): string {
  if (x < 1000) return `${Math.round(x)} ms`;
  return `${(x / 1000).toFixed(x < 10_000 ? 1 : 0)} s`;
}

export function compact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e6) return `${Number((n / 1e6).toFixed(a >= 1e7 ? 0 : 1))}M`;
  if (a >= 1e3) return `${Number((n / 1e3).toFixed(a >= 1e4 ? 0 : 1))}K`;
  return String(Math.round(n));
}

export function perM(x: number | undefined): string {
  if (x === undefined) return '—';
  return x >= 10 ? `$${x.toFixed(0)}` : `$${Number(x.toFixed(3))}`;
}

export function when(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Model spec behind a saved variant, recovered from its environment overrides. */
export function specFromOverrides(o: Record<string, string>): ModelSpec | undefined {
  const provider = o.LLM_PROVIDER === 'openrouter' ? 'openrouter' : o.LLM_PROVIDER === 'openai' ? 'openai' : undefined;
  if (!provider) return undefined;
  const model = provider === 'openai' ? o.OPENAI_MODEL_FAST : o.OPENROUTER_MODEL_FAST;
  if (!model) return undefined;
  return { provider, model, reasoningEffort: o.LLM_REASONING_EFFORT_FAST as ModelSpec['reasoningEffort'] };
}
