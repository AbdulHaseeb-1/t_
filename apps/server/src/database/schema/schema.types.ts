export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  pk: boolean;
  identity: boolean;
  /** `schema.table.column` this column references. */
  fk?: string;
  description?: string;
  /** Most frequent distinct values of a low-cardinality text column. */
  values?: string[];
}

export interface TableInfo {
  /** `schema.table` */
  id: string;
  schema: string;
  name: string;
  kind: 'table' | 'view';
  rowCount?: number;
  description?: string;
  columns: ColumnInfo[];
}

export interface SchemaSnapshot {
  database: string;
  generatedAt: string;
  tables: TableInfo[];
}

export interface SchemaContext {
  /** Compact schema text for the prompt. */
  text: string;
  /** Tables included in full detail. */
  tables: string[];
  /** True when the whole schema fit; stable prefix => provider prompt-cache hits. */
  full: boolean;
  /** Fingerprint of the entire schema; changes invalidate caches. */
  schemaHash: string;
}
