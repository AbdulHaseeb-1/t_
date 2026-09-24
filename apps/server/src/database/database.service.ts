import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import sql from 'mssql';
import { AppConfig } from '../config/app-config.js';
import { SqlExecutionError } from '../common/errors.js';
import { existsSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import { exportMdfToDuckDb } from '../mdf/export-duckdb.js';
import type { QueryResult, ResultColumn } from './database.types.js';
import { DuckDbEngine } from './duckdb-engine.js';
import { assertNoDeniedColumns, assertNoStarProjection, assertReadOnlySql, globToRegExp, type SqlDialect } from './sql-guard.js';

interface ColumnMeta {
  name: string;
  type?: unknown;
}

function typeName(meta: ColumnMeta): string {
  const t = meta.type as { declaration?: string; name?: string } | undefined;
  return t?.declaration ?? t?.name ?? 'unknown';
}

/** JSON-safe, prompt-friendly cell values. */
function normalizeCell(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (Buffer.isBuffer(v))
    return v.length > 32 ? `0x${v.subarray(0, 32).toString('hex')}...` : `0x${v.toString('hex')}`;
  if (typeof v === 'bigint') return v.toString();
  return v;
}

@Injectable()
export class DatabaseService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseService.name);
  private readonly pool?: sql.ConnectionPool;
  private readonly denied: RegExp[];
  private connecting?: Promise<sql.ConnectionPool>;
  private duck?: Promise<DuckDbEngine>;
  /** SQL dialect the model must write and the guard must parse. */
  readonly dialect: SqlDialect;

  constructor(private readonly config: AppConfig) {
    this.denied = config.get('DB_DENY_COLUMNS').map(globToRegExp);
    this.dialect = config.get('DB_ENGINE') === 'duckdb' ? 'duckdb' : 'tsql';
    if (this.dialect === 'duckdb') return;
    this.pool = new sql.ConnectionPool({
      server: config.get('DB_HOST'),
      port: config.get('DB_PORT'),
      database: config.get('DB_NAME'),
      user: config.get('DB_USER'),
      password: config.get('DB_PASSWORD'),
      requestTimeout: config.get('DB_REQUEST_TIMEOUT_MS'),
      connectionTimeout: 15_000,
      arrayRowMode: true,
      pool: { max: config.get('DB_POOL_MAX'), min: 1, idleTimeoutMillis: 60_000 },
      options: {
        encrypt: config.get('DB_ENCRYPT'),
        trustServerCertificate: config.get('DB_TRUST_SERVER_CERT'),
        appName: 'db-intelligence',
        useUTC: true,
      },
    });
    this.pool.on('error', (err: Error) => this.logger.error(`Pool error: ${err.message}`));
  }

  /** Display name of the data source (SQL Server database or DuckDB file). */
  get databaseName(): string {
    return this.dialect === 'duckdb' ? basename(this.config.get('DUCKDB_FILE')).replace(/\.duckdb$/i, '') : this.config.get('DB_NAME');
  }

  async onModuleInit(): Promise<void> {
    // Warm the pool, but never block boot on the database being reachable.
    if (this.dialect === 'duckdb') {
      this.duckdb().catch((err: Error) => this.logger.error(`DuckDB not available: ${err.message}`));
      return;
    }
    this.connect().catch((err: Error) => this.logger.error(`Database not reachable yet: ${err.message}`));
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.duck) (await this.duck.catch(() => undefined))?.close();
    await this.pool?.close().catch(() => undefined);
  }

  /**
   * Opens the DuckDB file, converting MDF_IMPORT_PATH first when the DuckDB file is
   * missing or older than it. The .mdf is only ever read.
   */
  private duckdb(): Promise<DuckDbEngine> {
    this.duck ??= (async () => {
      const target = this.config.get('DUCKDB_FILE');
      const mdf = this.config.get('MDF_IMPORT_PATH');
      if (mdf && (!existsSync(target) || statSync(target).mtimeMs < statSync(mdf).mtimeMs)) {
        this.logger.log(`Converting ${mdf} -> ${target} ...`);
        const report = await exportMdfToDuckDb(mdf, target, {
          denyColumns: this.config.get('DB_DENY_COLUMNS'),
          excludeTables: this.config.get('MDF_IMPORT_EXCLUDE'),
        });
        const rows = report.tables.reduce((n, t) => n + t.rows, 0);
        this.logger.log(`Converted ${report.tables.length} tables, ${rows} rows in ${report.elapsedMs} ms`);
        for (const w of report.warnings) this.logger.warn(w);
      }
      const engine = await DuckDbEngine.open(target);
      this.logger.log(`Opened ${target} read-only`);
      return engine;
    })();
    // A failed open is retried on the next request instead of being cached.
    this.duck.catch(() => (this.duck = undefined));
    return this.duck;
  }

  /**
   * DuckDB mode: pick up a newer .mdf (re-converting it) or a replaced DuckDB
   * file. The new file is opened before the old one is closed, and the old one
   * stays open briefly so in-flight queries finish.
   */
  async reload(): Promise<void> {
    if (this.dialect !== 'duckdb' || !this.duck) return;
    const old = this.duck;
    this.duck = undefined;
    try {
      await this.duckdb();
    } catch (err) {
      this.duck = old; // keep serving the previous data
      throw err;
    }
    setTimeout(() => void old.then((e) => e.close()).catch(() => undefined), 30_000).unref();
  }

  async ping(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
    const started = performance.now();
    try {
      if (this.dialect === 'duckdb') await (await this.duckdb()).query('SELECT 1', 1, 5_000);
      else await (await this.connect()).request().query('SELECT 1');
      return { ok: true, latencyMs: Math.round(performance.now() - started) };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  /** Trusted internal SQL (introspection). Never pass user or LLM input here. */
  async internalQuery(text: string): Promise<Record<string, unknown>[][]> {
    if (this.dialect === 'duckdb') return [await (await this.duckdb()).internal(text)];
    const req = (await this.connect()).request();
    req.arrayRowMode = false;
    const res = await req.query(text);
    return res.recordsets as unknown as Record<string, unknown>[][];
  }

  /**
   * Executes untrusted SQL (user- or LLM-authored) under four independent
   * safeguards: read-only policy check, row cap, server-side timeout, and a
   * transaction that is always rolled back. For full defence, also connect
   * with a login that only has `db_datareader`.
   */
  async readOnlyQuery(text: string, maxRows = this.config.get('DB_MAX_ROWS')): Promise<QueryResult> {
    const safe = assertReadOnlySql(text, this.dialect);
    assertNoDeniedColumns(safe, this.denied);
    if (this.denied.length) assertNoStarProjection(safe);
    const cap = Math.min(maxRows, this.config.get('DB_MAX_ROWS'));
    if (this.dialect === 'duckdb') {
      const engine = await this.duckdb();
      try {
        return await engine.query(safe, cap, this.config.get('DB_REQUEST_TIMEOUT_MS'));
      } catch (err) {
        throw new SqlExecutionError((err as Error).message, safe);
      }
    }
    const pool = await this.connect();
    const tx = new sql.Transaction(pool);
    await tx.begin(
      this.config.get('DB_READ_UNCOMMITTED')
        ? sql.ISOLATION_LEVEL.READ_UNCOMMITTED
        : sql.ISOLATION_LEVEL.READ_COMMITTED,
    );

    const started = performance.now();
    try {
      // cap + 1 rows lets us detect truncation without a COUNT(*) round trip.
      const res = await new sql.Request(tx).query(`SET ROWCOUNT ${cap + 1};\n${safe}`);
      const elapsedMs = Math.round(performance.now() - started);
      const recordset = (res.recordsets as unknown as unknown[][][])[0] ?? [];
      const meta = ((res as unknown as { columns?: ColumnMeta[][] }).columns ?? [])[0] ?? [];
      const columns: ResultColumn[] = meta.map((m) => ({ name: m.name, type: typeName(m) }));
      const truncated = recordset.length > cap;
      const rows = (truncated ? recordset.slice(0, cap) : recordset).map((r) => r.map(normalizeCell));
      return { columns, rows, rowCount: rows.length, truncated, elapsedMs };
    } catch (err) {
      throw new SqlExecutionError((err as Error).message, safe);
    } finally {
      await new sql.Request(tx).query('SET ROWCOUNT 0').catch(() => undefined);
      await tx.rollback().catch(() => undefined);
    }
  }

  private connect(): Promise<sql.ConnectionPool> {
    const pool = this.pool;
    if (!pool) return Promise.reject(new Error('SQL Server is not configured (DB_ENGINE=duckdb)'));
    if (pool.connected) return Promise.resolve(pool);
    this.connecting ??= pool
      .connect()
      .then((p) => {
        this.logger.log(`Connected to ${this.config.get('DB_HOST')}/${this.config.get('DB_NAME')}`);
        return p;
      })
      .finally(() => (this.connecting = undefined));
    return this.connecting;
  }
}
