import { createHash } from 'node:crypto';
import { createReadStream, existsSync, renameSync, rmSync } from 'node:fs';
import {
  type DuckDBAppender,
  type DuckDBConnection,
  DuckDBDecimalValue,
  DuckDBInstance,
  dateValue,
  timestampValue,
  timeValue,
  uuidValue,
  DuckDBTimestampTZValue,
} from '@duckdb/node-api';
import { Catalog, type ColumnDef, type TableDef } from './catalog.js';
import { translateComputed } from './computed.js';
import { MdfFile } from './mdf-file.js';
import { TableReader } from './rows.js';
import { DateValue, DecimalValue, SqlType, type SqlValue, TimestampValue, TimeValue, TYPE_NAMES, type TypeInfo } from './types.js';

export interface ExportOptions {
  /** Globs on schema.table to leave out (case-insensitive). */
  excludeTables?: string[];
  /** Globs on column name never copied into the query database (credentials, ID numbers). */
  denyColumns?: string[];
  /** SQL Server's default collations are case-insensitive; keep that behaviour for text. */
  caseInsensitive?: boolean;
  onProgress?: (msg: string) => void;
}

export interface ExportReport {
  source: string;
  sha256: string;
  formatVersion: number;
  tables: { name: string; rows: number; columns: number; skippedColumns: string[] }[];
  computed: { column: string; expression: string }[];
  warnings: string[];
  elapsedMs: number;
}

export const DEFAULT_DENY_COLUMNS = ['*password*', '*passwd*', '*pwd*', '*secret*', '*token*', '*cnic*', '*ssn*'];

const globRe = (g: string) => new RegExp(`^${g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i');
const q = (id: string) => `"${id.replace(/"/g, '""')}"`;

export function duckType(t: TypeInfo, caseInsensitive: boolean): string {
  const text = caseInsensitive ? 'VARCHAR COLLATE NOCASE' : 'VARCHAR';
  switch (t.xtype) {
    case SqlType.TinyInt: return 'UTINYINT';
    case SqlType.SmallInt: return 'SMALLINT';
    case SqlType.Int: return 'INTEGER';
    case SqlType.BigInt: return 'BIGINT';
    case SqlType.Bit: return 'BOOLEAN';
    case SqlType.Decimal:
    case SqlType.Numeric: return `DECIMAL(${t.precision},${t.scale})`;
    case SqlType.Money: return 'DECIMAL(19,4)';
    case SqlType.SmallMoney: return 'DECIMAL(10,4)';
    case SqlType.Float: return 'DOUBLE';
    case SqlType.Real: return 'FLOAT';
    case SqlType.DateTime:
    case SqlType.SmallDateTime:
    case SqlType.DateTime2: return 'TIMESTAMP';
    case SqlType.DateTimeOffset: return 'TIMESTAMPTZ';
    case SqlType.Date: return 'DATE';
    case SqlType.Time: return 'TIME';
    case SqlType.UniqueIdentifier: return 'UUID';
    case SqlType.Char:
    case SqlType.VarChar:
    case SqlType.Text:
    case SqlType.NChar:
    case SqlType.NVarChar:
    case SqlType.NText: return text;
    default: return 'BLOB';
  }
}

function append(a: DuckDBAppender, v: SqlValue, t: TypeInfo): void {
  if (v === null) return a.appendNull();
  switch (t.xtype) {
    case SqlType.TinyInt: return a.appendUTinyInt(v as number);
    case SqlType.SmallInt: return a.appendSmallInt(v as number);
    case SqlType.Int: return a.appendInteger(v as number);
    case SqlType.BigInt: return a.appendBigInt(v as bigint);
    case SqlType.Bit: return a.appendBoolean(v as boolean);
    case SqlType.Float: return a.appendDouble(v as number);
    case SqlType.Real: return a.appendFloat(v as number);
    case SqlType.Decimal:
    case SqlType.Numeric:
    case SqlType.Money:
    case SqlType.SmallMoney: {
      const d = v as DecimalValue;
      const width = t.xtype === SqlType.Money ? 19 : t.xtype === SqlType.SmallMoney ? 10 : t.precision;
      return a.appendDecimal(new DuckDBDecimalValue(d.unscaled, width, d.scale));
    }
    case SqlType.DateTime:
    case SqlType.SmallDateTime:
    case SqlType.DateTime2: return a.appendTimestamp(timestampValue((v as TimestampValue).micros));
    case SqlType.DateTimeOffset: return a.appendTimestampTZ(new DuckDBTimestampTZValue((v as TimestampValue).micros));
    case SqlType.Date: return a.appendDate(dateValue((v as DateValue).days));
    case SqlType.Time: return a.appendTime(timeValue((v as TimeValue).micros));
    case SqlType.UniqueIdentifier: return a.appendUUID(uuidValue(BigInt(`0x${(v as string).replace(/-/g, '')}`)));
    default:
      if (typeof v === 'string') return a.appendVarchar(v);
      return a.appendBlob(v as Uint8Array);
  }
}

async function sha256(path: string): Promise<string> {
  const h = createHash('sha256');
  for await (const chunk of createReadStream(path)) h.update(chunk as Buffer);
  return h.digest('hex');
}

/**
 * MDF -> DuckDB. Reads the data file directly (read-only), writes every user
 * table plus a `_meta` schema with keys, foreign keys and provenance. The
 * target is replaced atomically, so a server reading the old file never sees
 * a half-written database.
 */
export async function exportMdfToDuckDb(mdfPath: string, outPath: string, opts: ExportOptions = {}): Promise<ExportReport> {
  const started = performance.now();
  const log = opts.onProgress ?? (() => undefined);
  const exclude = (opts.excludeTables ?? []).map(globRe);
  const deny = (opts.denyColumns ?? DEFAULT_DENY_COLUMNS).map(globRe);
  const ci = opts.caseInsensitive ?? true;

  const file = new MdfFile(mdfPath);
  const catalog = new Catalog(file);
  const tables = catalog.tables().filter((t) => !exclude.some((r) => r.test(`${t.schema}.${t.name}`)));
  const report: ExportReport = {
    source: mdfPath,
    sha256: await sha256(mdfPath),
    formatVersion: catalog.version,
    tables: [],
    computed: [],
    warnings: [],
    elapsedMs: 0,
  };

  const tmp = `${outPath}.tmp-${process.pid}`;
  for (const p of [tmp, `${tmp}.wal`]) if (existsSync(p)) rmSync(p);
  const db = await DuckDBInstance.create(tmp);
  const con = await db.connect();
  let ok = false;
  try {
    await createMeta(con, report, catalog.version);
    for (const t of tables) await exportTable(con, file, t, deny, ci, report, log);
    await writeKeys(con, tables, deny);
    await con.run('CHECKPOINT');
    ok = true;
  } finally {
    con.closeSync();
    db.closeSync();
    file.close();
    if (!ok) for (const p of [tmp, `${tmp}.wal`]) if (existsSync(p)) rmSync(p);
  }
  renameSync(tmp, outPath);
  report.elapsedMs = Math.round(performance.now() - started);
  return report;
}

async function createMeta(con: DuckDBConnection, report: ExportReport, version: number): Promise<void> {
  await con.run(`CREATE SCHEMA _meta`);
  await con.run(`CREATE TABLE _meta.source (mdf_path VARCHAR, mdf_sha256 VARCHAR, format_version INTEGER, converted_at TIMESTAMP)`);
  await con.run(`INSERT INTO _meta.source VALUES ($1, $2, $3, now()::TIMESTAMP)`, [report.source, report.sha256, version]);
  await con.run(`CREATE TABLE _meta.columns (table_schema VARCHAR, table_name VARCHAR, column_name VARCHAR, ordinal INTEGER, sql_type VARCHAR, is_nullable BOOLEAN, computed_definition VARCHAR)`);
  await con.run(`CREATE TABLE _meta.primary_keys (table_schema VARCHAR, table_name VARCHAR, column_name VARCHAR, ordinal INTEGER)`);
  await con.run(`CREATE TABLE _meta.foreign_keys (name VARCHAR, table_schema VARCHAR, table_name VARCHAR, column_name VARCHAR, ref_schema VARCHAR, ref_table VARCHAR, ref_column VARCHAR, ordinal INTEGER)`);
}

function sqlTypeName(c: ColumnDef): string {
  const t = c.type;
  const name = TYPE_NAMES[t.xtype] ?? `type${t.xtype}`;
  if (t.xtype === SqlType.Decimal || t.xtype === SqlType.Numeric) return `${name}(${t.precision},${t.scale})`;
  if ([SqlType.VarChar, SqlType.Char, SqlType.VarBinary, SqlType.Binary].includes(t.xtype)) return `${name}(${t.length < 0 ? 'max' : t.length})`;
  if ([SqlType.NVarChar, SqlType.NChar].includes(t.xtype)) return `${name}(${t.length < 0 ? 'max' : t.length / 2})`;
  return name;
}

async function exportTable(
  con: DuckDBConnection,
  file: MdfFile,
  t: TableDef,
  deny: RegExp[],
  ci: boolean,
  report: ExportReport,
  log: (m: string) => void,
): Promise<void> {
  const columns = t.columns.filter((c) => !deny.some((r) => r.test(c.name)));
  const skipped = t.columns.filter((c) => !columns.includes(c)).map((c) => c.name);
  const id = `${q(t.schema)}.${q(t.name)}`;
  await con.run(`CREATE SCHEMA IF NOT EXISTS ${q(t.schema)}`);
  await con.run(`CREATE TABLE ${id} (${columns.map((c) => `${q(c.name)} ${duckType(c.type, ci)}`).join(', ')})`);

  const appender = await con.createAppender(t.name, t.schema);
  let rows = 0;
  for (const row of new TableReader(file, t, columns).rows()) {
    for (let i = 0; i < columns.length; i++) append(appender, row[i], columns[i].type);
    appender.endRow();
    rows++;
  }
  appender.closeSync();

  // Non-persisted computed columns are not in the file: evaluate their formula.
  for (const c of columns.filter((x) => x.computed)) {
    try {
      const expr = translateComputed(c.computed!);
      await con.run(`UPDATE ${id} SET ${q(c.name)} = CAST(${expr} AS ${duckType(c.type, ci)})`);
      report.computed.push({ column: `${t.schema}.${t.name}.${c.name}`, expression: expr });
    } catch (err) {
      report.warnings.push(`${t.schema}.${t.name}.${c.name}: computed column left NULL (${(err as Error).message})`);
    }
  }

  for (const [i, c] of columns.entries()) {
    await con.run(`INSERT INTO _meta.columns VALUES ($1, $2, $3, $4, $5, $6, $7)`, [
      t.schema, t.name, c.name, i + 1, sqlTypeName(c), c.nullable, c.computed ?? null,
    ]);
  }
  report.tables.push({ name: `${t.schema}.${t.name}`, rows, columns: columns.length, skippedColumns: skipped });
  log(`${t.schema}.${t.name}: ${rows} rows${skipped.length ? ` (withheld: ${skipped.join(', ')})` : ''}`);
}

async function writeKeys(con: DuckDBConnection, tables: TableDef[], deny: RegExp[]): Promise<void> {
  const exported = new Set(tables.map((t) => `${t.schema}.${t.name}`));
  for (const t of tables) {
    for (const [i, c] of t.primaryKey.entries()) {
      await con.run(`INSERT INTO _meta.primary_keys VALUES ($1, $2, $3, $4)`, [t.schema, t.name, c, i + 1]);
    }
    for (const fk of t.foreignKeys) {
      if (!exported.has(fk.refTable)) continue;
      if ([...fk.columns, ...fk.refColumns].some((c) => deny.some((r) => r.test(c)))) continue;
      const [refSchema, refTable] = fk.refTable.split('.');
      for (const [i, c] of fk.columns.entries()) {
        await con.run(`INSERT INTO _meta.foreign_keys VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [
          fk.name, t.schema, t.name, c, refSchema, refTable, fk.refColumns[i], i + 1,
        ]);
      }
    }
  }
}
