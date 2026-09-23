import { flips, summarize } from './metrics.js';
import { renderHtml } from './report-html.js';
import { renderMarkdown, type RunInfo } from './report-markdown.js';
import type { CaseResult } from './runner.js';

const result = (variant: string, id: string, ok: boolean, sql = 'SELECT 1'): CaseResult => ({
  variant,
  repeat: 0,
  id,
  question: `Question ${id} | with pipe`,
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
    models: ['openai:m'],
  },
  gold: { columns: ['a'], rows: [[1]], rowCount: 1 },
  predicted: { columns: ['a'], rows: [[2]], rowCount: 1 },
});

const results = [
  result('baseline', 'q1', false),
  result('baseline', 'q2', true),
  result('tuned', 'q1', true, "SELECT '</script><script>alert(1)</script>'"),
  result('tuned', 'q2', true),
];
const summaries = [
  summarize('baseline', {}, results.slice(0, 2)),
  summarize('tuned', { ASK_FEWSHOT_K: '3' }, results.slice(2)),
];
const flipList = flips('baseline', 'tuned', results);
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

describe('renderMarkdown', () => {
  const md = renderMarkdown(info, summaries, flipList, results);

  it('includes the comparison, settings, flips and escaped failures', () => {
    expect(md).toContain('| **baseline** | 50.0%');
    expect(md).toContain('| **tuned** | 100.0%');
    expect(md).toContain('`ASK_FEWSHOT_K=3`');
    expect(md).toContain('✅ fixed in **tuned**: `q1`');
    expect(md).toContain('Question q1 \\| with pipe');
  });
});

describe('renderHtml', () => {
  it('embeds data safely and names the page', async () => {
    const html = await renderHtml(info, summaries, flipList, results);
    expect(html).toContain('<title>Retail accuracy scorecard</title>');
    expect(html).not.toContain('__DATA__');
    // The only literal </script> tags are the page's own two script elements.
    expect(html.match(/<\/script>/g)).toHaveLength(2);
    const json = /<script type="application\/json" id="eval-data">([\s\S]*?)<\/script>/.exec(html)![1];
    expect(JSON.parse(json).results[2].sql).toContain('</script>');
  });
});
