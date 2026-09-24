import type { QueryResult } from './api';

export interface ChartSpec {
  kind: 'bar' | 'line';
  labels: string[];
  series: { name: string; values: number[] }[];
}

const TIME_NAME = /(^|_|\b)(year|month|quarter|week|day|date|period|hour|yr|mon)(s|_?number|_?num)?($|_|\b)/i;
const ID_NAME = /(^id$|_id$|Id$|ID$|^code$)/;
const MAX_POINTS = 40;

function isNumeric(rows: unknown[][], c: number): boolean {
  return rows.every((r) => r[c] === null || (typeof r[c] === 'number' && Number.isFinite(r[c] as number)));
}

function isDateLike(rows: unknown[][], c: number): boolean {
  return rows.every((r) => typeof r[c] === 'string' && /^\d{4}-\d{2}(-\d{2})?/.test(r[c] as string));
}

function label(v: unknown): string {
  if (v === null || v === undefined) return '—';
  const s = String(v);
  const d = /^(\d{4}-\d{2}-\d{2})T00:00:00/.exec(s);
  return d ? d[1] : s;
}

/**
 * Picks a chart only when it genuinely helps: one label dimension, 1-3
 * measures, 2-40 rows. Time-like dimensions draw as lines, categories as
 * bars. Everything else (single values, wide tables, lists) stays a table.
 */
export function inferChart(r: QueryResult | null | undefined): ChartSpec | null {
  if (!r || r.rows.length < 2 || r.rows.length > MAX_POINTS || r.columns.length < 2) return null;
  const cols = r.columns.map((col, i) => ({
    name: col.name,
    i,
    numeric: isNumeric(r.rows, i),
    time: TIME_NAME.test(col.name) || isDateLike(r.rows, i),
    id: ID_NAME.test(col.name),
  }));

  // The x axis: a time-like column first, else the single non-numeric column.
  const time = cols.find((c) => c.time);
  const text = cols.filter((c) => !c.numeric);
  const x = time ?? (text.length === 1 ? text[0] : undefined);
  if (!x) return null;
  const measures = cols.filter((c) => c !== x && c.numeric && !c.id && !c.time).slice(0, 3);
  // Extra text columns (e.g. first + last name) would make labels ambiguous.
  if (measures.length === 0 || text.filter((c) => c !== x).length > 0) return null;

  return {
    kind: time ? 'line' : 'bar',
    labels: r.rows.map((row) => label(row[x.i])),
    series: measures.map((m) => ({ name: m.name, values: r.rows.map((row) => (row[m.i] as number | null) ?? 0) })),
  };
}

/** Round axis maximum: 1, 2, 2.5 or 5 x 10^n, so gridlines land on readable values. */
export function niceMax(v: number): number {
  if (v <= 0) return 1;
  const exp = Math.floor(Math.log10(v));
  const base = 10 ** exp;
  for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * base) return m * base;
  return 10 * base;
}

export function compactNumber(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(a >= 1e10 ? 0 : 1)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(a >= 1e4 ? 0 : 1)}k`;
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/**
 * Axis range for trend lines: fitted to the data (a line's slope is the
 * message), padded to readable steps. Bars always start at zero instead.
 */
export function lineDomain(values: number[]): { min: number; max: number } {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  if (lo >= 0 && lo < hi * 0.5) return { min: 0, max: niceMax(hi) };
  const span = hi - lo || Math.abs(hi) || 1;
  const step = niceMax(span / 4) / 2;
  return { min: Math.floor(lo / step) * step, max: Math.ceil(hi / step) * step || step };
}
