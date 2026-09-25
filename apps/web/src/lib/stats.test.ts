import { describe, expect, it } from 'vitest';
import { caseMatrix, compact, counts, estimateCost, ms, pareto, pct, specFromOverrides, usd, wilson } from './stats';
import type { CaseResult, ModelInfo, VariantSummary } from './types';

const r = (variant: string, id: string, ok: boolean, extra: Partial<CaseResult> = {}): CaseResult => ({
  variant,
  repeat: 0,
  id,
  question: `q ${id}`,
  tags: [],
  difficulty: 'easy',
  expect: 'result',
  verdict: ok ? 'correct' : 'wrong',
  category: ok ? 'correct' : 'wrong_values',
  sql: 'SELECT 1',
  answer: null,
  attempts: 1,
  latencyMs: 1000,
  llmMs: 900,
  dbMs: 10,
  ...extra,
});

describe('wilson', () => {
  it('matches the textbook interval and stays inside [0, 1]', () => {
    const { lo, hi } = wilson(39, 40);
    expect(lo).toBeCloseTo(0.8712, 3);
    expect(hi).toBeCloseTo(0.9956, 3);
    expect(wilson(0, 10).lo).toBe(0);
    expect(wilson(10, 10).hi).toBe(1);
    expect(wilson(0, 0)).toEqual({ lo: 0, hi: 0 });
  });

  it('is wide for small samples: 3/3 does not prove a perfect model', () => {
    expect(wilson(3, 3).lo).toBeLessThan(0.45);
  });
});

describe('pareto', () => {
  it('keeps only models no other model beats on both cost and accuracy', () => {
    const points = [
      { key: 'cheap-ok', cost: 0.0001, accuracy: 0.9 },
      { key: 'cheap-bad', cost: 0.0001, accuracy: 0.7 },
      { key: 'mid-worse', cost: 0.001, accuracy: 0.85 },
      { key: 'pricey-best', cost: 0.01, accuracy: 0.97 },
    ];
    expect(pareto(points)).toEqual(['cheap-ok', 'pricey-best']);
  });
});

describe('caseMatrix', () => {
  it('folds repeats, flags disagreements and all-wrong cases, and ignores provider errors', () => {
    const results = [
      r('a', 'c1', true),
      r('b', 'c1', false),
      r('a', 'c2', false),
      r('b', 'c2', false),
      r('a', 'c3', true),
      { ...r('b', 'c3', false), verdict: 'error' as const, category: 'llm_error' as const },
      { ...r('a', 'c1', true), repeat: 1 },
    ];
    const m = caseMatrix(results, ['a', 'b']);
    expect(m.map((x) => x.id)).toEqual(['c1', 'c2', 'c3']);
    expect(m[0].cells.a).toMatchObject({ correct: 2, total: 2 });
    expect(m[0]).toMatchObject({ disagree: true, allWrong: false });
    expect(m[1]).toMatchObject({ disagree: false, allWrong: true });
    expect(m[2].cells.b).toMatchObject({ correct: 0, total: 0 });
    expect(m[2].disagree).toBe(false);
  });
});

describe('estimateCost', () => {
  const catalog: ModelInfo[] = [
    { id: 'm1', provider: 'openai', name: 'm1', available: true, promptPerM: 1, completionPerM: 4, cachedPerM: 0.1 },
    { id: 'm2', provider: 'openai', name: 'm2', available: true },
  ];
  it('prices uncached, cached and output tokens separately', () => {
    const e = estimateCost([{ provider: 'openai', model: 'm1' }], catalog, 100, { prompt: 8000, cached: 4000, completion: 150 });
    // (4000*1 + 4000*0.1 + 150*4) / 1e6 = 0.005 per case
    expect(e.perModel[0]).toBeCloseTo(0.5, 6);
    expect(e.total).toBeCloseTo(0.5, 6);
  });
  it('gives no total when a model has no known price', () => {
    const e = estimateCost([{ provider: 'openai', model: 'm1' }, { provider: 'openai', model: 'm2' }], catalog, 10);
    expect(e.perModel[1]).toBeUndefined();
    expect(e.total).toBeUndefined();
  });
});

describe('formatting', () => {
  it('formats rates, money, time and counts', () => {
    expect([pct(0.975), pct(1), pct(0.5)]).toEqual(['97.5%', '100%', '50%']);
    expect([usd(0.000127), usd(0.0123), usd(1.5), usd(0), usd(undefined)]).toEqual(['$0.000127', '$0.012', '$1.50', '$0', '—']);
    expect([ms(850), ms(1594), ms(13_400)]).toEqual(['850 ms', '1.6 s', '13 s']);
    expect([compact(950), compact(8109), compact(1_234_567)]).toEqual(['950', '8.1K', '1.2M']);
  });
});

describe('counts / specFromOverrides', () => {
  it('recovers scored totals and the model behind a saved variant', () => {
    const s = { byDifficulty: { easy: { correct: 3, total: 4, accuracy: 0.75 }, hard: { correct: 1, total: 2, accuracy: 0.5 } } } as unknown as VariantSummary;
    expect(counts(s)).toEqual({ correct: 4, total: 6 });
    expect(specFromOverrides({ LLM_PROVIDER: 'openrouter', OPENROUTER_MODEL_FAST: 'a/b', LLM_REASONING_EFFORT_FAST: 'low' })).toEqual({
      provider: 'openrouter',
      model: 'a/b',
      reasoningEffort: 'low',
    });
    expect(specFromOverrides({})).toBeUndefined();
  });
});
