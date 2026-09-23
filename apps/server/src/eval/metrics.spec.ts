import { flips, percentile, summarize } from './metrics.js';
import type { CaseResult } from './runner.js';

const r = (id: string, repeat: number, ok: boolean, extra: Partial<CaseResult> = {}): CaseResult => ({
  variant: 'v',
  repeat,
  id,
  question: id,
  tags: ['join'],
  difficulty: 'easy',
  expect: 'result',
  verdict: ok ? 'correct' : 'wrong',
  category: ok ? 'correct' : 'wrong_values',
  sql: 'SELECT 1',
  answer: null,
  attempts: 1,
  latencyMs: 100,
  llmMs: 90,
  dbMs: 10,
  usage: {
    llmCalls: 1,
    promptTokens: 10,
    cachedPromptTokens: 0,
    completionTokens: 5,
    costUsd: 0.001,
    models: [],
  },
  ...extra,
});

describe('summarize', () => {
  const results = [
    r('a', 0, true),
    r('a', 1, true),
    r('b', 0, true, {
      attempts: 2,
      trace: { candidates: 2, repairs: 1, emptyRecheck: false, escalated: true, examples: 0 },
    }),
    r('b', 1, false),
  ];
  const s = summarize('v', {}, results);

  it('computes accuracy, spread and repeat consistency', () => {
    expect(s.accuracy).toBe(0.75);
    expect(s.accuracyStdDev).toBe(0.25);
    expect(s.passAtK).toBe(1);
    expect(s.passAllK).toBe(0.5);
    expect(s.stability).toBe(0.5);
  });

  it('separates first-try successes from rescued ones', () => {
    expect(s.firstTryAccuracy).toBe(0.5);
    expect(s.rescues).toMatchObject({ repair: 1, escalation: 1 });
  });

  it('computes cost per correct answer', () => {
    expect(s.cost.totalUsd).toBeCloseTo(0.004);
    expect(s.cost.perCorrectUsd).toBeCloseTo(0.004 / 3);
  });
});

describe('flips', () => {
  it('reports cases fixed or broken relative to the baseline', () => {
    const results = [
      r('a', 0, false),
      r('b', 0, true),
      { ...r('a', 0, true), variant: 'w' },
      { ...r('b', 0, false), variant: 'w' },
    ];
    expect(flips('v', 'w', results).map((f) => `${f.id}:${f.change}`)).toEqual(['a:fixed', 'b:broken']);
  });
});

describe('percentile', () => {
  it('uses nearest-rank', () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([1, 2, 3, 4, 100], 95)).toBe(100);
  });
});

describe('infra errors', () => {
  it('are excluded from accuracy and counted separately', () => {
    const s = summarize('v', {}, [
      r('a', 0, true),
      { ...r('b', 0, false), verdict: 'error', category: 'llm_error' },
    ]);
    expect(s).toMatchObject({ accuracy: 1, infraErrors: 1 });
    expect(
      summarize('v', {}, [{ ...r('b', 0, false), verdict: 'error', category: 'llm_error' }]).accuracy,
    ).toBe(0);
  });
});

describe('vote rescues', () => {
  it('count only real votes with dissent, not repair rounds', () => {
    const base = { candidates: 2, repairs: 1, emptyRecheck: false, escalated: false, examples: 0 };
    const s = summarize('v', {}, [
      r('a', 0, true, { trace: base }),
      r('b', 0, true, { trace: { ...base, candidates: 3, votes: 3, agreement: 2 } }),
      r('c', 0, true, { trace: { ...base, candidates: 3, votes: 3, agreement: 3 } }),
    ]);
    expect(s.rescues.vote).toBe(1);
  });
});
