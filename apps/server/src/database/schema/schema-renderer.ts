import type { TableInfo } from './schema.types.js';

function compactCount(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}

/**
 * One line per table, e.g.
 *   dbo.Orders ~12.3k rows | OrderId int PK, CustomerId int ->dbo.Customers.Id, Total decimal(18,2)
 * Roughly 3-5x fewer tokens than CREATE TABLE DDL with the same information
 * an LLM needs to write correct joins.
 */
export function renderTable(t: TableInfo): string {
  const head = [
    t.id,
    t.kind === 'view' ? '(view)' : '',
    t.rowCount !== undefined ? `~${compactCount(t.rowCount)} rows` : '',
    t.description ? `-- ${t.description}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const cols = t.columns
    .map((c) => {
      let s = `${c.name} ${c.type}`;
      if (c.pk) s += ' PK';
      if (c.fk) s += ` ->${c.fk}`;
      if (c.description) s += ` "${c.description}"`;
      return s;
    })
    .join(', ');
  return `${head} | ${cols}`;
}

export function renderTables(tables: TableInfo[]): string {
  return tables.map(renderTable).join('\n');
}

/** Names-only index so the model knows what else exists without paying for columns. */
export function renderIndex(tables: TableInfo[], maxChars: number): string {
  let out = '';
  for (const t of tables) {
    const next = out ? `, ${t.id}` : t.id;
    if (out.length + next.length > maxChars) return `${out}, ... (+more)`;
    out += next;
  }
  return out;
}
