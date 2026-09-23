import { tokenize } from './schema-retriever.js';
import type { ColumnInfo, TableInfo } from './schema.types.js';

export interface ValueHintOptions {
  maxDistinct: number;
  maxTableRows: number;
  maxColumns: number;
  /** `|`-separated name tokens that mark a column as personal/free text. */
  exclude: string;
}

const TEXT_TYPE = /^n?(var)?char\((\d+)\)$/;
const MAX_TEXT_LEN = 64;
const MAX_VALUE_CHARS = 40;

function quote(id: string): string {
  return `[${id.replace(/]/g, ']]')}]`;
}

/**
 * Columns worth sampling: short text columns in real tables that are not keys
 * and whose name tokens are not on the privacy/free-text exclusion list.
 */
export function hintCandidates(
  tables: TableInfo[],
  opts: ValueHintOptions,
): { table: TableInfo; column: ColumnInfo }[] {
  const excluded = new Set(
    opts.exclude
      .split('|')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean),
  );
  const out: { table: TableInfo; column: ColumnInfo }[] = [];
  for (const table of tables) {
    if (table.kind !== 'table' || !table.rowCount || table.rowCount > opts.maxTableRows) continue;
    for (const column of table.columns) {
      const m = TEXT_TYPE.exec(column.type);
      if (!m || Number(m[2]) > MAX_TEXT_LEN) continue;
      if (column.pk || column.fk || column.identity) continue;
      if (tokenize(column.name).some((t) => excluded.has(t))) continue;
      out.push({ table, column });
      if (out.length >= opts.maxColumns) return out;
    }
  }
  return out;
}

/** Top (maxDistinct + 1) values by frequency; more than maxDistinct means "not categorical". */
export function valueHintSql(table: TableInfo, column: ColumnInfo, maxDistinct: number): string {
  const col = quote(column.name);
  return (
    `SELECT TOP (${maxDistinct + 1}) CAST(${col} AS nvarchar(${MAX_VALUE_CHARS + 1})) AS v ` +
    `FROM ${quote(table.schema)}.${quote(table.name)} WITH (NOLOCK) WHERE ${col} IS NOT NULL ` +
    `GROUP BY ${col} ORDER BY COUNT_BIG(*) DESC`
  );
}

export function toHint(rows: { v: unknown }[], maxDistinct: number): string[] | undefined {
  if (rows.length === 0 || rows.length > maxDistinct) return undefined;
  const values = rows.map((r) => String(r.v).trim()).filter((v) => v && v.length <= MAX_VALUE_CHARS);
  return values.length ? values : undefined;
}
