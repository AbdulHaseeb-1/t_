import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { ConflictException } from '@nestjs/common';
import { isTransient } from '../eval/runner.js';
import { exportMdfToDuckDb } from '../mdf/export-duckdb.js';
import { FakeOpenAI, testConfig } from '../testing/fake-openai.js';
import { modelOverrides, variantNames } from './bench.dto.js';
import { agreement, BenchService } from './bench.service.js';

/**
 * The bench end to end on a real DuckDB file: two fake models (one writes the
 * right SQL, one the wrong table), scored against gold by the real harness.
 */
const dir = mkdtempSync(join(tmpdir(), 'bench-'));
const duck = join(dir, 'f.duckdb');
const reports = join(dir, 'reports');
const datasets = join(dir, 'datasets');

const SQL = {
  orders: 'SELECT count(*) AS n FROM sales.Orders',
  heap: 'SELECT count(*) AS n FROM dbo.HeapFwd',
};

let llm: FakeOpenAI;
let bench: BenchService;

beforeAll(async () => {
  const mdf = join(dir, 'f.mdf');
  writeFileSync(mdf, gunzipSync(readFileSync(join(import.meta.dirname, '../../test/fixtures/mdf/MdfFixture.mdf.gz'))));
  await exportMdfToDuckDb(mdf, duck);
  const { mkdirSync } = await import('node:fs');
  mkdirSync(datasets);
  writeFileSync(
    join(datasets, 'tiny.json'),
    JSON.stringify({
      name: 'tiny',
      database: 'Fixture',
      cases: [
        { id: 'orders', question: 'How many orders are there?', gold: SQL.orders, tags: ['count'], difficulty: 'easy' },
        { id: 'heap', question: 'How many rows does the heap table have?', gold: SQL.heap, tags: ['count', 'heap'] },
      ],
    }),
  );

  // "good" answers each question with its own table; "bad" always counts orders.
  llm = new FakeOpenAI((body) => {
    const msgs = body.messages as { role: string; content: string }[] | undefined;
    if (!msgs) return { content: '' }; // the price catalog request
    const question = msgs.at(-1)!.content;
    const sql = body.model === 'bad' || /orders/i.test(question) ? SQL.orders : SQL.heap;
    return { content: '```sql\n' + sql + '\n```' };
  });
  const base = await llm.start();
  const env = {
    DB_ENGINE: 'duckdb',
    DUCKDB_FILE: duck,
    OPENAI_API_KEY: 'test',
    OPENAI_BASE_URL: base,
    OPENROUTER_BASE_URL: base,
    LLM_PROVIDER: 'openai',
    SCHEMA_CACHE_FILE: join(dir, 'schema.json'),
    LOG_LEVEL: 'error',
  };
  Object.assign(process.env, env);
  bench = new BenchService(
    testConfig({ ...env, BENCH_DATASETS_DIR: datasets, BENCH_REPORTS_DIR: reports, BENCH_MAX_CASE_RUNS: '20' }),
  );
});

afterAll(async () => {
  await bench?.onApplicationShutdown();
  await llm?.stop();
});

async function finished(id: string) {
  for (let i = 0; i < 200; i++) {
    const r = await bench.run(id);
    if (r.status !== 'gold' && r.status !== 'running') return r;
    await new Promise((res) => setTimeout(res, 50));
  }
  throw new Error('run did not finish');
}

describe('BenchService', () => {
  it('lists datasets with their shape and engine compatibility', async () => {
    const [d] = await bench.datasets();
    expect(d).toMatchObject({ file: 'tiny.json', name: 'tiny', cases: 2, tags: { count: 2, heap: 1 }, compatible: true });
  });

  it('benchmarks models side by side, scores them against gold and saves the report', async () => {
    const started = await bench.start({
      dataset: 'tiny.json',
      models: [
        { provider: 'openai', model: 'good' },
        { provider: 'openai', model: 'bad' },
      ],
      repeats: 2,
      concurrency: 2,
      answers: false,
      features: {},
    });
    expect(started.status).toBe('gold');
    await expect(
      bench.start({ dataset: 'tiny.json', models: [{ provider: 'openai', model: 'good' }], repeats: 1, concurrency: 1, answers: false, features: {} }),
    ).rejects.toBeInstanceOf(ConflictException);

    const run = await finished(started.id);
    expect(run.status).toBe('done');
    const acc = Object.fromEntries(run.summaries.map((s) => [s.variant, s.accuracy]));
    expect(acc).toEqual({ good: 1, bad: 0.5 });
    expect(run.results).toHaveLength(8);
    expect(run.results.find((r) => r.variant === 'bad' && r.id === 'heap')).toMatchObject({ verdict: 'wrong' });
    expect(run.flips).toEqual([expect.objectContaining({ id: 'heap', change: 'broken' })]);

    // Saved like a CLI run, listed in history, readable after a restart, deletable.
    expect(existsSync(join(reports, started.id, 'results.json'))).toBe(true);
    const list = await bench.runs();
    expect(list[0]).toMatchObject({ id: started.id, status: 'done', source: 'web', engine: 'duckdb' });
    const fresh = new BenchService(testConfig({ DB_ENGINE: 'duckdb', BENCH_DATASETS_DIR: datasets, BENCH_REPORTS_DIR: reports }));
    const reread = await fresh.run(started.id);
    expect(reread.summaries.map((s) => s.variant)).toEqual(['good', 'bad']);
    expect(reread.request).toMatchObject({ repeats: 2 });
    expect((await fresh.run(started.id, 6)).results).toHaveLength(2);
    await fresh.remove(started.id);
    expect(existsSync(join(reports, started.id))).toBe(false);
  });

  it('refuses runs over the spend cap, with unknown providers, or with no matching cases', async () => {
    const base = { dataset: 'tiny.json', concurrency: 1, answers: false, features: {} } as const;
    await expect(bench.start({ ...base, models: [{ provider: 'openai', model: 'good' }], repeats: 11 })).rejects.toThrow(/BENCH_MAX_CASE_RUNS/);
    await expect(bench.start({ ...base, models: [{ provider: 'openrouter', model: 'x/y' }], repeats: 1 })).rejects.toThrow(/OPENROUTER_API_KEY/);
    await expect(bench.start({ ...base, models: [{ provider: 'openai', model: 'good' }], repeats: 1, filter: 'nothing' })).rejects.toThrow(/No cases/);
    await expect(bench.run('../etc')).rejects.toThrow(/Invalid run id/);
  });

  it('cancels a run', async () => {
    const s = await bench.start({ dataset: 'tiny.json', models: [{ provider: 'openai', model: 'good' }], repeats: 1, concurrency: 1, answers: false, features: {} });
    bench.cancel(s.id);
    expect((await finished(s.id)).status).toBe('cancelled');
  });

  it('asks one question of several models and reports which agree', async () => {
    const r = await bench.compare({
      question: 'How many rows does the heap table have?',
      models: [
        { provider: 'openai', model: 'good' },
        { provider: 'openai', model: 'bad' },
        { provider: 'openai', model: 'good', label: 'good again' },
      ],
      features: {},
    });
    expect(r.results.map((x) => x.sql)).toEqual([SQL.heap, SQL.orders, SQL.heap]);
    expect(r.results[0].usage?.llmCalls).toBeGreaterThan(0);
    expect(r.agreement[0][2]).toBe(true);
    expect(r.agreement[0][1]).toBe(false);
    expect(r.consensus).toEqual([0, 2]);
  });
});

describe('bench helpers', () => {
  it('pins one model for both tiers and applies run-wide pipeline features', () => {
    expect(modelOverrides({ provider: 'openrouter', model: 'a/b', reasoningEffort: 'low' }, { candidates: 3, fewShot: true })).toEqual({
      LLM_PROVIDER: 'openrouter',
      OPENROUTER_MODEL_FAST: 'a/b',
      OPENROUTER_MODEL_SMART: 'a/b',
      LLM_REASONING_EFFORT_FAST: 'low',
      AGENT_REASONING_EFFORT: 'low',
      ASK_SQL_CANDIDATES: '3',
      ASK_FEWSHOT_K: '3',
      EVAL_FEWSHOT: 'dataset',
    });
    expect(modelOverrides({ provider: 'openai', model: 'm', reasoningEffort: 'high' }, { agent: true })).toMatchObject({
      AGENT_REASONING_EFFORT: 'high',
      EVAL_PIPELINE: 'chat',
    });
  });

  it('names variants uniquely', () => {
    expect(
      variantNames([
        { provider: 'openai', model: 'm' },
        { provider: 'openai', model: 'm', reasoningEffort: 'high' },
        { provider: 'openai', model: 'm' },
        { provider: 'openai', model: 'x', label: 'Mine' },
      ]),
    ).toEqual(['m', 'm · high', 'm #2', 'Mine']);
  });

  it('treats extra label columns as agreement, different values as disagreement', () => {
    const q = (cols: string[], rows: unknown[][]) => ({
      result: { columns: cols.map((name) => ({ name, type: 'int' })), rows, rowCount: rows.length, truncated: false, elapsedMs: 1 },
    });
    const r = agreement([q(['n'], [[5]]), q(['label', 'n'], [['x', 5]]), q(['n'], [[6]]), { result: null }]);
    expect(r.agreement[0][1]).toBe(true);
    expect(r.agreement[1][0]).toBe(true);
    expect(r.agreement[0][2]).toBe(false);
    expect(r.agreement[3][0]).toBeNull();
    expect(r.consensus).toEqual([0, 1]);
  });

  it('retries only transient provider errors', () => {
    expect(isTransient('All LLM providers failed: 429 Rate limit reached')).toBe(true);
    expect(isTransient('openai: 503 upstream unavailable')).toBe(true);
    expect(isTransient('Request timed out.')).toBe(true);
    expect(isTransient('openai: 400 Unrecognized request argument supplied: reasoning_effort')).toBe(false);
    expect(isTransient('openai: 404 The model `nope` does not exist')).toBe(false);
  });
});
