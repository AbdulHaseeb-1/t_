import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { Logger } from '@nestjs/common';
import sql from 'mssql';
import type { QueryResult } from '../database/database.types.js';
import { type Dataset, type EvalCase, loadDataset } from './dataset.js';
import { flips, summarize, type Flip, type VariantSummary } from './metrics.js';
import { buildPipeline } from './pipeline.js';
import { renderHtml } from './report-html.js';
import { renderMarkdown, type RunInfo } from './report-markdown.js';
import { type CaseResult, mapLimit, runCase } from './runner.js';

const HELP = `Text-to-SQL evaluation harness

Usage: pnpm eval [options]

  --dataset <file>       Dataset JSON (default eval/datasets/retail.json)
  --variant <spec>       name:KEY=VAL,KEY=VAL  (repeatable; default: current settings)
  --preset ablation      Baseline plus each accuracy feature, then all combined
  --repeat <n>           Run every case n times (stability, pass@k)      [1]
  --concurrency <n>      Cases in flight per variant                    [4]
  --filter <regex>       Only case ids or tags matching the pattern
  --answers              Also generate natural-language answers (2x LLM calls)
  --seed                 (Re)create the dataset's fixture database first
  --check                Validate gold SQL only (no LLM calls)
  --out <dir>            Report directory                               [eval/reports]
`;

/** Standard ablation: each accuracy feature measured alone against a bare baseline. */
const ABLATION: Record<string, Record<string, string>> = {
  baseline: {
    SCHEMA_VALUE_HINTS: 'false',
    ASK_EMPTY_RESULT_RECHECK: 'false',
    ASK_FEWSHOT_K: '0',
    ASK_SQL_CANDIDATES: '1',
  },
  'value-hints': { SCHEMA_VALUE_HINTS: 'true', ASK_EMPTY_RESULT_RECHECK: 'false', ASK_FEWSHOT_K: '0' },
  'empty-recheck': { SCHEMA_VALUE_HINTS: 'false', ASK_EMPTY_RESULT_RECHECK: 'true', ASK_FEWSHOT_K: '0' },
  'few-shot': {
    SCHEMA_VALUE_HINTS: 'false',
    ASK_EMPTY_RESULT_RECHECK: 'false',
    ASK_FEWSHOT_K: '3',
    EVAL_FEWSHOT: 'dataset',
  },
  'vote-3': {
    SCHEMA_VALUE_HINTS: 'false',
    ASK_EMPTY_RESULT_RECHECK: 'false',
    ASK_FEWSHOT_K: '0',
    ASK_SQL_CANDIDATES: '3',
  },
  default: {},
  'default+few-shot': { ASK_FEWSHOT_K: '3', EVAL_FEWSHOT: 'dataset' },
};

function parseVariant(spec: string): [string, Record<string, string>] {
  const idx = spec.indexOf(':');
  const name = idx === -1 ? spec : spec.slice(0, idx);
  const body = idx === -1 ? '' : spec.slice(idx + 1);
  const overrides: Record<string, string> = {};
  for (const pair of body.split(',').filter(Boolean)) {
    const eq = pair.indexOf('=');
    if (eq === -1) throw new Error(`Bad variant override "${pair}" (expected KEY=VALUE)`);
    overrides[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return [name, overrides];
}

function loadEnvFiles(): void {
  for (const f of ['.env', '../../.env']) {
    try {
      process.loadEnvFile(f);
    } catch {
      // optional
    }
  }
}

async function seed(dataset: Dataset, datasetPath: string): Promise<void> {
  if (!dataset.fixture) throw new Error(`Dataset "${dataset.name}" has no fixture to seed from`);
  const fixture = await readFile(resolve(datasetPath, '..', dataset.fixture), 'utf8');
  const base = {
    server: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 1433),
    user: process.env.EVAL_ADMIN_USER ?? process.env.DB_USER ?? 'sa',
    password: process.env.EVAL_ADMIN_PASSWORD ?? process.env.DB_PASSWORD ?? '',
    options: { encrypt: false, trustServerCertificate: true },
    requestTimeout: 300_000,
  };
  const db = dataset.database.replace(/]/g, ']]');
  const admin = await new sql.ConnectionPool({ ...base, database: 'master' }).connect();
  await admin
    .request()
    .batch(
      `IF DB_ID(N'${db}') IS NOT NULL BEGIN ALTER DATABASE [${db}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${db}]; END; CREATE DATABASE [${db}];`,
    );
  await admin.close();
  const target = await new sql.ConnectionPool({ ...base, database: dataset.database }).connect();
  await target.request().batch(fixture);
  await target.close();
  console.log(`Seeded ${dataset.database} from ${dataset.fixture}`);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      dataset: { type: 'string', default: 'eval/datasets/retail.json' },
      variant: { type: 'string', multiple: true },
      preset: { type: 'string' },
      repeat: { type: 'string', default: '1' },
      concurrency: { type: 'string', default: '4' },
      filter: { type: 'string' },
      answers: { type: 'boolean', default: false },
      seed: { type: 'boolean', default: false },
      check: { type: 'boolean', default: false },
      out: { type: 'string', default: 'eval/reports' },
      verbose: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) {
    console.log(HELP);
    return;
  }
  loadEnvFiles();
  Logger.overrideLogger(values.verbose ? ['error', 'warn', 'log'] : ['error']);

  const datasetPath = resolve(values.dataset!);
  const dataset = await loadDataset(datasetPath);
  if (values.seed) await seed(dataset, datasetPath);

  const filter = values.filter ? new RegExp(values.filter, 'i') : undefined;
  const cases = dataset.cases.filter(
    (c) => !filter || filter.test(c.id) || c.tags.some((t) => filter.test(t)),
  );
  const repeats = Math.max(1, Number(values.repeat));
  const concurrency = Math.max(1, Number(values.concurrency));

  const variants: [string, Record<string, string>][] =
    values.preset === 'ablation'
      ? Object.entries(ABLATION)
      : values.variant?.length
        ? values.variant.map(parseVariant)
        : [['default', {}]];

  const baseEnv = {
    ...process.env,
    NODE_ENV: 'test',
    DB_NAME: dataset.database,
    DB_MAX_ROWS: '5000',
    CACHE_SQL_TTL_S: '0',
    CACHE_ANSWER_TTL_S: '0',
    EXAMPLES_FILE: '.cache/eval-no-examples.json',
  };

  // Gold results once, shared by every variant.
  const goldPipe = buildPipeline({
    ...baseEnv,
    SCHEMA_VALUE_HINTS: 'false',
    SCHEMA_CACHE_FILE: '.cache/eval-gold.json',
  });
  const gold = new Map<string, QueryResult>();
  let goldProblems = 0;
  for (const c of cases.filter((x) => x.gold)) {
    try {
      const r = await goldPipe.db.readOnlyQuery(c.gold!, 5000);
      gold.set(c.id, r);
      const flag = r.truncated ? 'TRUNCATED' : r.rowCount === 0 ? 'EMPTY' : '';
      if (flag) goldProblems++;
      if (values.check || flag) {
        const first = r.rows[0] ? JSON.stringify(r.rows[0]).slice(0, 90) : '';
        console.log(
          `${c.id.padEnd(6)} ${String(r.rowCount).padStart(5)} rows × ${r.columns.length} cols ${flag.padEnd(9)} ${first}`,
        );
      }
    } catch (err) {
      goldProblems++;
      console.log(`${c.id.padEnd(6)} GOLD SQL FAILED: ${(err as Error).message}`);
    }
  }
  await goldPipe.close();
  if (values.check) {
    console.log(`\n${cases.length} cases, ${goldProblems} problem(s).`);
    process.exitCode = goldProblems ? 1 : 0;
    return;
  }
  if (goldProblems)
    throw new Error(`${goldProblems} gold queries failed or returned no rows; run with --check`);

  const startedAt = new Date();
  const results: CaseResult[] = [];
  const summaries: VariantSummary[] = [];
  const models = new Set<string>();

  for (const [name, overrides] of variants) {
    const { EVAL_FEWSHOT, ...envOverrides } = overrides;
    const pipe = buildPipeline({
      ...baseEnv,
      ...envOverrides,
      SCHEMA_CACHE_FILE: `.cache/eval-${name}.json`,
    });
    if (!pipe.llm.configured)
      throw new Error('No LLM API key configured (OPENAI_API_KEY / OPENROUTER_API_KEY)');
    await pipe.catalog.refresh();
    if (EVAL_FEWSHOT === 'dataset') {
      // Leave-one-out: the store never returns an example whose question equals the one being asked.
      pipe.examples.replaceAll(
        dataset.cases.filter((c) => c.gold).map((c) => ({ question: c.question, sql: c.gold! })),
      );
    }

    const t0 = performance.now();
    const variantResults: CaseResult[] = [];
    for (let k = 0; k < repeats; k++) {
      const batch = await mapLimit(cases, concurrency, async (c: EvalCase) => {
        let r = await runCase(pipe, name, k, c, gold.get(c.id), values.answers!);
        // Rate limits and outages are not accuracy: back off and retry before recording.
        for (let retry = 1; r.category === 'llm_error' && retry <= 3; retry++) {
          await new Promise((res) => setTimeout(res, 15_000 * retry));
          r = await runCase(pipe, name, k, c, gold.get(c.id), values.answers!);
        }
        process.stdout.write(r.verdict === 'correct' ? '.' : r.verdict === 'wrong' ? 'x' : 'E');
        return r;
      });
      variantResults.push(...batch);
    }
    await pipe.close();
    for (const r of variantResults) for (const m of r.usage?.models ?? []) models.add(m);
    const s = summarize(name, overrides, variantResults);
    summaries.push(s);
    results.push(...variantResults);
    console.log(
      `  ${name.padEnd(18)} ${(s.accuracy * 100).toFixed(1).padStart(5)}%  p50 ${(s.latency.p50Ms / 1000).toFixed(1)}s  $${s.cost.totalUsd.toFixed(4)}  (${((performance.now() - t0) / 1000).toFixed(0)}s)` +
        (s.infraErrors ? `  WARNING: ${s.infraErrors} infra error(s) excluded` : ''),
    );
  }

  const flipList: Flip[] = summaries.slice(1).flatMap((s) => flips(summaries[0].variant, s.variant, results));
  const info: RunInfo = {
    dataset: dataset.name,
    database: dataset.database,
    startedAt: startedAt.toISOString(),
    durationS: (Date.now() - startedAt.getTime()) / 1000,
    repeats,
    cases: cases.length,
    models: [...models],
    withAnswers: values.answers!,
  };

  const stamp = startedAt.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dir = join(values.out!, `${stamp}-${dataset.name}`);
  await mkdir(dir, { recursive: true });
  const markdown = renderMarkdown(info, summaries, flipList, results);
  await writeFile(
    join(dir, 'results.json'),
    JSON.stringify({ info, summaries, flips: flipList, results }, null, 2),
  );
  await writeFile(join(dir, 'report.md'), markdown);
  await writeFile(join(dir, 'report.html'), await renderHtml(info, summaries, flipList, results));
  console.log(`\nReports: ${dir}/report.html  report.md  results.json`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
