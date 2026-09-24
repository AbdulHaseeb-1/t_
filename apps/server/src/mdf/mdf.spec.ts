import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { DuckDBInstance } from '@duckdb/node-api';
import { Catalog } from './catalog.js';
import { exportMdfToDuckDb } from './export-duckdb.js';
import { MdfFile } from './mdf-file.js';
import { convertedTables, duckCanonicalRows } from './verify.js';

/**
 * test/fixtures/mdf/MdfFixture.mdf.gz is a real SQL Server 2022 data file built
 * by infra/mssql/mdf-fixture.sql. The golden file holds SQL Server's own
 * canonical rendering of every row (hashed), so these tests check the reader
 * byte for byte against SQL Server without needing one.
 */
const FIXTURES = join(import.meta.dirname, '../../test/fixtures/mdf');
const dir = mkdtempSync(join(tmpdir(), 'mdf-'));
const mdf = join(dir, 'MdfFixture.mdf');
writeFileSync(mdf, gunzipSync(readFileSync(join(FIXTURES, 'MdfFixture.mdf.gz'))));
const golden = JSON.parse(readFileSync(join(FIXTURES, 'MdfFixture.golden.json'), 'utf8')) as Record<string, { rows: string[] }>;
const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
const rowHash = (k: string) => createHash('sha256').update(k).digest('hex').slice(0, 32);

describe('MDF reader', () => {
  it('reads the catalog: schemas, keys, foreign keys, computed columns, dropped columns', () => {
    const file = new MdfFile(mdf);
    const tables = new Catalog(file).tables();
    file.close();
    const byName = new Map(tables.map((t) => [`${t.schema}.${t.name}`, t]));
    expect([...byName.keys()]).toEqual(['dbo.AllTypes', 'dbo.Dups', 'dbo.Evolved', 'dbo.HeapFwd', 'dbo.Overflow', 'sales.Orders']);

    const orders = byName.get('sales.Orders')!;
    expect(orders.primaryKey).toEqual(['shop', 'order_no']);
    expect(orders.foreignKeys).toMatchObject([{ columns: ['item'], refTable: 'dbo.AllTypes', refColumns: ['id'] }]);
    expect(orders.columns.find((c) => c.name === 'total')?.computed).toMatch(/CONVERT\(\[decimal\]\(15,2\)/);
    // persisted computed columns are stored and read like any other column
    expect(orders.columns.find((c) => c.name === 'total_p')?.computed).toBeUndefined();

    expect(byName.get('dbo.Evolved')!.columns.map((c) => c.name)).toEqual(['id', 'keep1', 'keep2', 'added_null', 'added_default', 'added_text']);
    expect(byName.get('dbo.HeapFwd')!.heap).toBe(true);
  });

  it('converts every row exactly as SQL Server renders it, and never modifies the source', async () => {
    const before = sha(mdf);
    const out = join(dir, 'fixture.duckdb');
    const report = await exportMdfToDuckDb(mdf, out, { denyColumns: [] });
    expect(sha(mdf)).toBe(before);
    expect(report.warnings).toEqual([]);
    expect(report.computed.map((c) => c.column)).toEqual(['sales.Orders.total']);

    const con = await (await DuckDBInstance.create(out, { access_mode: 'READ_ONLY' })).connect();
    try {
      const tables = await convertedTables(con);
      expect([...tables.keys()].sort()).toEqual(Object.keys(golden).sort());
      for (const [table, { columns }] of tables) {
        const ours = (await duckCanonicalRows(con, table, columns)).map(rowHash).sort();
        expect({ table, rows: ours }).toEqual({ table, rows: golden[table].rows });
      }
      // Keys land in _meta for the query layer.
      const pk = await con.runAndReadAll(`SELECT column_name FROM _meta.primary_keys WHERE table_name = 'Orders' ORDER BY ordinal`);
      expect(pk.getRows().flat()).toEqual(['shop', 'order_no']);
    } finally {
      con.closeSync();
    }
  });

  it('withholds sensitive columns and excluded tables entirely', async () => {
    const out = join(dir, 'filtered.duckdb');
    const report = await exportMdfToDuckDb(mdf, out, { denyColumns: ['*vmax*', 'txt'], excludeTables: ['dbo.Heap*'] });
    expect(report.tables.map((t) => t.name)).not.toContain('dbo.HeapFwd');
    expect(report.tables.find((t) => t.name === 'dbo.AllTypes')?.skippedColumns).toEqual(['vmax', 'nvmax', 'txt']);
    const con = await (await DuckDBInstance.create(out, { access_mode: 'READ_ONLY' })).connect();
    const cols = await con.runAndReadAll(`SELECT column_name FROM information_schema.columns WHERE table_name = 'AllTypes'`);
    con.closeSync();
    expect(cols.getRows().flat()).not.toContain('vmax');
    expect(statSync(out).size).toBeGreaterThan(0);
  });

  it('keeps SQL Server comparison semantics: case-insensitive text, trimmed CHAR padding', async () => {
    const con = await (await DuckDBInstance.create(join(dir, 'fixture.duckdb'), { access_mode: 'READ_ONLY' })).connect();
    const r = await con.runAndReadAll(`SELECT count(*) FROM dbo.AllTypes WHERE c = 'CAFÉ €URO' OR c = 'A'`);
    con.closeSync();
    expect(Number(r.getRows()[0][0])).toBe(2);
  });

  it('rejects files that are not SQL Server data files', () => {
    const bogus = join(dir, 'bogus.mdf');
    writeFileSync(bogus, Buffer.alloc(8192 * 16));
    expect(() => new MdfFile(bogus)).toThrow(/not a file header page/);
    writeFileSync(bogus, Buffer.alloc(1000));
    expect(() => new MdfFile(bogus)).toThrow(/not a multiple of 8 KB/);
  });
});
