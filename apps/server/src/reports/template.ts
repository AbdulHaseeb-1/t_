import { z } from 'zod';
import type { SqlDialect } from '../database/sql-guard.js';

/**
 * Report templates: one-tap reports backed by verified SQL (no model needed to
 * write the query, so they are instant, exact and free), or by a question the
 * normal pipeline answers.
 *
 * SQL uses typed placeholders, substituted only after validation:
 *   {{day}}          a date parameter, rendered as a dialect-safe literal
 *   {{day+1}}        the same date shifted by whole days (half-open ranges)
 *   {{today-30}}     `today` is always available (in REPORT_TIMEZONE)
 *   {{today-days}}   shifted by a number parameter
 *   {{limit}}        a number parameter
 */
export const CATEGORIES = ['sales', 'stock', 'customers', 'finance', 'team', 'custom'] as const;
export type Category = (typeof CATEGORIES)[number];

const paramSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]{0,30}$/, 'lowercase identifier'),
  label: z.string().min(1).max(60),
  labelUr: z.string().max(60).optional(),
  type: z.enum(['date', 'number']),
  /** Dates: today, yesterday, week_start, month_start, prev_month_start, prev_month_end, year_start, +Nd, -Nd or YYYY-MM-DD. */
  default: z.union([z.string(), z.number()]),
  min: z.number().optional(),
  max: z.number().optional(),
});

export const templateSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,60}$/, 'lowercase-dashed id'),
    title: z.string().min(1).max(80),
    titleUr: z.string().max(80).optional(),
    description: z.string().max(300).optional(),
    descriptionUr: z.string().max(300).optional(),
    /** Business meaning and answer guidance for the model; not shown as the report description. */
    prompt: z.string().max(1200).optional(),
    category: z.enum(CATEGORIES).default('custom'),
    /** Feather icon name for the app. */
    icon: z.string().max(40).optional(),
    /** T-SQL (SQL Server). */
    sql: z.string().max(20_000).optional(),
    /** DuckDB dialect, when it differs from `sql`. */
    sqlDuckdb: z.string().max(20_000).optional(),
    /** Answered by the AI pipeline when there is no SQL for the engine. */
    question: z.string().max(2000).optional(),
    params: z.array(paramSchema).max(8).default([]),
    /** Write a short prose summary with the model (default true). */
    summary: z.boolean().default(true),
    /** Rows mean "something needs attention" (shortage, expiry): schedules can notify only then. */
    alert: z.boolean().default(false),
    /** For saved templates: the engine their SQL was written for. */
    dialect: z.enum(['tsql', 'duckdb']).optional(),
    builtIn: z.boolean().default(false),
    createdAt: z.string().optional(),
  })
  .refine((t) => t.sql || t.sqlDuckdb || t.question, { message: 'a template needs sql, sqlDuckdb or question' });

export const templateFileSchema = z.object({ templates: z.array(templateSchema) });

export type TemplateParam = z.infer<typeof paramSchema>;
export type ReportTemplate = z.infer<typeof templateSchema>;
export type ParamValues = Record<string, string | number>;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 86_400_000;

/** Today's date (YYYY-MM-DD) in a time zone. */
export function todayIn(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function validIso(s: string): boolean {
  if (!ISO.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Resolves a date token relative to `today` (YYYY-MM-DD). Throws on anything else. */
export function resolveDate(token: string, today: string): string {
  const t = token.trim().toLowerCase();
  const [y, m] = today.split('-').map(Number);
  const pad = (n: number) => String(n).padStart(2, '0');
  switch (t) {
    case 'today':
      return today;
    case 'yesterday':
      return addDays(today, -1);
    case 'week_start': {
      // Monday-based weeks.
      const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
      return addDays(today, -((dow + 6) % 7));
    }
    case 'month_start':
      return `${y}-${pad(m)}-01`;
    case 'prev_month_start':
      return m === 1 ? `${y - 1}-12-01` : `${y}-${pad(m - 1)}-01`;
    case 'prev_month_end':
      return addDays(`${y}-${pad(m)}-01`, -1);
    case 'year_start':
      return `${y}-01-01`;
  }
  const rel = /^([+-])(\d{1,4})d$/.exec(t);
  if (rel) return addDays(today, (rel[1] === '-' ? -1 : 1) * Number(rel[2]));
  if (validIso(t)) return t;
  throw new Error(`"${token}" is not a date (use YYYY-MM-DD or today, yesterday, month_start, -7d…)`);
}

/** Validated parameter values: defaults filled in, dates resolved to YYYY-MM-DD, numbers range-checked. */
export function resolveParams(t: Pick<ReportTemplate, 'params'>, given: ParamValues = {}, today: string): Record<string, string | number> {
  const out: Record<string, string | number> = { today };
  for (const p of t.params) {
    const raw = given[p.name] ?? p.default;
    if (p.type === 'date') {
      out[p.name] = resolveDate(String(raw), today);
    } else {
      const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
      if (!Number.isFinite(n) || !Number.isInteger(n)) throw new Error(`${p.label} must be a whole number`);
      if (p.min !== undefined && n < p.min) throw new Error(`${p.label} must be at least ${p.min}`);
      if (p.max !== undefined && n > p.max) throw new Error(`${p.label} must be at most ${p.max}`);
      out[p.name] = n;
    }
  }
  for (const k of Object.keys(given)) {
    if (!t.params.some((p) => p.name === k)) throw new Error(`Unknown parameter "${k}"`);
  }
  return out;
}

/** A date literal no server setting can misread: '20260924' for SQL Server, DATE '2026-09-24' for DuckDB. */
export function dateLiteral(iso: string, dialect: SqlDialect): string {
  return dialect === 'duckdb' ? `DATE '${iso}'` : `'${iso.replace(/-/g, '')}'`;
}

const PLACEHOLDER = /\{\{\s*([a-z][a-z0-9_]*)\s*(?:([+-])\s*([a-z0-9_]+)\s*)?\}\}/g;

/**
 * Replaces placeholders with literals. Only resolved, typed values are ever
 * inserted (dates as fixed-format literals, numbers as integers), so no input
 * text reaches the SQL.
 */
export function renderSql(sql: string, values: Record<string, string | number>, dialect: SqlDialect): string {
  return sql.replace(PLACEHOLDER, (whole, name: string, sign?: string, offset?: string) => {
    if (!(name in values)) throw new Error(`Template uses {{${name}}} but has no such parameter`);
    const v = values[name];
    if (sign) {
      if (typeof v !== 'string') throw new Error(`{{${name}${sign}…}}: only dates can be shifted`);
      const n = /^\d+$/.test(offset!) ? Number(offset) : values[offset!];
      if (typeof n !== 'number') throw new Error(`${whole}: "${offset}" is not a number parameter`);
      return dateLiteral(addDays(v, sign === '-' ? -n : n), dialect);
    }
    return typeof v === 'number' ? String(v) : dateLiteral(v, dialect);
  });
}

/** Question text with dates filled in ("Sales from 2026-09-01 to 2026-09-24"). */
export function renderQuestion(q: string, values: Record<string, string | number>): string {
  return q.replace(PLACEHOLDER, (_w, name: string, sign?: string, offset?: string) => {
    const v = values[name];
    if (v === undefined) return _w;
    if (sign && typeof v === 'string') {
      const n = /^\d+$/.test(offset!) ? Number(offset) : Number(values[offset!]);
      return addDays(v, sign === '-' ? -n : n);
    }
    return String(v);
  });
}

/** T-SQL syntax DuckDB cannot run (TOP, [brackets], GETDATE…): such SQL needs a DuckDB twin. */
const TSQL_ONLY = /\bTOP\s*\(?\d|\[\w|\bGETDATE\s*\(|\bDATEADD\s*\(|\bDATEDIFF\s*\(|\bISNULL\s*\(|\bCONVERT\s*\(|\bN'|\bLEN\s*\(|\bCHARINDEX\s*\(/i;

export function tsqlOnly(sql: string): boolean {
  return TSQL_ONLY.test(sql.replace(/\{\{[^}]*\}\}/g, '0'));
}

/** SQL for this engine, if the template has one. Portable `sql` also serves DuckDB. */
export function sqlFor(t: ReportTemplate, dialect: SqlDialect): string | undefined {
  if (t.dialect) return t.dialect === dialect ? (t.sql ?? t.sqlDuckdb) : undefined;
  if (dialect === 'tsql') return t.sql;
  return t.sqlDuckdb ?? (t.sql && !tsqlOnly(t.sql) ? t.sql : undefined);
}

/** "1 Sep – 24 Sep 2026" style period label for titles and messages. */
export function periodLabel(t: Pick<ReportTemplate, 'params'>, values: Record<string, string | number>): string {
  const dates = t.params.filter((p) => p.type === 'date').map((p) => String(values[p.name]));
  if (!dates.length) return '';
  const fmt = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number);
    return `${d} ${MONTHS[m - 1]} ${y}`;
  };
  return dates.length === 1 || dates[0] === dates[1] ? fmt(dates[0]) : `${fmt(dates[0])} – ${fmt(dates[dates.length - 1])}`;
}
