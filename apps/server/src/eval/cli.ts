import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { Logger } from '@nestjs/common';
import sql from 'mssql';
import { type Dataset, loadDataset } from './dataset.js';
import { computeGold, evalBaseEnv, goldFor, runEval, saveReport, selectCases, type Variant } from './engine.js';
import { renderText } from './report-text.js';

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

function parseVariant(spec: string): Variant {
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
  const dataset = goldFor(await loadDataset(datasetPath), process.env.DB_ENGINE);
  if (values.seed) await seed(dataset, datasetPath);

  const cases = selectCases(dataset, values.filter);
  const repeats = Math.max(1, Number(values.repeat));
  const concurrency = Math.max(1, Number(values.concurrency));

  const variants: Variant[] =
    values.preset === 'ablation'
      ? Object.entries(ABLATION)
      : values.variant?.length
        ? values.variant.map(parseVariant)
        : [['default', {}]];

  const baseEnv = evalBaseEnv(dataset);
  const { gold, rows, problems } = await computeGold(cases, baseEnv);
  for (const r of rows) {
    if (!values.check && !r.problem) continue;
    if (r.problem === 'failed') {
      console.log(`${r.id.padEnd(6)} GOLD SQL FAILED: ${r.detail}`);
      continue;
    }
    const first = r.firstRow ? JSON.stringify(r.firstRow).slice(0, 90) : '';
    const flag = r.problem ? r.problem.toUpperCase() : '';
    console.log(`${r.id.padEnd(6)} ${String(r.rowCount).padStart(5)} rows × ${r.columns} cols ${flag.padEnd(9)} ${first}`);
  }
  if (values.check) {
    console.log(`\n${cases.length} cases, ${problems.length} problem(s).`);
    process.exitCode = problems.length ? 1 : 0;
    return;
  }
  if (problems.length) throw new Error(`${problems.length} gold queries failed or returned no rows; run with --check`);

  let t0 = performance.now();
  const report = await runEval({
    dataset,
    cases,
    variants,
    repeats,
    concurrency,
    answers: values.answers!,
    baseEnv,
    gold,
    onProgress: ({ result }) =>
      process.stdout.write(result.verdict === 'correct' ? '.' : result.verdict === 'wrong' ? 'x' : 'E'),
    onVariant: (s) => {
      console.log(
        `  ${s.variant.padEnd(18)} ${(s.accuracy * 100).toFixed(1).padStart(5)}%  p50 ${(s.latency.p50Ms / 1000).toFixed(1)}s  $${s.cost.totalUsd.toFixed(4)}  (${((performance.now() - t0) / 1000).toFixed(0)}s)` +
          (s.infraErrors ? `  WARNING: ${s.infraErrors} infra error(s) excluded` : ''),
      );
      t0 = performance.now();
    },
  });

  const dir = await saveReport(report, values.out!);
  console.log(`\n\n${renderText(report.info, report.summaries, report.flips, report.results)}`);
  console.log(`Saved: ${dir}/report.txt and results.json`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
