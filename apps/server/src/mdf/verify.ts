import { type DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import sql from 'mssql';

/**
 * Cell-by-cell comparison of a converted DuckDB file with the same database
 * served by SQL Server. Both sides render every value to the same canonical
 * text (decimals exact, datetimes to the microsecond, binaries as hex), then
 * each table's rows are compared as multisets.
 */
export interface VerifyResult {
  table: string;
  rows: number;
  missing: number;
  extra: number;
  sample: string[];
}

export interface Col {
  name: string;
  sqlType: string;
}

const NULL = '\\N';

function tsqlCanonical(c: Col): string {
  const id = `[${c.name.replace(/]/g, ']]')}]`;
  const t = c.sqlType.replace(/\(.*$/, '');
  switch (t) {
    case 'bit':
      return `CASE ${id} WHEN 1 THEN 'true' WHEN 0 THEN 'false' END`;
    case 'datetime':
    case 'smalldatetime':
    case 'datetime2':
      return `CONVERT(varchar(30), CAST(${id} AS datetime2(6)), 121)`;
    case 'date':
      return `CONVERT(varchar(10), ${id}, 23)`;
    case 'time':
      return `CONVERT(varchar(20), CAST(${id} AS time(6)))`;
    case 'datetimeoffset':
      return `CONVERT(varchar(30), CAST(SWITCHOFFSET(${id}, '+00:00') AS datetime2(6)), 121)`;
    case 'money':
    case 'smallmoney':
      return `CONVERT(varchar(80), ${id}, 2)`;
    case 'float':
    case 'real':
      return `CONVERT(varchar(80), ${id}, 3)`;
    // Text is compared as the stored bytes: drivers lossily decode code-page
    // gaps (0x81, 0x8D...) that SQL Server keeps.
    case 'char':
      return `CONVERT(varchar(max), CAST(RTRIM(${id}) AS varbinary(max)), 2)`;
    case 'nchar':
      return `CONVERT(varchar(max), CAST(RTRIM(${id}) AS varbinary(max)), 2)`;
    case 'text':
      return `CONVERT(varchar(max), CAST(CAST(${id} AS varchar(max)) AS varbinary(max)), 2)`;
    case 'ntext':
      return `CONVERT(varchar(max), CAST(CAST(${id} AS nvarchar(max)) AS varbinary(max)), 2)`;
    case 'binary':
    case 'varbinary':
    case 'image':
    case 'timestamp':
      return `CONVERT(varchar(max), CAST(${id} AS varbinary(max)), 2)`;
    case 'uniqueidentifier':
      return `LOWER(CONVERT(varchar(36), ${id}))`;
    case 'varchar':
    case 'nvarchar':
      return `CONVERT(varchar(max), CAST(${id} AS varbinary(max)), 2)`;
    default:
      return `CONVERT(varchar(80), ${id})`;
  }
}

function duckCanonical(c: Col): string {
  const id = `"${c.name.replace(/"/g, '""')}"`;
  const t = c.sqlType.replace(/\(.*$/, '');
  switch (t) {
    case 'datetime':
    case 'smalldatetime':
    case 'datetime2':
      return `strftime(${id}, '%Y-%m-%d %H:%M:%S.%f')`;
    case 'date':
      return `strftime(${id}, '%Y-%m-%d')`;
    case 'time':
      return `strftime(DATE '2000-01-01' + ${id}, '%H:%M:%S.%f')`;
    case 'datetimeoffset':
      return `strftime(timezone('UTC', ${id}), '%Y-%m-%d %H:%M:%S.%f')`;
    case 'binary':
    case 'varbinary':
    case 'image':
    case 'timestamp':
      return `hex(${id})`;
    default:
      return `CAST(${id} AS VARCHAR)`;
  }
}

// Windows-1252 as decoded by WHATWG TextDecoder, inverted (a bijection over 0..255).
const CP1252 = new Map<string, number>();
{
  const dec = new TextDecoder('windows-1252');
  for (let b = 0; b < 256; b++) CP1252.set(dec.decode(Uint8Array.of(b)), b);
}
/** Both sides' float text differs in formatting only: compare the parsed value. */
const floatCanonical = (sqlType: string, v: unknown): unknown => {
  if (v === null || v === undefined || !/^(float|real)/.test(sqlType)) return v;
  const n = Number(v);
  return String(sqlType.startsWith('real') ? Math.fround(n) : n);
};

const textHex = (sqlType: string, v: unknown): unknown => {
  if (typeof v !== 'string') return floatCanonical(sqlType, v);
  if (/^(float|real)/.test(sqlType)) return floatCanonical(sqlType, v);
  if (/^n(var)?char|^ntext/.test(sqlType)) return Buffer.from(v, 'utf16le').toString('hex').toUpperCase();
  if (!/^(var)?char|^text/.test(sqlType)) return v;
  const bytes = [...v].map((ch) => {
    const b = CP1252.get(ch);
    if (b === undefined) throw new Error(`character U+${ch.codePointAt(0)!.toString(16)} is not in Windows-1252`);
    return b;
  });
  return Buffer.from(bytes).toString('hex').toUpperCase();
};

export const rowKey = (r: unknown[]) => r.map((v) => (v === null || v === undefined ? NULL : String(v))).join('\t');

export type CanonicalTables = Map<string, { columns: Col[] }>;

/** Tables and columns of a converted file, from its `_meta` schema. */
export async function convertedTables(duck: DuckDBConnection): Promise<CanonicalTables> {
  const cols = (
    await duck.runAndReadAll(`SELECT table_schema, table_name, column_name, sql_type FROM _meta.columns ORDER BY table_schema, table_name, ordinal`)
  ).getRows() as string[][];
  const tables: CanonicalTables = new Map();
  for (const [s, t, name, sqlType] of cols) {
    const k = `${s}.${t}`;
    if (!tables.has(k)) tables.set(k, { columns: [] });
    tables.get(k)!.columns.push({ name, sqlType });
  }
  return tables;
}

/** A converted table's rows as canonical text keys (see rowKey). */
export async function duckCanonicalRows(duck: DuckDBConnection, table: string, columns: Col[]): Promise<string[]> {
  const [schema, name] = table.split('.');
  return (await duck.runAndReadAll(`SELECT ${columns.map(duckCanonical).join(', ')} FROM "${schema}"."${name}"`))
    .getRows()
    .map((r) => rowKey(r.map((v, i) => textHex(columns[i].sqlType, v))));
}

/** The same rows rendered by SQL Server itself. */
export async function sqlServerCanonicalRows(pool: sql.ConnectionPool, table: string, columns: Col[]): Promise<string[]> {
  const [schema, name] = table.split('.');
  const res = await pool
    .request()
    .query(`SELECT ${columns.map((c, i) => `${tsqlCanonical(c)} AS [c${i}]`).join(', ')} FROM [${schema}].[${name}]`);
  return res.recordset.map((r: Record<string, unknown>) => rowKey(Object.values(r).map((v, i) => floatCanonical(columns[i].sqlType, v))));
}

/** Multiset difference of two row lists. */
export function compareRows(table: string, ours: string[], theirs: string[]): VerifyResult {
  const counts = new Map<string, number>();
  for (const k of theirs) counts.set(k, (counts.get(k) ?? 0) + 1);
  let extra = 0;
  const sample: string[] = [];
  for (const k of ours) {
    const n = counts.get(k);
    if (n) counts.set(k, n - 1);
    else {
      extra++;
      if (sample.length < 3) sample.push(`converted only: ${k.slice(0, 300)}`);
    }
  }
  let missing = 0;
  for (const [k, n] of counts) {
    if (!n) continue;
    missing += n;
    if (sample.length < 6) sample.push(`source only: ${k.slice(0, 300)}`);
  }
  return { table, rows: theirs.length, missing, extra, sample };
}

export async function verifyAgainstSqlServer(
  duckPath: string,
  mssql: sql.config,
  onTable?: (r: VerifyResult) => void,
): Promise<VerifyResult[]> {
  const duck = await (await DuckDBInstance.create(duckPath, { access_mode: 'READ_ONLY' })).connect();
  const pool = await new sql.ConnectionPool(mssql).connect();
  const results: VerifyResult[] = [];
  try {
    for (const [table, { columns }] of await convertedTables(duck)) {
      const result = compareRows(
        table,
        await duckCanonicalRows(duck, table, columns),
        await sqlServerCanonicalRows(pool, table, columns),
      );
      results.push(result);
      onTable?.(result);
    }
  } finally {
    duck.closeSync();
    await pool.close();
  }
  return results;
}
