import { type RunContext, tool } from '@openai/agents';
import { z } from 'zod';
import { SqlExecutionError, UnsafeSqlError } from '../../common/errors.js';
import type { AppConfig } from '../../config/app-config.js';
import type { DatabaseService } from '../../database/database.service.js';
import type { QueryResult } from '../../database/database.types.js';
import { renderTables } from '../../database/schema/schema-renderer.js';
import type { SchemaCatalogService } from '../../database/schema/schema-catalog.service.js';
import type { ColumnInfo, TableInfo } from '../../database/schema/schema.types.js';
import type { SqlDialect } from '../../database/sql-guard.js';
import { toPromptTable } from '../result-format.js';
import type { AnalystRun, Display } from './analyst.run.js';

interface ToolDeps {
  config: AppConfig;
  db: DatabaseService;
  catalog: SchemaCatalogService;
}

/** Distinct values column_values returns. */
const MAX_VALUES = 40;

function runOf(ctx: RunContext<AnalystRun> | undefined): AnalystRun {
  if (!ctx?.context) throw new Error('analyst tools need an AnalystRun context');
  return ctx.context;
}

function toDisplay(display: 'number' | 'table' | 'chart' | 'none', chart: Display['chart'] | null): Display | null {
  if (display === 'none') return null;
  return display === 'chart' ? { view: 'chart', ...(chart ? { chart } : {}) } : { view: display };
}

/** What the model reads back: id, size, then a TSV sample with stats over every row. */
export function describeResult(id: string, sql: string, r: QueryResult, sampleRows: number): string {
  if (r.rowCount === 0) {
    const filtered = /\b(WHERE|HAVING|JOIN)\b/i.test(sql);
    return `${id}: no rows.${filtered ? ' If a filter compares text values, look them up with column_values before concluding there is no data.' : ''}`;
  }
  const size = `${r.rowCount}${r.truncated ? '+' : ''} row${r.rowCount === 1 ? '' : 's'}`;
  return `${id}: ${size}\n${toPromptTable(r, sampleRows)}`;
}

/** A pointer to the fix for the errors models make most. */
export function sqlHint(message: string): string {
  if (/invalid column|column .*(not found|does not exist)|referenced column|could not be bound|no such column/i.test(message)) {
    return 'Check the exact column names with describe_tables, then fix the query.';
  }
  if (/invalid object|table .*(not found|does not exist)|catalog error/i.test(message)) {
    return 'Check the table name with search_schema, then fix the query.';
  }
  if (/timeout|timed out/i.test(message)) return 'Make the query cheaper: filter earlier and aggregate instead of returning detail rows.';
  if (/^Rejected SQL/i.test(message)) return 'Rewrite it as a single read-only SELECT that follows the SQL rules.';
  if (/conversion|convert|cast/i.test(message)) return 'Check the column types; cast explicitly where needed.';
  return 'Fix the SQL and try again.';
}

function likePattern(text: string, dialect: SqlDialect): string {
  const t = text.replace(/'/g, "''");
  return dialect === 'duckdb'
    ? `'%${t.replace(/[\\%_]/g, (c) => `\\${c}`)}%' ESCAPE '\\'`
    : `N'%${t.replace(/[[%_]/g, (c) => `[${c}]`)}%'`;
}

/** Most common values of one column, optionally only those containing some text. Identifiers come from the catalog. */
export function columnValuesSql(t: TableInfo, c: ColumnInfo, contains: string | null, dialect: SqlDialect, limit = MAX_VALUES): string {
  if (dialect === 'duckdb') {
    const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const col = q(c.name);
    const filter = contains ? ` AND CAST(${col} AS VARCHAR) ILIKE ${likePattern(contains, dialect)}` : '';
    return (
      `SELECT CAST(${col} AS VARCHAR) AS value, count(*) AS row_count FROM ${q(t.schema)}.${q(t.name)} ` +
      `WHERE ${col} IS NOT NULL${filter} GROUP BY ${col} ORDER BY row_count DESC, value LIMIT ${limit + 1}`
    );
  }
  const q = (s: string) => `[${s.replace(/]/g, ']]')}]`;
  const col = q(c.name);
  const filter = contains ? ` AND CAST(${col} AS nvarchar(400)) LIKE ${likePattern(contains, dialect)}` : '';
  return (
    `SELECT TOP (${limit + 1}) CAST(${col} AS nvarchar(400)) AS value, COUNT_BIG(*) AS row_count FROM ${q(t.schema)}.${q(t.name)} ` +
    `WHERE ${col} IS NOT NULL${filter} GROUP BY ${col} ORDER BY row_count DESC`
  );
}

function isSqlFailure(err: unknown): boolean {
  return err instanceof UnsafeSqlError || err instanceof SqlExecutionError;
}

/**
 * The agent's tools. They never throw at the model: every failure comes back as
 * text that says what went wrong and how to fix it, so it can correct itself.
 */
export function analystTools({ config, db, catalog }: ToolDeps) {
  const sampleRows = config.get('ASK_ANSWER_MAX_ROWS');

  async function findTable(name: string): Promise<TableInfo | undefined> {
    const wanted = name.trim().replace(/[[\]"]/g, '').toLowerCase();
    const tables = (await catalog.snapshot()).tables;
    return tables.find((t) => t.id.toLowerCase() === wanted) ?? tables.find((t) => t.name.toLowerCase() === wanted);
  }

  const runSql = tool({
    name: 'run_sql',
    description:
      'Run one read-only SELECT (or WITH ... SELECT) and get the result back as a TSV sample with column statistics. ' +
      'Independent queries can be called in parallel. The display setting selects a visible app widget: number card, expanded table, or chart. Use table for requested lists, including top-N product lists.',
    parameters: z.object({
      title: z.string().describe('Short heading for this result in the person\'s language, e.g. "Net sales by month, 2026".'),
      sql: z.string().describe('A single read-only SELECT or WITH ... SELECT statement.'),
      display: z
        .enum(['number', 'table', 'chart', 'none'])
        .describe('number: one-row figures; table: visible rows for lists, records, or detail; chart: trend or single-measure comparison; none: checks and intermediate steps.'),
      chart: z
        .enum(['line', 'column', 'bar', 'donut'])
        .nullable()
        .describe('Only with display "chart": line = time series with many points, column = a few periods, bar = ranked categories, donut = shares of one whole (at most 6 parts). Otherwise null.'),
    }),
    execute: async ({ title, sql, display, chart }, ctx?: RunContext<AnalystRun>) => {
      const run = runOf(ctx);
      const q = run.addQuery({ title: title.trim() || 'Query', sql, display: toDisplay(display, chart) });
      run.emit({ type: 'status', stage: 'query', label: q.title });
      const started = performance.now();
      try {
        const result = await db.readOnlyQuery(sql);
        const elapsedMs = Math.round(performance.now() - started);
        run.dbMs += elapsedMs;
        q.result = result;
        run.step({ tool: 'run_sql', label: q.title, ok: true, sql, resultId: q.id, rowCount: result.rowCount, elapsedMs });
        return describeResult(q.id, sql, result, sampleRows);
      } catch (err) {
        run.dbMs += performance.now() - started;
        const message = (err as Error).message;
        q.error = message;
        run.step({ tool: 'run_sql', label: q.title, ok: false, sql, resultId: q.id, error: message });
        if (!isSqlFailure(err)) return `${q.id} failed: the database is unavailable (${message}). Do not retry; tell the person.`;
        return `${q.id} failed: ${message}\n${sqlHint(message)}`;
      }
    },
  });

  const searchSchema = tool({
    name: 'search_schema',
    description: 'Find tables about a topic (keywords in English work best). Returns full column details for the best matches.',
    parameters: z.object({ query: z.string().describe('Topic or keywords, e.g. "customer payments receipts".') }),
    execute: async ({ query }, ctx?: RunContext<AnalystRun>) => {
      const run = runOf(ctx);
      run.emit({ type: 'status', stage: 'schema', label: query });
      const tables = await catalog.search(query, 6);
      run.step({ tool: 'search_schema', label: query, ok: tables.length > 0 });
      return tables.length ? renderTables(tables) : 'No matching tables. Try other words, or pick from the schema you have.';
    },
  });

  const describeTables = tool({
    name: 'describe_tables',
    description: 'Columns, keys, notes and row counts for specific tables.',
    parameters: z.object({ tables: z.array(z.string()).describe('schema.table names, e.g. ["dbo.Customer"].') }),
    execute: async ({ tables }, ctx?: RunContext<AnalystRun>) => {
      const run = runOf(ctx);
      const label = tables.join(', ');
      run.emit({ type: 'status', stage: 'schema', label });
      const text = await catalog.describe(tables);
      run.step({ tool: 'describe_tables', label, ok: text !== 'No matching tables.' });
      return text;
    },
  });

  const columnValues = tool({
    name: 'column_values',
    description:
      'The values a column actually stores, most common first, with row counts. Use it to match a name, code or status ' +
      'from the question to the stored value before filtering on it.',
    parameters: z.object({
      table: z.string().describe('schema.table, e.g. "dbo.Customer".'),
      column: z.string().describe('Column name.'),
      contains: z.string().nullable().describe('Only values containing this text (case-insensitive), e.g. part of a name. Null for the most common values.'),
    }),
    execute: async ({ table, column, contains }, ctx?: RunContext<AnalystRun>) => {
      const run = runOf(ctx);
      const label = `${table}.${column}${contains ? ` ~ "${contains}"` : ''}`;
      run.emit({ type: 'status', stage: 'schema', label });
      const t = await findTable(table);
      if (!t) {
        run.step({ tool: 'column_values', label, ok: false, error: 'unknown table' });
        return `Unknown table "${table}". Use search_schema to find it.`;
      }
      const c = t.columns.find((x) => x.name.toLowerCase() === column.trim().replace(/[[\]"]/g, '').toLowerCase());
      if (!c) {
        run.step({ tool: 'column_values', label, ok: false, error: 'unknown column' });
        return `Unknown column "${column}" in ${t.id}. Its columns: ${t.columns.map((x) => x.name).join(', ')}.`;
      }
      const started = performance.now();
      try {
        const r = await db.readOnlyQuery(columnValuesSql(t, c, contains?.trim() || null, db.dialect), MAX_VALUES + 1);
        const elapsedMs = Math.round(performance.now() - started);
        run.dbMs += elapsedMs;
        run.step({ tool: 'column_values', label, ok: true, rowCount: Math.min(r.rowCount, MAX_VALUES), elapsedMs });
        if (r.rowCount === 0) return contains ? `No ${t.id}.${c.name} value contains "${contains}".` : `${t.id}.${c.name} has no values.`;
        const rows = r.rows.slice(0, MAX_VALUES).map(([v, n]) => `${String(v)}\t${String(n)}`);
        const more = r.rowCount > MAX_VALUES ? `\n(more values exist; narrow with contains)` : '';
        return `${t.id}.${c.name} (${c.type}): value\trows\n${rows.join('\n')}${more}`;
      } catch (err) {
        run.dbMs += performance.now() - started;
        const message = (err as Error).message;
        run.step({ tool: 'column_values', label, ok: false, error: message });
        return `Could not read values: ${message}`;
      }
    },
  });

  return [runSql, searchSchema, describeTables, columnValues];
}
