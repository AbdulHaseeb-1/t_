import { readdir, readFile, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { AppConfig } from '../config/app-config.js';
import type { QueryResult } from '../database/database.types.js';
import { type Dataset, loadDataset } from '../eval/dataset.js';
import {
  computeGold,
  type EvalReport,
  evalBaseEnv,
  goldFor,
  RunCancelled,
  runEval,
  saveReport,
  selectCases,
  type Variant,
} from '../eval/engine.js';
import { summarize, type VariantSummary } from '../eval/metrics.js';
import { buildPipeline, type Pipeline } from '../eval/pipeline.js';
import type { CaseResult } from '../eval/runner.js';
import type { AskResponse } from '../query/ask.service.js';
import { compareResults } from '../query/result-compare.js';
import { type CompareInput, modelOverrides, type StartRunInput, variantNames } from './bench.dto.js';

export type RunStatus = 'gold' | 'running' | 'done' | 'failed' | 'cancelled';

interface RunState {
  id: string;
  status: RunStatus;
  dataset: string;
  datasetName: string;
  startedAt: string;
  finishedAt?: string;
  error?: string;
  request: StartRunInput;
  variants: Variant[];
  total: number;
  done: Record<string, number>;
  results: CaseResult[];
  report?: EvalReport;
  controller: AbortController;
}

export interface DatasetInfo {
  file: string;
  name: string;
  database: string;
  description?: string;
  cases: number;
  tags: Record<string, number>;
  difficulties: Record<string, number>;
  languages: Record<string, number>;
  /** Gold SQL can run on the server's engine (DuckDB needs cases authored for it). */
  compatible: boolean;
  error?: string;
}

export interface RunListEntry {
  id: string;
  status: RunStatus;
  dataset: string;
  startedAt: string;
  durationS?: number;
  cases: number;
  repeats: number;
  engine?: string;
  source?: string;
  variants: { variant: string; accuracy: number; perQuestionUsd: number; p50Ms: number }[];
}

export interface CompareResult {
  variant: string;
  provider: string;
  model: string;
  sql: string | null;
  answer: string | null;
  result: (Omit<QueryResult, 'rows'> & { rows: unknown[][] }) | null;
  timings?: AskResponse['timings'];
  usage?: AskResponse['usage'];
  trace?: AskResponse['trace'];
  error?: string;
}

const ID = /^[\w.-]+$/;
/** T-SQL syntax DuckDB cannot run; such gold needs a goldDuckdb twin to be graded on DuckDB. */
const TSQL_ONLY = /\bTOP\s*\(?\d|\[\w|\bGETDATE\s*\(|\bDATEADD\s*\(|\bDATEDIFF\s*\(|\bISNULL\s*\(|\bCONVERT\s*\(|\bN'|\bLEN\s*\(|\bCHARINDEX\s*\(/i;
const PLAYGROUND_ROWS = 50;
const MAX_PIPELINES = 8;

/** Runs the evaluation harness for the web bench: one run at a time, live progress, saved like CLI runs. */
@Injectable()
export class BenchService implements OnApplicationShutdown {
  private readonly logger = new Logger(BenchService.name);
  private active?: RunState;
  /** Finished-but-unsaved runs (cancelled, failed) this process has seen. */
  private readonly recent = new Map<string, RunState>();
  private readonly listCache = new Map<string, { mtimeMs: number; entry: RunListEntry }>();
  private readonly pipelines = new Map<string, { pipe: Promise<Pipeline>; busy: number }>();

  constructor(private readonly config: AppConfig) {}

  private get datasetsDir() {
    return resolve(this.config.get('BENCH_DATASETS_DIR'));
  }

  private get reportsDir() {
    return resolve(this.config.get('BENCH_REPORTS_DIR'));
  }

  private get engine(): 'duckdb' | 'mssql' {
    return this.config.get('DB_ENGINE') === 'duckdb' ? 'duckdb' : 'mssql';
  }

  // ── Datasets ──────────────────────────────────────────────────────────

  async datasets(): Promise<DatasetInfo[]> {
    const files = (await readdir(this.datasetsDir).catch(() => [] as string[])).filter((f) => f.endsWith('.json')).sort();
    return Promise.all(
      files.map(async (file): Promise<DatasetInfo> => {
        try {
          const d = await loadDataset(join(this.datasetsDir, file));
          const count = (keys: (string | undefined)[]) =>
            keys.reduce<Record<string, number>>((acc, k) => (k ? ((acc[k] = (acc[k] ?? 0) + 1), acc) : acc), {});
          return {
            file,
            name: d.name,
            database: d.database,
            description: d.description,
            cases: d.cases.length,
            tags: count(d.cases.flatMap((c) => c.tags)),
            difficulties: count(d.cases.map((c) => c.difficulty)),
            languages: count(d.cases.map((c) => c.language ?? 'en')),
            compatible: this.engine === 'mssql' || d.cases.every((c) => !c.gold || c.goldDuckdb || !TSQL_ONLY.test(c.gold)),
          };
        } catch (err) {
          return { file, name: file, database: '', cases: 0, tags: {}, difficulties: {}, languages: {}, compatible: false, error: (err as Error).message };
        }
      }),
    );
  }

  async dataset(file: string): Promise<Dataset> {
    if (!ID.test(file)) throw new BadRequestException('Invalid dataset name');
    try {
      return await loadDataset(join(this.datasetsDir, file.endsWith('.json') ? file : `${file}.json`));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new NotFoundException(`Dataset ${file} not found`);
      throw new BadRequestException((err as Error).message);
    }
  }

  // ── Runs ──────────────────────────────────────────────────────────────

  async start(input: StartRunInput): Promise<ReturnType<BenchService['view']>> {
    if (this.active && (this.active.status === 'gold' || this.active.status === 'running')) {
      throw new ConflictException(`Run ${this.active.id} is still in progress; cancel it or wait for it to finish`);
    }
    const dataset = goldFor(await this.dataset(input.dataset), this.engine);
    let cases;
    try {
      cases = selectCases(dataset, input.filter, input.caseIds);
    } catch (err) {
      throw new BadRequestException(`Invalid filter: ${(err as Error).message}`);
    }
    if (!cases.length) throw new BadRequestException('No cases match the selection');
    const total = cases.length * input.repeats;
    const caseRuns = total * input.models.length;
    const max = this.config.get('BENCH_MAX_CASE_RUNS');
    if (caseRuns > max) {
      throw new BadRequestException(`${caseRuns} case runs exceed BENCH_MAX_CASE_RUNS (${max}); pick fewer cases, repeats or models`);
    }
    for (const m of input.models) {
      const key = m.provider === 'openai' ? 'OPENAI_API_KEY' : 'OPENROUTER_API_KEY';
      if (!this.config.get(key)) throw new BadRequestException(`${key} is not configured on the server, so ${m.model} cannot run`);
    }

    const names = variantNames(input.models);
    const startedAt = new Date();
    const state: RunState = {
      id: `${startedAt.toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${dataset.name}`,
      status: 'gold',
      dataset: input.dataset,
      datasetName: dataset.name,
      startedAt: startedAt.toISOString(),
      request: input,
      variants: input.models.map((m, i) => [names[i], modelOverrides(m, input.features)]),
      total,
      done: Object.fromEntries(names.map((n) => [n, 0])),
      results: [],
      controller: new AbortController(),
    };
    this.active = state;
    void this.execute(state, dataset, cases);
    return this.view(state);
  }

  private async execute(state: RunState, dataset: Dataset, cases: Dataset['cases']): Promise<void> {
    const { request } = state;
    const signal = state.controller.signal;
    try {
      const baseEnv = evalBaseEnv(dataset, process.env);
      const { gold, problems } = await computeGold(cases, baseEnv);
      if (problems.length) {
        const list = problems.slice(0, 5).map((p) => `${p.id}: ${p.problem}${p.detail ? ` (${p.detail})` : ''}`);
        throw new Error(
          `${problems.length} gold ${problems.length === 1 ? 'query' : 'queries'} failed on ${dataset.database} (${this.engine}): ${list.join('; ')}`,
        );
      }
      if (signal.aborted) throw new RunCancelled();
      state.status = 'running';
      const report = await runEval({
        dataset,
        cases,
        variants: state.variants,
        repeats: request.repeats,
        concurrency: request.concurrency,
        answers: request.answers,
        baseEnv,
        gold,
        signal,
        source: 'web',
        onProgress: ({ variant, result }) => {
          state.done[variant] = (state.done[variant] ?? 0) + 1;
          state.results.push(result);
        },
      });
      report.request = request;
      state.report = report;
      state.results = report.results;
      await saveReport(report, this.reportsDir, state.id);
      state.status = 'done';
    } catch (err) {
      state.status = err instanceof RunCancelled || signal.aborted ? 'cancelled' : 'failed';
      if (state.status === 'failed') {
        state.error = (err as Error).message;
        this.logger.warn(`Bench run ${state.id} failed: ${state.error}`);
      }
      this.recent.set(state.id, state);
    } finally {
      state.finishedAt = new Date().toISOString();
    }
  }

  cancel(id: string) {
    const s = this.active?.id === id ? this.active : undefined;
    if (!s) throw new NotFoundException(`Run ${id} is not running`);
    if (s.status === 'gold' || s.status === 'running') s.controller.abort();
    return this.view(s);
  }

  /** A run as the UI needs it; `since` returns only results after that index (live polling). */
  view(s: RunState, since = 0) {
    const summaries: VariantSummary[] =
      s.report?.summaries ??
      s.variants
        .map(([name, overrides]) => ({ name, overrides, rs: s.results.filter((r) => r.variant === name) }))
        .filter((v) => v.rs.length)
        .map((v) => summarize(v.name, v.overrides, v.rs));
    return {
      id: s.id,
      status: s.status,
      dataset: s.dataset,
      datasetName: s.datasetName,
      startedAt: s.startedAt,
      finishedAt: s.finishedAt,
      error: s.error,
      request: s.request,
      engine: this.engine,
      variants: s.variants.map(([name]) => name),
      progress: { total: s.total, done: s.done },
      summaries,
      flips: s.report?.flips ?? [],
      info: s.report?.info,
      resultCount: s.results.length,
      results: s.results.slice(since),
    };
  }

  async run(id: string, since = 0) {
    if (!ID.test(id)) throw new BadRequestException('Invalid run id');
    const live = this.active?.id === id ? this.active : this.recent.get(id);
    if (live) return this.view(live, since);
    const report = await this.readReport(id);
    return {
      id,
      status: 'done' as RunStatus,
      dataset: report.info.dataset,
      datasetName: report.info.dataset,
      startedAt: report.info.startedAt,
      finishedAt: new Date(Date.parse(report.info.startedAt) + report.info.durationS * 1000).toISOString(),
      request: report.request,
      engine: report.info.engine,
      variants: report.summaries.map((s) => s.variant),
      progress: {
        total: report.info.cases * report.info.repeats,
        done: Object.fromEntries(report.summaries.map((s) => [s.variant, report.info.cases * report.info.repeats])),
      },
      summaries: report.summaries,
      flips: report.flips,
      info: report.info,
      resultCount: report.results.length,
      results: report.results.slice(since),
    };
  }

  private async readReport(id: string): Promise<EvalReport> {
    try {
      return JSON.parse(await readFile(join(this.reportsDir, id, 'results.json'), 'utf8')) as EvalReport;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new NotFoundException(`Run ${id} not found`);
      throw err;
    }
  }

  /** Every saved report (CLI and web) plus runs still in memory, newest first. */
  async runs(): Promise<RunListEntry[]> {
    const entries: RunListEntry[] = [];
    const memory = [...(this.active ? [this.active] : []), ...this.recent.values()];
    const seen = new Set<string>();
    for (const s of memory) {
      if (s.status === 'done') continue; // listed from disk below
      seen.add(s.id);
      const v = this.view(s);
      entries.push({
        id: s.id,
        status: s.status,
        dataset: s.datasetName,
        startedAt: s.startedAt,
        cases: s.total / s.request.repeats,
        repeats: s.request.repeats,
        engine: this.engine,
        source: 'web',
        variants: v.summaries.map((x) => ({ variant: x.variant, accuracy: x.accuracy, perQuestionUsd: x.cost.perQuestionUsd, p50Ms: x.latency.p50Ms })),
      });
    }
    const dirs = await readdir(this.reportsDir).catch(() => [] as string[]);
    await Promise.all(
      dirs
        .filter((d) => ID.test(d) && !seen.has(d))
        .map(async (d) => {
          const file = join(this.reportsDir, d, 'results.json');
          const st = await stat(file).catch(() => undefined);
          if (!st) return;
          const hit = this.listCache.get(d);
          if (hit && hit.mtimeMs === st.mtimeMs) return entries.push(hit.entry);
          try {
            const r = JSON.parse(await readFile(file, 'utf8')) as EvalReport;
            const entry: RunListEntry = {
              id: d,
              status: 'done',
              dataset: r.info.dataset,
              startedAt: r.info.startedAt,
              durationS: r.info.durationS,
              cases: r.info.cases,
              repeats: r.info.repeats,
              engine: r.info.engine,
              source: r.info.source ?? 'cli',
              variants: r.summaries.map((x) => ({ variant: x.variant, accuracy: x.accuracy, perQuestionUsd: x.cost.perQuestionUsd, p50Ms: x.latency.p50Ms })),
            };
            this.listCache.set(d, { mtimeMs: st.mtimeMs, entry });
            entries.push(entry);
          } catch {
            // Not a report (or half-written): skip.
          }
        }),
    );
    return entries.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  async remove(id: string): Promise<void> {
    if (!ID.test(id)) throw new BadRequestException('Invalid run id');
    if (this.active?.id === id && (this.active.status === 'gold' || this.active.status === 'running')) {
      throw new ConflictException('Cancel the run before deleting it');
    }
    if (this.recent.delete(id) || this.active?.id === id) {
      if (this.active?.id === id) this.active = undefined;
    }
    await rm(join(this.reportsDir, id), { recursive: true, force: true });
    this.listCache.delete(id);
  }

  // ── Playground: one question, several models, side by side ────────────

  async compare(input: CompareInput) {
    for (const m of input.models) {
      const key = m.provider === 'openai' ? 'OPENAI_API_KEY' : 'OPENROUTER_API_KEY';
      if (!this.config.get(key)) throw new BadRequestException(`${key} is not configured on the server, so ${m.model} cannot run`);
    }
    const names = variantNames(input.models);
    // Full results for the agreement check; only a preview goes back to the browser.
    const full: (QueryResult | null)[] = [];
    const results = await Promise.all(
      input.models.map(async (m, i): Promise<CompareResult> => {
        const base = { variant: names[i], provider: m.provider, model: m.model };
        const entry = this.pipeline(modelOverrides(m, input.features));
        entry.busy++;
        try {
          const pipe = await entry.pipe;
          const r = await pipe.ask.ask({
            question: input.question,
            context: [],
            language: 'auto',
            answer: true,
            tier: 'fast',
            noCache: true,
          });
          full[i] = r.result;
          return {
            ...base,
            sql: r.sql,
            answer: r.answer,
            result: r.result ? { ...r.result, rows: r.result.rows.slice(0, PLAYGROUND_ROWS) } : null,
            timings: r.timings,
            usage: r.usage,
            trace: r.trace,
          };
        } catch (err) {
          const body = (err as { getResponse?: () => unknown }).getResponse?.() as { sql?: string } | undefined;
          full[i] = null;
          return { ...base, sql: body?.sql ?? null, answer: null, result: null, error: (err as Error).message };
        } finally {
          entry.busy--;
        }
      }),
    );
    return { question: input.question, results, ...agreement(full.map((result) => ({ result }))) };
  }

  /** One pipeline per model setting, reused across playground questions (bounded, idle ones evicted). */
  private pipeline(overrides: Record<string, string>) {
    const key = JSON.stringify(Object.entries(overrides).sort());
    const hit = this.pipelines.get(key);
    if (hit) {
      this.pipelines.delete(key);
      this.pipelines.set(key, hit);
      return hit;
    }
    const { EVAL_FEWSHOT: _unused, ...env } = overrides;
    const pipe = (async () => {
      const p = buildPipeline({ ...process.env, CACHE_SQL_TTL_S: '0', CACHE_ANSWER_TTL_S: '0', ...env });
      // Reuse the server's schema cache instead of introspecting again.
      await p.catalog.onModuleInit();
      return p;
    })();
    const entry = { pipe, busy: 0 };
    this.pipelines.set(key, entry);
    for (const [k, e] of this.pipelines) {
      if (this.pipelines.size <= MAX_PIPELINES) break;
      if (e.busy === 0 && k !== key) {
        this.pipelines.delete(k);
        void e.pipe.then((p) => p.close()).catch(() => undefined);
      }
    }
    return entry;
  }

  async onApplicationShutdown(): Promise<void> {
    this.active?.controller.abort();
    await Promise.all([...this.pipelines.values()].map((e) => e.pipe.then((p) => p.close()).catch(() => undefined)));
  }
}

/**
 * Which models returned the same data. Two results agree when either one's
 * columns and rows are all found in the other (extra label columns allowed).
 */
export function agreement(results: { result: QueryResult | null }[]): { agreement: (boolean | null)[][]; consensus: number[] } {
  const n = results.length;
  const m: (boolean | null)[][] = Array.from({ length: n }, () => Array<boolean | null>(n).fill(null));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const a = results[i].result;
      const b = results[j].result;
      if (!a || !b) continue;
      if (i === j) {
        m[i][j] = true;
        continue;
      }
      m[i][j] = compareResults(a, b).match || compareResults(b, a).match;
    }
  }
  // Largest group of mutually agreeing models (n <= 6, so try every subset).
  let consensus: number[] = [];
  for (let mask = 1; mask < 1 << n; mask++) {
    const members = [...Array(n).keys()].filter((i) => mask & (1 << i));
    if (members.length <= consensus.length) continue;
    if (members.every((i) => members.every((j) => m[i][j] === true))) consensus = members;
  }
  return { agreement: m, consensus: consensus.length > 1 ? consensus : [] };
}
