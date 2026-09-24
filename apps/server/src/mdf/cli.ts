import { parseArgs } from 'node:util';
import { Catalog } from './catalog.js';
import { DEFAULT_DENY_COLUMNS, exportMdfToDuckDb } from './export-duckdb.js';
import { MdfFile } from './mdf-file.js';
import { verifyAgainstSqlServer } from './verify.js';

const USAGE = `Read a SQL Server data file (.mdf) directly, without SQL Server.

  mdf inspect <file.mdf>
      Tables, primary and foreign keys, computed columns.

  mdf import <file.mdf> <out.duckdb> [options]
      Convert to a DuckDB file the API can query read-only (DB_ENGINE=duckdb).
      --exclude <globs>     schema.table globs to leave out, comma-separated
      --deny <globs>        column-name globs never copied (default: ${DEFAULT_DENY_COLUMNS.join(',')})
      --case-sensitive      compare text case-sensitively (default: like SQL Server's CI collations)
      --verify-db <name>    afterwards, compare every cell with <name> on the SQL Server in
                            DB_HOST/DB_PORT/DB_USER/DB_PASSWORD (same data, attached)

The .mdf is opened read-only and never modified. Use a copy (or a detached /
offline database's file): SQL Server locks the files of attached databases.
`;

const csv = (v?: string) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined);

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      exclude: { type: 'string' },
      deny: { type: 'string' },
      'case-sensitive': { type: 'boolean', default: false },
      'verify-db': { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  const [command, input, output] = positionals;
  if (values.help || !command || !input) {
    console.log(USAGE);
    process.exitCode = values.help ? 0 : 1;
    return;
  }

  if (command === 'inspect') {
    const file = new MdfFile(input);
    const catalog = new Catalog(file);
    console.log(`${input}: format ${catalog.version}, ${file.pageCount} pages`);
    for (const t of catalog.tables()) {
      const computed = t.columns.filter((c) => c.computed).map((c) => c.name);
      console.log(
        `${t.schema}.${t.name}${t.heap ? ' (heap)' : ''}: ${t.columns.length} columns` +
          (t.primaryKey.length ? `, PK(${t.primaryKey.join(', ')})` : '') +
          t.foreignKeys.map((f) => `, (${f.columns.join(', ')}) -> ${f.refTable}`).join('') +
          (computed.length ? `, computed: ${computed.join(', ')}` : ''),
      );
    }
    file.close();
    return;
  }

  if (command === 'import') {
    if (!output) throw new Error('import needs an output path, e.g. data/mds.duckdb');
    const report = await exportMdfToDuckDb(input, output, {
      excludeTables: csv(values.exclude),
      denyColumns: csv(values.deny),
      caseInsensitive: !values['case-sensitive'],
      onProgress: (m) => console.log(`  ${m}`),
    });
    const rows = report.tables.reduce((s, t) => s + t.rows, 0);
    console.log(`\n${report.tables.length} tables, ${rows} rows -> ${output} in ${(report.elapsedMs / 1000).toFixed(1)}s`);
    console.log(`source sha256 ${report.sha256}`);
    for (const c of report.computed) console.log(`computed ${c.column} = ${c.expression}`);
    for (const w of report.warnings) console.log(`WARNING ${w}`);

    if (values['verify-db']) {
      console.log(`\nVerifying every cell against ${values['verify-db']} on ${process.env.DB_HOST ?? 'localhost'} ...`);
      const results = await verifyAgainstSqlServer(output, {
        server: process.env.DB_HOST ?? 'localhost',
        port: Number(process.env.DB_PORT ?? 1433),
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: values['verify-db'],
        options: { encrypt: process.env.DB_ENCRYPT === 'true', trustServerCertificate: true },
        requestTimeout: 600_000,
      });
      const bad = results.filter((r) => r.missing || r.extra);
      for (const r of bad) console.log(`MISMATCH ${r.table}: ${r.missing} missing, ${r.extra} extra\n  ${r.sample.join('\n  ')}`);
      console.log(bad.length ? `${bad.length} table(s) differ` : `All ${results.length} tables identical to SQL Server.`);
      process.exitCode = bad.length ? 2 : 0;
    }
    return;
  }
  throw new Error(`Unknown command "${command}"\n${USAGE}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
