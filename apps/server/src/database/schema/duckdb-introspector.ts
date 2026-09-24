import type { ColumnInfo, SchemaSnapshot, TableInfo } from './schema.types.js';

type Query = (sql: string) => Promise<Record<string, unknown>[]>;

const str = (v: unknown) => String(v ?? '');
const num = (v: unknown) => Number(v ?? 0);
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;

/**
 * Schema of a DuckDB file. Files converted from an .mdf carry a `_meta` schema
 * with the original SQL Server types, primary keys and foreign keys, so the
 * model sees the same schema as with a live SQL Server. Plain DuckDB files
 * fall back to DuckDB's own catalog.
 */
export async function introspectDuckDb(database: string, query: Query): Promise<SchemaSnapshot> {
  const hasMeta = (await query(`SELECT count(*) AS n FROM duckdb_tables() WHERE schema_name = '_meta' AND table_name = 'columns'`))[0]?.n;

  const objects = await query(
    `SELECT schema_name, table_name AS name, 'table' AS kind FROM duckdb_tables() WHERE NOT internal AND schema_name <> '_meta'
     UNION ALL
     SELECT schema_name, view_name, 'view' FROM duckdb_views() WHERE NOT internal AND schema_name NOT IN ('_meta', 'information_schema', 'pg_catalog')
     ORDER BY 1, 2`,
  );
  if (objects.length === 0) return { database, generatedAt: new Date().toISOString(), tables: [] };

  const columns = num(hasMeta)
    ? await query(`SELECT table_schema, table_name, column_name, sql_type AS type, is_nullable FROM _meta.columns ORDER BY table_schema, table_name, ordinal`)
    : await query(
        `SELECT table_schema, table_name, column_name, lower(data_type) AS type, is_nullable = 'YES' AS is_nullable
         FROM information_schema.columns WHERE table_schema <> '_meta' ORDER BY table_schema, table_name, ordinal_position`,
      );

  const pk = new Set<string>();
  const fk = new Map<string, string>();
  if (num(hasMeta)) {
    for (const r of await query(`SELECT table_schema, table_name, column_name FROM _meta.primary_keys`)) {
      pk.add(`${str(r.table_schema)}.${str(r.table_name)}.${str(r.column_name)}`);
    }
    for (const r of await query(`SELECT table_schema, table_name, column_name, ref_schema, ref_table, ref_column FROM _meta.foreign_keys`)) {
      fk.set(`${str(r.table_schema)}.${str(r.table_name)}.${str(r.column_name)}`, `${str(r.ref_schema)}.${str(r.ref_table)}.${str(r.ref_column)}`);
    }
  } else {
    for (const r of await query(
      `SELECT schema_name, table_name, constraint_type, unnest(constraint_column_names) AS column_name
       FROM duckdb_constraints() WHERE constraint_type = 'PRIMARY KEY'`,
    )) {
      pk.add(`${str(r.schema_name)}.${str(r.table_name)}.${str(r.column_name)}`);
    }
  }

  // Exact counts are cheap in DuckDB (kept in metadata for base tables).
  const tables = objects.filter((o) => str(o.kind) === 'table');
  const counts = new Map<string, number>();
  if (tables.length) {
    const sql = tables
      .map((t) => `SELECT ${lit(`${str(t.schema_name)}.${str(t.name)}`)} AS id, count(*) AS n FROM ${ident(str(t.schema_name))}.${ident(str(t.name))}`)
      .join(' UNION ALL ');
    for (const r of await query(sql)) counts.set(str(r.id), num(r.n));
  }

  const byTable = new Map<string, ColumnInfo[]>();
  for (const c of columns) {
    const id = `${str(c.table_schema)}.${str(c.table_name)}`;
    const key = `${id}.${str(c.column_name)}`;
    const list = byTable.get(id) ?? [];
    list.push({
      name: str(c.column_name),
      type: str(c.type),
      nullable: Boolean(c.is_nullable),
      pk: pk.has(key),
      identity: false,
      ...(fk.has(key) ? { fk: fk.get(key) } : {}),
    });
    byTable.set(id, list);
  }

  const out: TableInfo[] = objects.map((o) => {
    const id = `${str(o.schema_name)}.${str(o.name)}`;
    return {
      id,
      schema: str(o.schema_name),
      name: str(o.name),
      kind: str(o.kind) === 'view' ? 'view' : 'table',
      rowCount: counts.get(id),
      columns: byTable.get(id) ?? [],
    };
  });
  return { database, generatedAt: new Date().toISOString(), tables: out };
}
