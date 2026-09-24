import type { ColumnInfo, SchemaSnapshot, TableInfo } from './schema.types.js';

/**
 * One round trip, four result sets, catalog views only: cheap even on large
 * databases (row counts come from partition metadata, not COUNT(*)).
 */
export const INTROSPECTION_SQL = `
SELECT o.object_id, s.name AS schema_name, o.name AS table_name, o.type AS kind,
  CAST(ep.value AS nvarchar(1000)) AS description,
  (SELECT SUM(p.rows) FROM sys.partitions p WHERE p.object_id = o.object_id AND p.index_id IN (0, 1)) AS row_count
FROM sys.objects o
JOIN sys.schemas s ON s.schema_id = o.schema_id
LEFT JOIN sys.extended_properties ep
  ON ep.class = 1 AND ep.major_id = o.object_id AND ep.minor_id = 0 AND ep.name = 'MS_Description'
WHERE o.type IN ('U', 'V') AND o.is_ms_shipped = 0;

SELECT c.object_id, c.column_id, c.name, t.name AS type_name, c.max_length, c.precision, c.scale,
  c.is_nullable, c.is_identity, CAST(ep.value AS nvarchar(1000)) AS description
FROM sys.columns c
JOIN sys.types t ON t.user_type_id = c.user_type_id
JOIN sys.objects o ON o.object_id = c.object_id AND o.type IN ('U', 'V') AND o.is_ms_shipped = 0
LEFT JOIN sys.extended_properties ep
  ON ep.class = 1 AND ep.major_id = c.object_id AND ep.minor_id = c.column_id AND ep.name = 'MS_Description'
ORDER BY c.object_id, c.column_id;

SELECT ic.object_id, c.name AS column_name
FROM sys.indexes i
JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
WHERE i.is_primary_key = 1;

SELECT fkc.parent_object_id, pc.name AS parent_column,
  rs.name AS ref_schema, ro.name AS ref_table, rc.name AS ref_column
FROM sys.foreign_key_columns fkc
JOIN sys.columns pc ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
JOIN sys.objects ro ON ro.object_id = fkc.referenced_object_id
JOIN sys.schemas rs ON rs.schema_id = ro.schema_id
JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id;
`;

type Row = Record<string, unknown>;

function sqlType(r: Row): string {
  const name = String(r.type_name);
  const len = Number(r.max_length);
  switch (name) {
    case 'varchar':
    case 'char':
    case 'varbinary':
    case 'binary':
      return `${name}(${len === -1 ? 'max' : len})`;
    case 'nvarchar':
    case 'nchar':
      return `${name}(${len === -1 ? 'max' : len / 2})`;
    case 'decimal':
    case 'numeric':
      return `${name}(${r.precision},${r.scale})`;
    default:
      return name;
  }
}

function text(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

export function buildSnapshot(database: string, recordsets: Row[][]): SchemaSnapshot {
  const [objects = [], columns = [], pks = [], fks = []] = recordsets;

  const pkSet = new Set(pks.map((r) => `${r.object_id}:${r.column_name}`));
  const fkMap = new Map(
    fks.map((r) => [
      `${r.parent_object_id}:${r.parent_column}`,
      `${r.ref_schema}.${r.ref_table}.${r.ref_column}`,
    ]),
  );

  const colsByObject = new Map<number, ColumnInfo[]>();
  for (const r of columns) {
    const id = Number(r.object_id);
    const list = colsByObject.get(id) ?? [];
    list.push({
      name: String(r.name),
      type: sqlType(r),
      nullable: Boolean(r.is_nullable),
      pk: pkSet.has(`${id}:${r.name}`),
      identity: Boolean(r.is_identity),
      fk: fkMap.get(`${id}:${r.name}`),
      description: text(r.description),
    });
    colsByObject.set(id, list);
  }

  const tables: TableInfo[] = objects.map((r) => {
    const id = Number(r.object_id);
    const kind = String(r.kind).trim() === 'V' ? 'view' : 'table';
    return {
      id: `${r.schema_name}.${r.table_name}`,
      schema: String(r.schema_name),
      name: String(r.table_name),
      kind,
      rowCount: kind === 'table' && r.row_count != null ? Number(r.row_count) : undefined,
      description: text(r.description),
      columns: colsByObject.get(id) ?? [],
    };
  });
  tables.sort((a, b) => a.id.localeCompare(b.id));

  return { database, generatedAt: new Date().toISOString(), tables };
}
