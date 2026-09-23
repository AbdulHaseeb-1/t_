import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import sql from 'mssql';
import { AppConfig } from '../config/app-config.js';
import { SqlExecutionError } from '../common/errors.js';
import type { QueryResult, ResultColumn } from './database.types.js';
import { assertReadOnlySql } from './sql-guard.js';

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
  private readonly pool: sql.ConnectionPool;
  private connecting?: Promise<sql.ConnectionPool>;

  constructor(private readonly config: AppConfig) {
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

  async onModuleInit(): Promise<void> {
    // Warm the pool, but never block boot on the database being reachable.
    this.connect().catch((err: Error) => this.logger.error(`Database not reachable yet: ${err.message}`));
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.close().catch(() => undefined);
  }

  async ping(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
    const started = performance.now();
    try {
      await (await this.connect()).request().query('SELECT 1');
      return { ok: true, latencyMs: Math.round(performance.now() - started) };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  /** Trusted internal SQL (introspection). Never pass user or LLM input here. */
  async internalQuery(text: string): Promise<Record<string, unknown>[][]> {
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
    const safe = assertReadOnlySql(text);
    const cap = Math.min(maxRows, this.config.get('DB_MAX_ROWS'));
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
    if (this.pool.connected) return Promise.resolve(this.pool);
    this.connecting ??= this.pool
      .connect()
      .then((p) => {
        this.logger.log(`Connected to ${this.config.get('DB_HOST')}/${this.config.get('DB_NAME')}`);
        return p;
      })
      .finally(() => (this.connecting = undefined));
    return this.connecting;
  }
}
