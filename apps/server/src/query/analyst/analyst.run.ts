import type { QueryResult } from '../../database/database.types.js';

/** How the app should present a result; chosen by the model from what the person asked. */
export type View = 'number' | 'table' | 'chart';
export type ChartKind = 'line' | 'column' | 'bar' | 'donut' | 'stacked';

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
  /** Id of an earlier result this query corrects: that one is no longer shown. */
  replaces?: string;
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

function titleKey(title: string): string {
  return title.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Per-request state the tools write to (the Agents SDK run context). */
export class AnalystRun {
  readonly queries: QueryRecord[] = [];
  readonly steps: AgentStep[] = [];
  dbMs = 0;
  /** Database calls made by the tools (run_sql, column_values). */
  dbCalls = 0;
  /** The answer rests on incomplete evidence (database unreachable, step budget spent): never cached. */
  degraded = false;

  constructor(
    readonly emit: Emit = () => undefined,
    /** Most database calls one run may make, however many the model asks for in parallel. */
    readonly maxQueries = Number.POSITIVE_INFINITY,
  ) {}

  /** Claims one database call; false once the budget is spent. Synchronous, so parallel calls count exactly. */
  takeQuery(): boolean {
    if (this.dbCalls >= this.maxQueries) return false;
    this.dbCalls++;
    return true;
  }

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
   * Results the person sees, in query order. A result is dropped when a later
   * query that ran corrects it (named in `replaces`, or shown under the same
   * title), or when it came back empty and another displayed result followed.
   */
  shown(): ShownResult[] {
    const replaced = new Set(this.queries.filter((q) => q.result && q.replaces && q.replaces !== q.id).map((q) => q.replaces!));
    const displayed = this.queries.filter(
      (q): q is QueryRecord & { result: QueryResult; display: Display } => !!q.display && !!q.result && !replaced.has(q.id),
    );
    const latest = new Map(displayed.map((q) => [titleKey(q.title), q.id]));
    const current = displayed.filter((q) => latest.get(titleKey(q.title)) === q.id);
    const kept = current.filter((q, i) => q.result.rowCount > 0 || i === current.length - 1);
    return kept.slice(-MAX_SHOWN).map(({ id, title, sql, result, display }) => ({ id, title, sql, result, display }));
  }
}
