import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { exportMdfToDuckDb } from '../mdf/export-duckdb.js';
import { DuckDbEngine } from './duckdb-engine.js';
import { assertReadOnlySql } from './sql-guard.js';

/**
 * The engine must stay read-only even if the SQL guard were bypassed: these
 * statements go straight to DuckDB.
 */
const dir = mkdtempSync(join(tmpdir(), 'duck-'));
const mdf = join(dir, 'f.mdf');
const out = join(dir, 'f.duckdb');
let engine: DuckDbEngine;

beforeAll(async () => {
  writeFileSync(mdf, gunzipSync(readFileSync(join(import.meta.dirname, '../../test/fixtures/mdf/MdfFixture.mdf.gz'))));
  writeFileSync(join(dir, 'secret.csv'), 'a,b\n1,2\n');
  await exportMdfToDuckDb(mdf, out);
  engine = await DuckDbEngine.open(out);
});
afterAll(() => engine?.close());

describe('DuckDbEngine (no guard in front)', () => {
  it('answers read-only queries with a row cap', async () => {
    const r = await engine.query('SELECT id, v FROM dbo.HeapFwd ORDER BY id', 5, 5_000);
    expect(r).toMatchObject({ rowCount: 5, truncated: true });
    expect(r.columns.map((c) => c.name)).toEqual(['id', 'v']);
    const agg = await engine.query('SELECT shop, sum(total) AS t FROM sales.Orders GROUP BY shop ORDER BY shop', 10, 5_000);
    expect(agg.rows).toEqual([
      [1, expect.any(Number)],
      [2, 71.05],
    ]);
  });

  it.each([
    [`SELECT * FROM read_csv('${join(dir, 'secret.csv')}')`],
    [`SELECT * FROM '${join(dir, 'secret.csv')}'`],
    [`COPY (SELECT 1) TO '${join(dir, 'leak.csv')}'`],
    [`ATTACH '${join(dir, 'other.duckdb')}' AS other`],
    ['CREATE TABLE dbo.x (a INT)'],
    ['INSERT INTO sales.Orders (shop, order_no, qty, price) VALUES (9, 9, 1, 1)'],
    ['DELETE FROM dbo.HeapFwd'],
    ['SET enable_external_access = true'],
    ['INSTALL httpfs'],
  ])('refuses %s', async (sql) => {
    await expect(engine.query(sql, 10, 5_000)).rejects.toThrow();
  });

  it('interrupts queries that run past the time limit', async () => {
    const slow = 'SELECT count(*) FROM range(100000000000) a';
    await expect(engine.query(slow, 1, 200)).rejects.toThrow(/time limit/);
  });
});

describe('SQL guard, DuckDB dialect', () => {
  it.each([
    ["SELECT * FROM read_parquet('x.parquet')", /read_parquet/],
    ["SELECT a FROM 'data.csv'", /reading files/],
    ["SELECT getenv('HOME') AS h", /getenv/],
    ["SELECT * FROM query('SELECT 1')", /query/],
    ["SELECT $$x$$ AS a", /dollar-quoted/],
    ["SELECT E'\\n' AS a", /escape-string/],
    ['SELECT [glob(\'*\')] AS a', /glob/],
    ["SELECT 1 AS a UNION ALL SELECT count(*) FROM duckdb_settings()", /duckdb_settings/],
  ])('rejects %s', (sql, why) => {
    expect(() => assertReadOnlySql(sql, 'duckdb')).toThrow(why);
  });

  it('accepts ordinary analytics SQL, including lists and QUALIFY', () => {
    const sql = `SELECT b.bName, sum(i.net_amt) AS s, [1, 2] AS l FROM dbo.InvoiceLine i JOIN dbo.BookingMan b ON b.bId = i.bId
      WHERE i.inv_date >= DATE '2026-01-01' GROUP BY b.bName QUALIFY rank() OVER (ORDER BY sum(i.net_amt) DESC) <= 3`;
    expect(assertReadOnlySql(sql, 'duckdb')).toBe(sql);
  });
});
