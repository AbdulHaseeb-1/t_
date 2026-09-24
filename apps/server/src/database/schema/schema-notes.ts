import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join as joinPath } from 'node:path';
import type { TableInfo } from './schema.types.js';

/**
 * Curated schema notes: what a DBA knows that the catalog can't show, such as
 * a view's grain or which amount is the real sales figure. Keys are
 * `schema.table` or `schema.table.column` (case-insensitive); values are short
 * sentences. Notes are appended to any MS_Description from the database and
 * are indexed for retrieval, so they help pick tables as well as write SQL.
 *
 *   { "dbo.InvoiceLine": "Invoice header, one row per invoice. Sales totals: SUM(net_amt).",
 *     "dbo.uvSaleInvoice": "One row per invoice LINE; net_amt repeats per line, never SUM it here." }
 */
export type SchemaNotes = Map<string, string>;

/** Relative paths resolve like `.env`: from the server directory, else from the repo root. */
function resolveNotesPath(file: string): string {
  if (isAbsolute(file) || existsSync(file)) return file;
  const fromRoot = joinPath('..', '..', file);
  return existsSync(fromRoot) ? fromRoot : file;
}

export function loadSchemaNotes(file: string): SchemaNotes {
  if (!file) return new Map();
  const raw = JSON.parse(readFileSync(resolveNotesPath(file), 'utf8')) as Record<string, unknown>;
  const notes: SchemaNotes = new Map();
  for (const [key, value] of Object.entries(raw)) {
    if (key.startsWith('$') || typeof value !== 'string' || !value.trim()) continue;
    notes.set(key.toLowerCase(), value.trim());
  }
  return notes;
}

const join = (a: string | undefined, b: string | undefined) => (a && b ? `${a} ${b}` : a || b);

export function applySchemaNotes(tables: TableInfo[], notes: SchemaNotes): TableInfo[] {
  if (!notes.size) return tables;
  return tables.map((t) => {
    const id = t.id.toLowerCase();
    const tableNote = notes.get(id);
    let changed = !!tableNote;
    const columns = t.columns.map((c) => {
      const note = notes.get(`${id}.${c.name.toLowerCase()}`);
      if (!note) return c;
      changed = true;
      return { ...c, description: join(c.description, note) };
    });
    return changed ? { ...t, description: join(t.description, tableNote), columns } : t;
  });
}
