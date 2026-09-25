import type { QueryResult } from '../database/database.types.js';

/**
 * Chat answers are markdown; WhatsApp has its own light syntax (*bold*,
 * _italic_, ```mono```) and no tables. Tables become a monospace block.
 */
export function toWhatsApp(markdown: string): string {
  return markdown
    .split('\n')
    .filter((l) => !/^\s*\|.*\|\s*$/.test(l)) // markdown tables: the data block replaces them
    .map((l) =>
      l
        .replace(/^\s{0,3}#{1,6}\s+(.*)$/, '*$1*')
        .replace(/^\s*[-*]\s+/, '• ')
        .replace(/\*\*(.+?)\*\*/g, '*$1*')
        .replace(/__(.+?)__/g, '_$1_')
        .replace(/`([^`]+)`/g, '$1'),
    )
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const num = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

function cell(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return num.format(v);
  const s = String(v);
  const d = /^(\d{4}-\d{2}-\d{2})T00:00:00(\.0+)?Z$/.exec(s);
  return d ? d[1] : s;
}

/** First rows as an aligned monospace table (at most 4 columns, cells cut at 22 characters). */
export function tableBlock(r: QueryResult, maxRows = 10): string {
  if (!r.rows.length) return '';
  const cols = r.columns.slice(0, 4);
  const rows = r.rows.slice(0, maxRows).map((row) => cols.map((_, i) => cell(row[i])));
  const numeric = cols.map((_, i) => r.rows.every((row) => row[i] === null || typeof row[i] === 'number'));
  const cut = (s: string) => (s.length > 22 ? `${s.slice(0, 21)}…` : s);
  const head = cols.map((c) => cut(c.name.replace(/_/g, ' ')));
  const body = rows.map((row) => row.map(cut));
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((row) => row[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => (numeric[i] ? c.padStart(widths[i]) : c.padEnd(widths[i]))).join('  ').trimEnd();
  const more = r.rowCount > rows.length ? `\n… ${num.format(r.rowCount - rows.length)} more rows` : '';
  return `\`\`\`\n${[line(head), ...body.map(line)].join('\n')}${more}\n\`\`\``;
}

/** A complete WhatsApp message for an answer or report, within the 4096-character limit. */
export function answerMessage(opts: { title?: string; subtitle?: string; answer?: string | null; result?: QueryResult | null; note?: string }): string {
  const parts: string[] = [];
  if (opts.title) parts.push(`*${opts.title}*${opts.subtitle ? `\n_${opts.subtitle}_` : ''}`);
  if (opts.note) parts.push(opts.note);
  if (opts.answer) parts.push(toWhatsApp(opts.answer));
  // A single number is already in the sentence; a table adds nothing there.
  const r = opts.result;
  if (r && r.rowCount > 0 && !(r.rowCount === 1 && r.columns.length <= 2 && opts.answer)) parts.push(tableBlock(r));
  if (r && r.rowCount === 0 && !opts.answer) parts.push('No rows.');
  let text = parts.filter(Boolean).join('\n\n');
  if (text.length > 4000) text = `${text.slice(0, 3990)}…`;
  return text;
}
