import { createHash } from 'node:crypto';
import type { QueryResult } from '../database/database.types.js';

export interface CompareOptions {
  /** Row order is part of the answer (the question asks for a sorted list). */
  ordered?: boolean;
  /** Absolute tolerance for numbers (rounding differences). */
  absTol?: number;
  /** Relative tolerance for numbers. */
  relTol?: number;
}

export type Mismatch = 'row_count' | 'missing_column' | 'values' | 'order' | 'no_result';

export interface CompareOutcome {
  match: boolean;
  reason?: Mismatch;
  detail?: string;
  /** gold column index -> predicted column index, when matched. */
  mapping?: number[];
}

type Cell = string | number | null;

const ISO_MIDNIGHT = /^(\d{4}-\d{2}-\d{2})T00:00:00(?:\.0+)?Z$/;

/** Canonical cell form: numbers as numbers, booleans as 0/1, midnight datetimes as dates, text trimmed + lower-cased. */
export function normalizeCell(v: unknown): Cell {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'bigint') return Number(v);
  if (v instanceof Date) return normalizeCell(v.toISOString());
  const s = String(v).trim();
  if (/^-?\d+(\.\d+)?$/.test(s) && s.length < 16) return Number(s);
  const midnight = ISO_MIDNIGHT.exec(s);
  if (midnight) return midnight[1];
  return s.toLowerCase();
}

function cellsEqual(a: Cell, b: Cell, absTol: number, relTol: number): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') {
    const diff = Math.abs(a - b);
    return diff <= absTol || diff <= relTol * Math.max(Math.abs(a), Math.abs(b));
  }
  return false;
}

/** Sort key that is stable under numeric tolerance (rounds numbers). */
function sortKey(c: Cell): string {
  if (c === null) return '\u0000';
  if (typeof c === 'number') return `n:${c.toFixed(2)}`;
  return `s:${c}`;
}

function columnVector(rows: Cell[][], i: number): Cell[] {
  return rows.map((r) => r[i]);
}

function vectorsEqual(a: Cell[], b: Cell[], ordered: boolean, absTol: number, relTol: number): boolean {
  if (a.length !== b.length) return false;
  const [x, y] = ordered
    ? [a, b]
    : [
        [...a].sort((p, q) => sortKey(p).localeCompare(sortKey(q))),
        [...b].sort((p, q) => sortKey(p).localeCompare(sortKey(q))),
      ];
  return x.every((v, i) => cellsEqual(v, y[i], absTol, relTol));
}

function rowsEqual(
  gold: Cell[][],
  pred: Cell[][],
  ordered: boolean,
  absTol: number,
  relTol: number,
): boolean {
  if (gold.length !== pred.length) return false;
  const key = (r: Cell[]) => r.map(sortKey).join('\u0001');
  const [g, p] = ordered
    ? [gold, pred]
    : [
        [...gold].sort((a, b) => key(a).localeCompare(key(b))),
        [...pred].sort((a, b) => key(a).localeCompare(key(b))),
      ];
  return g.every((row, i) => row.every((c, j) => cellsEqual(c, p[i][j], absTol, relTol)));
}

/**
 * Execution accuracy: does the predicted result contain the gold result?
 * Column names and order are ignored and extra predicted columns are allowed
 * (a helpful extra column is not wrong); row count must match exactly.
 * Columns are aligned by value, then whole rows are compared so values from
 * different rows can never be mixed into a false match.
 */
export function compareResults(
  gold: QueryResult,
  pred: QueryResult | null,
  opts: CompareOptions = {},
): CompareOutcome {
  const absTol = opts.absTol ?? 0.01;
  const relTol = opts.relTol ?? 1e-4;
  const ordered = opts.ordered ?? false;
  if (!pred) return { match: false, reason: 'no_result' };

  const g = gold.rows.map((r) => r.map(normalizeCell));
  const p = pred.rows.map((r) => r.map(normalizeCell));
  if (g.length !== p.length) {
    return { match: false, reason: 'row_count', detail: `expected ${g.length} rows, got ${p.length}` };
  }
  const gCols = gold.columns.length;
  const pCols = pred.columns.length;
  if (g.length === 0) return { match: true, mapping: [] };

  // Candidate predicted columns for each gold column (same multiset of values).
  const candidates: number[][] = [];
  for (let i = 0; i < gCols; i++) {
    const gv = columnVector(g, i);
    const c: number[] = [];
    for (let j = 0; j < pCols; j++)
      if (vectorsEqual(gv, columnVector(p, j), false, absTol, relTol)) c.push(j);
    if (c.length === 0) {
      return {
        match: false,
        reason: 'missing_column',
        detail: `no column matches "${gold.columns[i].name}"`,
      };
    }
    candidates.push(c);
  }

  // Backtrack over assignments (tiny in practice) and verify whole rows.
  const used = new Set<number>();
  const mapping: number[] = [];
  let orderFailure = false;
  const search = (i: number): boolean => {
    if (i === gCols) {
      const projected = p.map((row) => mapping.map((j) => row[j]));
      if (rowsEqual(g, projected, ordered, absTol, relTol)) return true;
      if (ordered && rowsEqual(g, projected, false, absTol, relTol)) orderFailure = true;
      return false;
    }
    for (const j of candidates[i]) {
      if (used.has(j)) continue;
      used.add(j);
      mapping.push(j);
      if (search(i + 1)) return true;
      mapping.pop();
      used.delete(j);
    }
    return false;
  };
  if (search(0)) return { match: true, mapping: [...mapping] };
  return orderFailure
    ? { match: false, reason: 'order', detail: 'right rows, wrong order' }
    : { match: false, reason: 'values', detail: 'columns match individually but rows differ' };
}

/**
 * Order- and column-order-insensitive fingerprint of a result, used to vote
 * between candidate queries that should mean the same thing.
 */
export function resultFingerprint(r: QueryResult): string {
  const rows = r.rows.map((row) => row.map((c) => sortKey(normalizeCell(c))));
  // Canonical column order: by each column's sorted values (identical columns are interchangeable).
  const colKey = r.columns.map((_, i) =>
    rows
      .map((row) => row[i])
      .sort()
      .join('\u0001'),
  );
  const order = colKey
    .map((k, i) => ({ k, i }))
    .sort((a, b) => a.k.localeCompare(b.k))
    .map((x) => x.i);
  // Then whole rows, so the pairing of values across columns is preserved.
  const canonicalRows = rows.map((row) => order.map((i) => row[i]).join('\u0001')).sort();
  return createHash('sha1')
    .update(`${r.rowCount}\u0002${canonicalRows.join('\u0002')}`)
    .digest('hex');
}
