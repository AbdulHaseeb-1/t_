import type { TableInfo } from './schema.types.js';

const STOPWORDS = new Set(
  (
    'a an the of in on at to for from by with and or not is are was were be been what which who whom whose ' +
    'how many much show list give get find me all each per every top most least than more less between ' +
    'do does did have has had there their them this that these those it its as into over under about ' +
    'total count number sum average avg max min please can could would should any some tbl viw'
  ).split(' '),
);

/** Splits identifiers and prose into comparable stems: `OrderLineItems` -> order, line, item. */
export function tokenize(input: string): string[] {
  return input
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w) && !/^\d+$/.test(w))
    .map(stem);
}

function stem(w: string): string {
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && /(ses|xes|ches|shes)$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

interface IndexedTable {
  table: TableInfo;
  nameTokens: Set<string>;
  columnTokens: Set<string>;
  descTokens: Set<string>;
}

/**
 * Lexical table ranking: zero LLM calls, zero embedding cost, microseconds per
 * query. Picks the tables most likely needed, then adds the tables they
 * reference so join paths stay intact.
 */
export class SchemaRetriever {
  private readonly index: IndexedTable[];
  private readonly byId: Map<string, TableInfo>;

  constructor(tables: TableInfo[]) {
    this.byId = new Map(tables.map((t) => [t.id.toLowerCase(), t]));
    this.index = tables.map((table) => ({
      table,
      nameTokens: new Set(tokenize(table.name)),
      columnTokens: new Set(table.columns.flatMap((c) => tokenize(c.name))),
      descTokens: new Set(
        tokenize([table.description ?? '', ...table.columns.map((c) => c.description ?? '')].join(' ')),
      ),
    }));
  }

  rank(question: string, limit: number): TableInfo[] {
    const q = [...new Set(tokenize(question))];
    if (q.length === 0) return [];

    const scored = this.index
      .map((t) => {
        let score = 0;
        for (const w of q) {
          if (t.nameTokens.has(w)) score += 4;
          else if (
            w.length >= 4 &&
            [...t.nameTokens].some((n) => n.startsWith(w) || (n.length >= 4 && w.startsWith(n)))
          )
            score += 2;
          if (t.columnTokens.has(w)) score += 1;
          if (t.descTokens.has(w)) score += 1;
        }
        if (score > 0 && t.table.rowCount) score += Math.log10(t.table.rowCount + 1) * 0.05;
        // Every word of the table's name is in the question ("companies" -> Company):
        // the strongest signal there is, so wide tables with many column hits can't crowd it out.
        const named = t.nameTokens.size > 0 && [...t.nameTokens].every((n) => q.includes(n));
        return { t: t.table, score, named };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score);

    const picked = new Map<string, TableInfo>();
    for (const { t } of scored.filter((s) => s.named).slice(0, limit)) picked.set(t.id, t);
    for (const { t } of scored) {
      if (picked.size >= limit) break;
      picked.set(t.id, t);
    }

    // Pull in FK targets of the strongest matches so joins are writable.
    for (const { t } of scored.slice(0, 3)) {
      for (const c of t.columns) {
        if (picked.size >= limit + 3) break;
        if (!c.fk) continue;
        const target = this.byId.get(c.fk.split('.').slice(0, 2).join('.').toLowerCase());
        if (target) picked.set(target.id, target);
      }
    }
    return [...picked.values()];
  }
}
