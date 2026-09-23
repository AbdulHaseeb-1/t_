import { HttpException } from '@nestjs/common';
import type { QueryResult } from '../database/database.types.js';
import type { UsageSummary } from '../llm/llm.types.js';
import type { AskResponse } from '../query/ask.service.js';
import { compareResults } from '../query/result-compare.js';
import type { EvalCase } from './dataset.js';
import type { Pipeline } from './pipeline.js';

export type Verdict = 'correct' | 'wrong' | 'error';

export type Category =
  | 'correct'
  | 'wrong_rows'
  | 'wrong_columns'
  | 'wrong_values'
  | 'wrong_order'
  | 'false_refusal'
  | 'missed_refusal'
  | 'sql_error'
  | 'unsafe_sql'
  | 'llm_error'
  | 'other_error';

export interface Preview {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
}

export interface CaseResult {
  variant: string;
  repeat: number;
  id: string;
  question: string;
  tags: string[];
  difficulty: string;
  expect: 'result' | 'refusal';
  verdict: Verdict;
  category: Category;
  detail?: string;
  goldSql?: string;
  sql: string | null;
  answer: string | null;
  attempts: number;
  trace?: AskResponse['trace'];
  latencyMs: number;
  llmMs: number;
  dbMs: number;
  usage?: UsageSummary;
  gold?: Preview;
  predicted?: Preview;
}

const PREVIEW_ROWS = 8;

export function preview(r: QueryResult | null | undefined): Preview | undefined {
  if (!r) return undefined;
  return { columns: r.columns.map((c) => c.name), rows: r.rows.slice(0, PREVIEW_ROWS), rowCount: r.rowCount };
}

const MISMATCH: Record<string, Category> = {
  row_count: 'wrong_rows',
  missing_column: 'wrong_columns',
  values: 'wrong_values',
  order: 'wrong_order',
  no_result: 'wrong_rows',
};

function errorCategory(err: unknown): { category: Category; detail: string; sql?: string } {
  const message = (err as Error)?.message ?? String(err);
  if (err instanceof HttpException) {
    const body = err.getResponse() as { code?: string; sql?: string };
    if (body?.code === 'SQL_ERROR') return { category: 'sql_error', detail: message, sql: body.sql };
    if (body?.code === 'UNSAFE_SQL') return { category: 'unsafe_sql', detail: message };
    if (body?.code?.startsWith('LLM')) return { category: 'llm_error', detail: message };
  }
  return { category: 'other_error', detail: message };
}

/** Runs one case through the real ask pipeline and scores it against gold. */
export async function runCase(
  pipeline: Pipeline,
  variant: string,
  repeat: number,
  c: EvalCase,
  gold: QueryResult | undefined,
  withAnswers: boolean,
): Promise<CaseResult> {
  const base = {
    variant,
    repeat,
    id: c.id,
    question: c.question,
    tags: c.tags,
    difficulty: c.difficulty,
    expect: c.expect,
    goldSql: c.gold,
    gold: preview(gold),
  };
  const started = performance.now();
  let res: AskResponse;
  try {
    res = await pipeline.ask.ask({ question: c.question, answer: withAnswers, tier: 'fast', noCache: true });
  } catch (err) {
    const e = errorCategory(err);
    return {
      ...base,
      verdict: 'error',
      category: e.category,
      detail: e.detail,
      sql: e.sql ?? null,
      answer: null,
      attempts: 0,
      latencyMs: Math.round(performance.now() - started),
      llmMs: 0,
      dbMs: 0,
    };
  }

  const common = {
    ...base,
    sql: res.sql,
    answer: res.answer,
    attempts: res.attempts,
    trace: res.trace,
    latencyMs: res.timings.totalMs,
    llmMs: res.timings.llmMs,
    dbMs: res.timings.dbMs,
    usage: res.usage,
    predicted: preview(res.result),
  };
  const refused = res.sql === null;

  if (c.expect === 'refusal') {
    return refused
      ? { ...common, verdict: 'correct', category: 'correct' }
      : {
          ...common,
          verdict: 'wrong',
          category: 'missed_refusal',
          detail: 'answered a question the schema cannot support',
        };
  }
  if (refused) {
    return { ...common, verdict: 'wrong', category: 'false_refusal', detail: res.answer ?? undefined };
  }
  const outcome = compareResults(gold!, res.result, { ordered: c.ordered });
  return outcome.match
    ? { ...common, verdict: 'correct', category: 'correct' }
    : { ...common, verdict: 'wrong', category: MISMATCH[outcome.reason!], detail: outcome.detail };
}

/** Bounded-concurrency map that preserves input order. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, i: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = Array.from({ length: items.length });
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
