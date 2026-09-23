import type { QueryResult } from '../database/database.types.js';

const MAX_CELL_CHARS = 80;

function cell(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  const flat = s.replace(/[\t\r\n]+/g, ' ');
  return flat.length > MAX_CELL_CHARS ? `${flat.slice(0, MAX_CELL_CHARS)}...` : flat;
}

interface NumericStats {
  column: string;
  min: number;
  max: number;
  sum: number;
  avg: number;
  nonNull: number;
}

/** Stats over every returned row, so the model can reason about rows it never sees. */
export function numericStats(result: QueryResult): NumericStats[] {
  const stats: NumericStats[] = [];
  result.columns.forEach((col, i) => {
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    let n = 0;
    for (const row of result.rows) {
      const v = row[i];
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      min = Math.min(min, v);
      max = Math.max(max, v);
      sum += v;
      n++;
    }
    if (n > 0 && n >= result.rows.length * 0.5) {
      const round = (x: number) => Number(x.toFixed(4));
      stats.push({
        column: col.name,
        min: round(min),
        max: round(max),
        sum: round(sum),
        avg: round(sum / n),
        nonNull: n,
      });
    }
  });
  return stats;
}

/**
 * TSV is the densest tabular encoding for LLMs (~half the tokens of JSON).
 * Large results are sampled head-first and backed by column statistics.
 */
export function toPromptTable(result: QueryResult, maxRows: number): string {
  const header = result.columns.map((c) => c.name).join('\t');
  const shown = result.rows.slice(0, maxRows).map((r) => r.map(cell).join('\t'));
  const lines = [header, ...shown];

  const notes: string[] = [];
  if (result.rows.length > maxRows)
    notes.push(`showing first ${maxRows} of ${result.rowCount} returned rows`);
  if (result.truncated) notes.push('the query hit the row cap; more rows exist in the database');
  if (result.rows.length > maxRows) {
    const stats = numericStats(result);
    if (stats.length) {
      notes.push(
        `stats over all ${result.rowCount} rows: ` +
          stats.map((s) => `${s.column}{min=${s.min} max=${s.max} sum=${s.sum} avg=${s.avg}}`).join('; '),
      );
    }
  }
  return notes.length ? `${lines.join('\n')}\n(${notes.join('; ')})` : lines.join('\n');
}
