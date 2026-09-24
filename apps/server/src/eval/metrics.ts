import type { Category, CaseResult } from './runner.js';

export interface Rate {
  correct: number;
  total: number;
  accuracy: number;
}

export interface VariantSummary {
  variant: string;
  overrides: Record<string, string>;
  cases: number;
  repeats: number;
  /** Correct / scored runs. Runs lost to provider errors (rate limits, outages) are not scored. */
  accuracy: number;
  /** Runs that ended in an LLM provider error and were excluded from accuracy. */
  infraErrors: number;
  /** Standard deviation of per-repeat accuracy (0 with a single repeat). */
  accuracyStdDev: number;
  /** Case solved in at least one repeat / in every repeat. */
  passAtK: number;
  passAllK: number;
  /** Share of cases whose verdict was identical across repeats. */
  stability: number;
  firstTryAccuracy: number;
  /** Answers written in the question's language (only when answers were generated). */
  answerLanguage?: Rate;
  byTag: Record<string, Rate>;
  byDifficulty: Record<string, Rate>;
  categories: Partial<Record<Category, number>>;
  rescues: { repair: number; emptyRecheck: number; escalation: number; vote: number };
  latency: { meanMs: number; p50Ms: number; p95Ms: number; maxMs: number };
  cost: { totalUsd: number; perQuestionUsd: number; perCorrectUsd: number };
  tokens: { prompt: number; cachedPrompt: number; completion: number; llmCalls: number };
}

export interface Flip {
  id: string;
  question: string;
  from: string;
  to: string;
  change: 'fixed' | 'broken';
}

function pct(n: number, d: number): number {
  return d === 0 ? 0 : n / d;
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function rates(results: CaseResult[], keys: (r: CaseResult) => string[]): Record<string, Rate> {
  const out: Record<string, Rate> = {};
  for (const r of results) {
    for (const k of keys(r)) {
      const e = (out[k] ??= { correct: 0, total: 0, accuracy: 0 });
      e.total++;
      if (r.verdict === 'correct') e.correct++;
    }
  }
  for (const e of Object.values(out)) e.accuracy = pct(e.correct, e.total);
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

export function summarize(
  variant: string,
  overrides: Record<string, string>,
  all: CaseResult[],
): VariantSummary {
  const infraErrors = all.filter((r) => r.category === 'llm_error').length;
  const results = all.filter((r) => r.category !== 'llm_error');
  const repeats = Math.max(1, ...all.map((r) => r.repeat + 1));
  const byCase = new Map<string, CaseResult[]>();
  for (const r of results) byCase.set(r.id, [...(byCase.get(r.id) ?? []), r]);

  const perRepeat = Array.from({ length: repeats }, (_, k) => {
    const rs = results.filter((r) => r.repeat === k);
    return pct(rs.filter((r) => r.verdict === 'correct').length, rs.length);
  }).filter((_, k) => results.some((r) => r.repeat === k));
  const mean = perRepeat.length ? perRepeat.reduce((s, a) => s + a, 0) / perRepeat.length : 0;
  const sd = perRepeat.length
    ? Math.sqrt(perRepeat.reduce((s, a) => s + (a - mean) ** 2, 0) / perRepeat.length)
    : 0;

  const groups = [...byCase.values()];
  const categories: Partial<Record<Category, number>> = {};
  for (const r of results) categories[r.category] = (categories[r.category] ?? 0) + 1;

  const ok = results.filter((r) => r.verdict === 'correct');
  const latencies = results.map((r) => r.latencyMs);
  const totalUsd = results.reduce((s, r) => s + (r.usage?.costUsd ?? 0), 0);

  return {
    variant,
    overrides,
    cases: byCase.size,
    repeats,
    accuracy: mean,
    infraErrors,
    accuracyStdDev: sd,
    passAtK: pct(groups.filter((g) => g.some((r) => r.verdict === 'correct')).length, groups.length),
    passAllK: pct(groups.filter((g) => g.every((r) => r.verdict === 'correct')).length, groups.length),
    stability: pct(groups.filter((g) => new Set(g.map((r) => r.verdict)).size === 1).length, groups.length),
    answerLanguage: (() => {
      const checked = results.filter((r) => r.answerLanguageOk !== undefined);
      if (!checked.length) return undefined;
      const correct = checked.filter((r) => r.answerLanguageOk).length;
      return { correct, total: checked.length, accuracy: pct(correct, checked.length) };
    })(),
    firstTryAccuracy: pct(
      ok.filter((r) => r.attempts <= 1 && !r.trace?.emptyRecheck && !r.trace?.escalated).length,
      results.length,
    ),
    byTag: rates(results, (r) => (r.tags.length ? r.tags : ['untagged'])),
    byDifficulty: rates(results, (r) => [r.difficulty]),
    categories,
    rescues: {
      repair: ok.filter((r) => (r.trace?.repairs ?? 0) > 0).length,
      emptyRecheck: ok.filter((r) => r.trace?.emptyRecheck).length,
      escalation: ok.filter((r) => r.trace?.escalated).length,
      // The vote mattered: at least one candidate disagreed with the winner.
      vote: ok.filter((r) => r.trace?.votes && (r.trace.agreement ?? 0) < r.trace.votes).length,
    },
    latency: {
      meanMs: Math.round(latencies.reduce((s, a) => s + a, 0) / Math.max(1, latencies.length)),
      p50Ms: percentile(latencies, 50),
      p95Ms: percentile(latencies, 95),
      maxMs: Math.max(0, ...latencies),
    },
    cost: {
      totalUsd,
      perQuestionUsd: totalUsd / Math.max(1, results.length),
      perCorrectUsd: ok.length ? totalUsd / ok.length : 0,
    },
    tokens: {
      prompt: results.reduce((s, r) => s + (r.usage?.promptTokens ?? 0), 0),
      cachedPrompt: results.reduce((s, r) => s + (r.usage?.cachedPromptTokens ?? 0), 0),
      completion: results.reduce((s, r) => s + (r.usage?.completionTokens ?? 0), 0),
      llmCalls: results.reduce((s, r) => s + (r.usage?.llmCalls ?? 0), 0),
    },
  };
}

/** Cases whose majority verdict changed between the baseline and another variant. */
export function flips(baseline: string, other: string, results: CaseResult[]): Flip[] {
  const majority = (variant: string) => {
    const m = new Map<string, { q: string; ok: number; n: number }>();
    for (const r of results.filter((x) => x.variant === variant)) {
      const e = m.get(r.id) ?? { q: r.question, ok: 0, n: 0 };
      e.n++;
      if (r.verdict === 'correct') e.ok++;
      m.set(r.id, e);
    }
    return m;
  };
  const a = majority(baseline);
  const b = majority(other);
  const out: Flip[] = [];
  for (const [id, x] of a) {
    const y = b.get(id);
    if (!y) continue;
    const wasOk = x.ok * 2 > x.n;
    const isOk = y.ok * 2 > y.n;
    if (wasOk !== isOk)
      out.push({ id, question: x.q, from: baseline, to: other, change: isOk ? 'fixed' : 'broken' });
  }
  return out;
}
