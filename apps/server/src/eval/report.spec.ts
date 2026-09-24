import { flips, summarize } from './metrics.js';
import { renderText, type RunInfo } from './report-text.js';
import type { CaseResult } from './runner.js';

const result = (variant: string, id: string, ok: boolean, sql = 'SELECT 1'): CaseResult => ({
  variant,
  repeat: 0,
  id,
  question: `Question ${id}`,
  tags: ['join'],
  difficulty: 'medium',
  expect: 'result',
  verdict: ok ? 'correct' : 'wrong',
  category: ok ? 'correct' : 'wrong_values',
  detail: ok ? undefined : 'columns match individually but rows differ',
  goldSql: 'SELECT 1',
  sql,
  answer: null,
  attempts: 1,
  latencyMs: 1200,
  llmMs: 1100,
  dbMs: 100,
  usage: {
    llmCalls: 1,
    promptTokens: 500,
    cachedPromptTokens: 0,
    completionTokens: 40,
    costUsd: 0.0001,
    costComplete: true,
    models: ['openai:m'],
  },
});

const results = [
  result('baseline', 'q1', false),
  result('baseline', 'q2', true),
  result('tuned', 'q1', true),
  result('tuned', 'q2', true),
];
const summaries = [
  summarize('baseline', {}, results.slice(0, 2)),
  summarize('tuned', { ASK_FEWSHOT_K: '3' }, results.slice(2)),
];
const info: RunInfo = {
  dataset: 'retail',
  database: 'Eval_Retail',
  startedAt: '2026-09-23T00:00:00.000Z',
  durationS: 12,
  repeats: 1,
  cases: 2,
  models: ['openai:m'],
  withAnswers: false,
};

describe('renderText', () => {
  const text = renderText(info, summaries, flips('baseline', 'tuned', results), results);

  it('renders aligned plain-text tables', () => {
    const lines = text.split('\n');
    const header = lines.find((l) => l.startsWith('variant '))!;
    const base = lines.find((l) => l.startsWith('baseline '))!;
    const tuned = lines.find((l) => l.startsWith('tuned '))!;
    expect(base).toContain('50.0%');
    expect(tuned).toContain('100.0%');
    // Right-aligned numeric columns end at the same position as their header.
    expect(base.indexOf('50.0%') + 5).toBe(header.indexOf('accuracy') + 'accuracy'.length);
    expect(tuned.length).toBe(base.length);
  });

  it('lists settings, changes and failures with the SQL', () => {
    expect(text).toContain('tuned: ASK_FEWSHOT_K=3');
    expect(text).toContain('fixed   tuned  q1  Question q1');
    expect(text).toContain('baseline  q1  wrong_values: columns match individually but rows differ');
    expect(text).toContain('    SQL  SELECT 1');
    expect(text).not.toMatch(/<[a-z]/i);
  });
});
