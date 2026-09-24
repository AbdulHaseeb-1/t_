import { renderIndex, renderTable } from './schema-renderer.js';
import { SchemaRetriever, tokenize } from './schema-retriever.js';
import type { TableInfo } from './schema.types.js';
import { buildSnapshot } from './schema-introspector.js';

const col = (name: string, extra: Partial<TableInfo['columns'][number]> = {}) => ({
  name,
  type: 'int',
  nullable: false,
  pk: false,
  identity: false,
  ...extra,
});

const tables: TableInfo[] = [
  {
    id: 'dbo.Customers',
    schema: 'dbo',
    name: 'Customers',
    kind: 'table',
    rowCount: 5000,
    columns: [col('CustomerId', { pk: true }), col('FullName', { type: 'nvarchar(100)' }), col('Country')],
  },
  {
    id: 'dbo.SalesOrders',
    schema: 'dbo',
    name: 'SalesOrders',
    kind: 'table',
    rowCount: 120_000,
    columns: [
      col('OrderId', { pk: true }),
      col('CustomerId', { fk: 'dbo.Customers.CustomerId' }),
      col('OrderDate', { type: 'datetime2' }),
      col('TotalAmount', { type: 'decimal(18,2)' }),
    ],
  },
  {
    id: 'dbo.Products',
    schema: 'dbo',
    name: 'Products',
    kind: 'table',
    rowCount: 300,
    description: 'Catalog of sellable items',
    columns: [col('ProductId', { pk: true }), col('ProductName')],
  },
  {
    id: 'audit.EventLog',
    schema: 'audit',
    name: 'EventLog',
    kind: 'table',
    rowCount: 9e6,
    columns: [col('EventId')],
  },
];

describe('tokenize', () => {
  it('splits identifiers and stems plurals', () => {
    expect(tokenize('SalesOrderLineItems')).toEqual(['sale', 'order', 'line', 'item']);
    expect(tokenize('customer_categories')).toEqual(['customer', 'category']);
    expect(tokenize('How many orders in 2024?')).toEqual(['order']);
  });
});

describe('SchemaRetriever', () => {
  const r = new SchemaRetriever(tables);

  it('ranks by table name and pulls in FK targets', () => {
    const ids = r.rank('total order amount per country last year', 1).map((t) => t.id);
    expect(ids[0]).toBe('dbo.SalesOrders');
    expect(ids).toContain('dbo.Customers');
    expect(ids).not.toContain('audit.EventLog');
  });

  it('uses descriptions', () => {
    expect(r.rank('which items are in the catalog', 3).map((t) => t.id)).toContain('dbo.Products');
  });

  it('returns nothing for unrelated questions', () => {
    expect(r.rank('the weather tomorrow', 5)).toEqual([]);
  });
});

describe('renderer', () => {
  it('renders one compact line per table', () => {
    expect(renderTable(tables[1])).toBe(
      'dbo.SalesOrders ~120.0k rows | OrderId int PK, CustomerId int ->dbo.Customers.CustomerId, OrderDate datetime2, TotalAmount decimal(18,2)',
    );
  });

  it('spells out a composite primary key once instead of marking each column', () => {
    const town: TableInfo = {
      id: 'dbo.TblTown',
      schema: 'dbo',
      name: 'TblTown',
      kind: 'table',
      rowCount: 193,
      columns: [col('town_id', { pk: true }), col('name', { type: 'varchar(30)' }), col('area_id', { pk: true })],
    };
    expect(renderTable(town)).toBe('dbo.TblTown ~193 rows | town_id int, name varchar(30), area_id int, PK(town_id, area_id)');
  });

  it('always includes a table named in the question, even when wider tables match more words', () => {
    const wide = (id: string): TableInfo => ({
      id,
      schema: 'dbo',
      name: id.slice(4),
      kind: 'table',
      columns: [col('net_sales'), col('invoice_total'), col('detail_net')],
    });
    const company: TableInfo = { id: 'dbo.Company', schema: 'dbo', name: 'Company', kind: 'table', columns: [col('comp_id', { pk: true })] };
    const r = new SchemaRetriever([wide('dbo.InvoiceDetail'), wide('dbo.InvoiceView'), wide('dbo.SalesDetail'), company]);
    expect(r.rank('top companies by net sales using invoice detail', 3).map((t) => t.id)).toContain('dbo.Company');
  });

  it('caps the names-only index', () => {
    expect(renderIndex(tables, 30)).toBe('dbo.Customers, dbo.SalesOrders, ... (+more)');
  });
});

describe('buildSnapshot', () => {
  it('maps catalog rows, PKs, FKs and types', () => {
    const s = buildSnapshot('db', [
      [
        { object_id: 1, schema_name: 'dbo', table_name: 'A', kind: 'U ', row_count: 10 },
        { object_id: 2, schema_name: 'dbo', table_name: 'V', kind: 'V ', row_count: null },
      ],
      [
        { object_id: 1, name: 'Id', type_name: 'int', max_length: 4, is_nullable: false, is_identity: true },
        { object_id: 1, name: 'Name', type_name: 'nvarchar', max_length: 200, is_nullable: true },
        { object_id: 1, name: 'Blob', type_name: 'varbinary', max_length: -1, is_nullable: true },
        { object_id: 1, name: 'Amt', type_name: 'decimal', max_length: 9, precision: 18, scale: 2 },
        { object_id: 2, name: 'Id', type_name: 'int', max_length: 4 },
      ],
      [{ object_id: 1, column_name: 'Id' }],
      [{ parent_object_id: 2, parent_column: 'Id', ref_schema: 'dbo', ref_table: 'A', ref_column: 'Id' }],
    ]);
    const [a, v] = s.tables;
    expect(a.columns.map((c) => c.type)).toEqual(['int', 'nvarchar(100)', 'varbinary(max)', 'decimal(18,2)']);
    expect(a.columns[0]).toMatchObject({ pk: true, identity: true });
    expect(a.rowCount).toBe(10);
    expect(v).toMatchObject({ kind: 'view', rowCount: undefined });
    expect(v.columns[0].fk).toBe('dbo.A.Id');
  });
});
