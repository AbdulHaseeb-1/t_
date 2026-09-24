import { existsSync } from 'node:fs';
import {
  DuckDBBlobValue,
  DuckDBDateValue,
  DuckDBDecimalValue,
  DuckDBInstance,
  DuckDBTimestampTZValue,
  DuckDBTimestampValue,
} from '@duckdb/node-api';
import type { QueryResult } from './database.types.js';

/**
 * Read-only DuckDB access. Protection does not depend on the SQL guard alone:
 *  - the file is opened with access_mode=READ_ONLY (no writes, no DDL),
 *  - external access is disabled (no files, URLs, other databases, extensions),
 *  - configuration is locked, so a statement cannot switch any of that back on,
 *  - every query runs on its own connection with a row cap and a timeout.
 */
export class DuckDbEngine {
  private constructor(
    private readonly instance: DuckDBInstance,
    readonly path: string,
  ) {}

  static async open(path: string): Promise<DuckDbEngine> {
    if (!existsSync(path)) throw new Error(`DuckDB file ${path} does not exist; convert an .mdf first (pnpm --filter server mdf import ...)`);
    const instance = await DuckDBInstance.create(path, {
      access_mode: 'READ_ONLY',
      enable_external_access: 'false',
      autoinstall_known_extensions: 'false',
      autoload_known_extensions: 'false',
      lock_configuration: 'true',
    });
    return new DuckDbEngine(instance, path);
  }

  close(): void {
    this.instance.closeSync();
  }

  /** Runs one statement; returns up to `cap` rows plus whether more existed. */
  async query(sql: string, cap: number, timeoutMs: number): Promise<QueryResult> {
    const con = await this.instance.connect();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      con.interrupt();
    }, timeoutMs);
    const started = performance.now();
    try {
      const reader = await con.streamAndReadUntil(sql, cap + 1);
      const elapsedMs = Math.round(performance.now() - started);
      const names = reader.columnNames();
      const types = reader.columnTypes();
      const all = reader.getRows();
      const truncated = all.length > cap;
      const rows = (truncated ? all.slice(0, cap) : all).map((r) => r.map(normalize));
      return {
        columns: names.map((name, i) => ({ name, type: types[i].toString().toLowerCase() })),
        rows,
        rowCount: rows.length,
        truncated,
        elapsedMs,
      };
    } catch (err) {
      if (timedOut) throw new Error(`Query exceeded the ${timeoutMs} ms time limit`);
      throw err;
    } finally {
      clearTimeout(timer);
      con.closeSync();
    }
  }

  /** Trusted internal SQL (introspection): all rows as plain objects. */
  async internal(sql: string): Promise<Record<string, unknown>[]> {
    const con = await this.instance.connect();
    try {
      const reader = await con.runAndReadAll(sql);
      const names = reader.columnNames();
      return reader.getRows().map((r) => Object.fromEntries(r.map((v, i) => [names[i], normalize(v)])));
    } finally {
      con.closeSync();
    }
  }
}

/** JSON-safe, prompt-friendly cell values (same shapes the SQL Server path returns). */
export function normalize(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === 'bigint') return Number.isSafeInteger(Number(v)) ? Number(v) : v.toString();
  if (typeof v !== 'object') return v;
  if (v instanceof DuckDBDecimalValue) return v.toDouble();
  if (v instanceof DuckDBTimestampValue || v instanceof DuckDBTimestampTZValue) {
    return new Date(Number(v.micros / 1000n)).toISOString();
  }
  if (v instanceof DuckDBDateValue) return v.toString();
  if (v instanceof DuckDBBlobValue) {
    const hex = Buffer.from(v.bytes).toString('hex');
    return hex.length > 64 ? `0x${hex.slice(0, 64)}...` : `0x${hex}`;
  }
  return String(v);
}
