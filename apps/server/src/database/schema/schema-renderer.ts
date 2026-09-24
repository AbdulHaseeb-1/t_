import type { TableInfo } from './schema.types.js';

const MAX_RENDERED_VALUES = 12;

function compactCount(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}

/**
 * One line per table, e.g.
 *   dbo.Orders ~12.3k rows | OrderId int PK, CustomerId int ->dbo.Customers.Id, Status varchar(12) {Open|Closed}
 *   dbo.Town ~193 rows | area_id int, town_id int, name varchar(30), PK(area_id, town_id)
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
  const pk = t.columns.filter((c) => c.pk);
  // A composite key marked per column reads as several unique ids; spell it out once instead.
  const composite = pk.length > 1;
  const cols = t.columns
    .map((c) => {
      let s = `${c.name} ${c.type}`;
      if (c.pk && !composite) s += ' PK';
      if (c.fk) s += ` ->${c.fk}`;
      if (c.description) s += ` "${c.description}"`;
      if (c.values?.length) {
        const shown = c.values.slice(0, MAX_RENDERED_VALUES).join('|');
        s += ` {${shown}${c.values.length > MAX_RENDERED_VALUES ? '|...' : ''}}`;
      }
      return s;
    })
    .join(', ');
  return composite ? `${head} | ${cols}, PK(${pk.map((c) => c.name).join(', ')})` : `${head} | ${cols}`;
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
