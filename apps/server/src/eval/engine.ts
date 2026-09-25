import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { QueryResult } from '../database/database.types.js';
import type { Dataset, EvalCase } from './dataset.js';
import { flips, summarize, type Flip, type VariantSummary } from './metrics.js';
import { buildPipeline } from './pipeline.js';
import { renderText, type RunInfo } from './report-text.js';
import { type CaseResult, mapLimit, runCase } from './runner.js';

export type Variant = [name: string, overrides: Record<string, string>];

export interface GoldProblem {
  id: string;
  problem: 'failed' | 'empty' | 'truncated';
  detail?: string;
}

export interface GoldRow {
  id: string;
  rowCount: number;
  columns: number;
  firstRow?: unknown[];
  problem?: GoldProblem['problem'];
  detail?: string;
}

export interface EvalReport {
  info: RunInfo;
  summaries: VariantSummary[];
  flips: Flip[];
  results: CaseResult[];
  /** What the web bench asked for (models, repeats, features), so a run can be repeated. */
  request?: unknown;
}

export interface Progress {
  variant: string;
  done: number;
  total: number;
  result: CaseResult;
}

export interface RunOptions {
  dataset: Dataset;
  cases: EvalCase[];
  variants: Variant[];
  repeats: number;
  concurrency: number;
  answers: boolean;
  /** Environment every variant starts from (process env plus the eval defaults). */
  baseEnv: Record<string, string | undefined>;
  gold: Map<string, QueryResult>;
  signal?: AbortSignal;
  onProgress?: (p: Progress) => void;
  /** Called once a variant has finished, with its summary. */
  onVariant?: (s: VariantSummary) => void;
  /** Delay before re-running a case that hit a provider error (rate limit, outage). */
  retryDelayMs?: number;
  /** Extra fields recorded in the report header (e.g. who started the run). */
  source?: RunInfo['source'];
}

export class RunCancelled extends Error {
  constructor() {
    super('Run cancelled');
  }
}

/** The environment an eval pipeline runs with: no caches, the dataset's database, room for gold-sized results. */
export function evalBaseEnv(dataset: Dataset, env: Record<string, string | undefined> = process.env) {
  return {
    ...env,
    NODE_ENV: 'test',
    DB_NAME: dataset.database,
    DB_MAX_ROWS: '5000',
    CACHE_SQL_TTL_S: '0',
    CACHE_ANSWER_TTL_S: '0',
    EXAMPLES_FILE: '.cache/eval-no-examples.json',
  };
}

/** Gold SQL is written for the engine under test: DuckDB cases carry their own dialect. */
export function goldFor(dataset: Dataset, engine: string | undefined): Dataset {
  if (engine !== 'duckdb') return dataset;
  return { ...dataset, cases: dataset.cases.map((c) => ({ ...c, gold: c.goldDuckdb ?? c.gold })) };
}

export function selectCases(dataset: Dataset, filter?: string, ids?: string[]): EvalCase[] {
  const re = filter ? new RegExp(filter, 'i') : undefined;
  const wanted = ids?.length ? new Set(ids) : undefined;
  return dataset.cases.filter(
    (c) => (!wanted || wanted.has(c.id)) && (!re || re.test(c.id) || c.tags.some((t) => re.test(t))),
  );
}

/** Runs every gold query once; the results are the ground truth shared by all variants. */
export async function computeGold(
  cases: EvalCase[],
  baseEnv: Record<string, string | undefined>,
): Promise<{ gold: Map<string, QueryResult>; rows: GoldRow[]; problems: GoldProblem[] }> {
  const pipe = buildPipeline({ ...baseEnv, SCHEMA_VALUE_HINTS: 'false', SCHEMA_CACHE_FILE: '.cache/eval-gold.json' });
  const gold = new Map<string, QueryResult>();
  const rows: GoldRow[] = [];
  const problems: GoldProblem[] = [];
  try {
    for (const c of cases.filter((x) => x.gold)) {
      try {
        const r = await pipe.db.readOnlyQuery(c.gold!, 5000);
        gold.set(c.id, r);
        const problem = r.truncated ? 'truncated' : r.rowCount === 0 ? 'empty' : undefined;
        if (problem) problems.push({ id: c.id, problem });
        rows.push({ id: c.id, rowCount: r.rowCount, columns: r.columns.length, firstRow: r.rows[0], problem });
      } catch (err) {
        const detail = (err as Error).message;
        problems.push({ id: c.id, problem: 'failed', detail });
        rows.push({ id: c.id, rowCount: 0, columns: 0, problem: 'failed', detail });
      }
    }
  } finally {
    await pipe.close();
  }
  return { gold, rows, problems };
}

/**
 * Runs every variant over the cases through the production ask pipeline and
 * scores each answer against gold. Used by the CLI and the web bench alike, so
 * both measure exactly the same thing.
 */
export async function runEval(o: RunOptions): Promise<EvalReport> {
  const startedAt = new Date();
  const results: CaseResult[] = [];
  const summaries: VariantSummary[] = [];
  const models = new Set<string>();
  const total = o.cases.length * o.repeats;
  const retryDelay = o.retryDelayMs ?? 15_000;
  const check = () => {
    if (o.signal?.aborted) throw new RunCancelled();
  };

  for (const [name, overrides] of o.variants) {
    check();
    const { EVAL_FEWSHOT, ...envOverrides } = overrides;
    const pipe = buildPipeline({
      ...o.baseEnv,
      ...envOverrides,
      SCHEMA_CACHE_FILE: `.cache/eval-${name.replace(/[^\w.-]+/g, '_')}.json`,
    });
    const variantResults: CaseResult[] = [];
    try {
      if (!pipe.llm.configured) throw new Error('No LLM API key configured (OPENAI_API_KEY / OPENROUTER_API_KEY)');
      await pipe.catalog.refresh();
      if (EVAL_FEWSHOT === 'dataset') {
        // Leave-one-out: the store never returns an example whose question equals the one being asked.
        pipe.examples.replaceAll(o.dataset.cases.filter((c) => c.gold).map((c) => ({ question: c.question, sql: c.gold! })));
      }
      let done = 0;
      for (let k = 0; k < o.repeats; k++) {
        await mapLimit(o.cases, o.concurrency, async (c: EvalCase) => {
          check();
          let r = await runCase(pipe, name, k, c, o.gold.get(c.id), o.answers);
          // Rate limits and outages are not accuracy: back off and retry before recording.
          for (let retry = 1; r.category === 'llm_error' && retry <= 3 && !o.signal?.aborted; retry++) {
            await sleep(retryDelay * retry, o.signal);
            r = await runCase(pipe, name, k, c, o.gold.get(c.id), o.answers);
          }
          variantResults.push(r);
          o.onProgress?.({ variant: name, done: ++done, total, result: r });
          return r;
        });
      }
    } finally {
      await pipe.close();
    }
    // Keep dataset order (cases finish out of order under concurrency).
    const order = new Map(o.cases.map((c, i) => [c.id, i]));
    variantResults.sort((a, b) => a.repeat - b.repeat || order.get(a.id)! - order.get(b.id)!);
    for (const r of variantResults) for (const m of r.usage?.models ?? []) models.add(m);
    const s = summarize(name, overrides, variantResults);
    summaries.push(s);
    results.push(...variantResults);
    o.onVariant?.(s);
  }

  const flipList = summaries.slice(1).flatMap((s) => flips(summaries[0].variant, s.variant, results));
  const info: RunInfo = {
    dataset: o.dataset.name,
    database: o.dataset.database,
    startedAt: startedAt.toISOString(),
    durationS: (Date.now() - startedAt.getTime()) / 1000,
    repeats: o.repeats,
    cases: o.cases.length,
    models: [...models],
    withAnswers: o.answers,
    engine: o.baseEnv.DB_ENGINE === 'duckdb' ? 'duckdb' : 'mssql',
    source: o.source ?? 'cli',
  };
  return { info, summaries, flips: flipList, results };
}

/** Report directory name: 2026-09-24T17-54-25-mds-epd. */
export function reportName(info: { startedAt: string; dataset: string }): string {
  return `${info.startedAt.replace(/[:.]/g, '-').slice(0, 19)}-${info.dataset}`;
}

/** Writes results.json and report.txt; returns the report directory. */
export async function saveReport(report: EvalReport, outDir: string, name = reportName(report.info)): Promise<string> {
  const dir = join(outDir, name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'results.json'), JSON.stringify(report, null, 2));
  await writeFile(join(dir, 'report.txt'), renderText(report.info, report.summaries, report.flips, report.results));
  return dir;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}
