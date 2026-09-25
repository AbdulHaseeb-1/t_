import type { QueryResult } from '../../database/database.types.js';

/** How the app should present a result; chosen by the model from what the person asked. */
export type View = 'number' | 'table' | 'chart';
export type ChartKind = 'line' | 'column' | 'bar' | 'donut';

export interface Display {
  view: View;
  chart?: ChartKind;
}

export type ToolName = 'run_sql' | 'search_schema' | 'describe_tables' | 'column_values';

/** One tool call, for the progress UI and diagnostics. */
export interface AgentStep {
  tool: ToolName;
  /** run_sql: the result heading; other tools: what was looked up. */
  label: string;
  ok: boolean;
  sql?: string;
  resultId?: string;
  rowCount?: number;
  elapsedMs?: number;
  error?: string;
}

/** A run_sql call: `display` null = an intermediate query the person does not see. */
export interface QueryRecord {
  id: string;
  title: string;
  sql: string;
  display: Display | null;
  result?: QueryResult;
  error?: string;
}

/** A result the app shows under the answer. */
export interface ShownResult {
  id: string;
  title: string;
  sql: string;
  result: QueryResult;
  display: Display;
}

export type ChatStage = 'thinking' | 'listening' | 'reading' | 'schema' | 'query';

/** Server-sent events of a streamed chat answer, in order: status/step*, delta/reset*, then done or error. */
export type ChatEvent<TDone = unknown> =
  | { type: 'status'; stage: ChatStage; label?: string }
  | { type: 'step'; step: AgentStep }
  | { type: 'delta'; text: string }
  /** Text streamed so far was a preamble to tool calls, not the answer: discard it. */
  | { type: 'reset' }
  | { type: 'done'; response: TDone }
  | { type: 'error'; status: number; message: string };

export type Emit = (event: ChatEvent) => void;

/** Most results shown under one answer. */
const MAX_SHOWN = 3;

/** Per-request state the tools write to (the Agents SDK run context). */
export class AnalystRun {
  readonly queries: QueryRecord[] = [];
  readonly steps: AgentStep[] = [];
  dbMs = 0;

  constructor(readonly emit: Emit = () => undefined) {}

  /** Ids are taken synchronously, so parallel tool calls get distinct, ordered ids. */
  addQuery(q: Omit<QueryRecord, 'id'>): QueryRecord {
    const record = { id: `r${this.queries.length + 1}`, ...q };
    this.queries.push(record);
    return record;
  }

  step(s: AgentStep): void {
    this.steps.push(s);
    this.emit({ type: 'step', step: s });
  }

  /**
   * Results the person sees, in query order. A displayed query that returned
   * nothing and was followed by another displayed one was a failed attempt.
   */
  shown(): ShownResult[] {
    const displayed = this.queries.filter(
      (q): q is QueryRecord & { result: QueryResult; display: Display } => !!q.display && !!q.result,
    );
    const kept = displayed.filter((q, i) => q.result.rowCount > 0 || i === displayed.length - 1);
    return kept.slice(-MAX_SHOWN).map(({ id, title, sql, result, display }) => ({ id, title, sql, result, display }));
  }
}
