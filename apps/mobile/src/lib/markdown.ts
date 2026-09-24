/**
 * Parser for the Markdown subset the server's answers use: headings,
 * paragraphs, bold/italic/code spans, lists, pipe tables, fenced code and
 * rules. Output is plain data so rendering stays cheap and memoizable.
 */

export interface Span {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
}

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3; spans: Span[] }
  | { type: 'paragraph'; spans: Span[] }
  | { type: 'list'; ordered: boolean; start: number; items: Span[][] }
  | { type: 'code'; text: string }
  | { type: 'table'; header: Span[][]; align: ('left' | 'right' | 'center')[]; rows: Span[][][] }
  | { type: 'rule' };

export function parseInline(src: string): Span[] {
  const out: Span[] = [];
  let buf = '';
  let bold = false;
  let italic = false;
  const flush = () => {
    if (buf) out.push({ text: buf, ...(bold && { bold }), ...(italic && { italic }) });
    buf = '';
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '\\' && i + 1 < src.length && /[\\`*_|]/.test(src[i + 1])) {
      buf += src[++i];
    } else if (c === '`') {
      const end = src.indexOf('`', i + 1);
      if (end === -1) {
        buf += c;
        continue;
      }
      flush();
      out.push({ text: src.slice(i + 1, end), code: true });
      i = end;
    } else if ((c === '*' || c === '_') && src[i + 1] === c) {
      flush();
      bold = !bold;
      i++;
    } else if ((c === '*' || c === '_') && isItalicMarker(src, i, italic)) {
      flush();
      italic = !italic;
    } else {
      buf += c;
    }
  }
  flush();
  return merge(out);
}

/** `*` opens italics only before a non-space and closes only after one; `_` never inside words. */
function isItalicMarker(src: string, i: number, open: boolean): boolean {
  const prev = src[i - 1] ?? ' ';
  const next = src[i + 1] ?? ' ';
  if (src[i] === '_' && /\w/.test(prev) && /\w/.test(next)) return false;
  return open ? !/\s/.test(prev) : !/\s/.test(next) && src.indexOf(src[i], i + 1) !== -1;
}

function merge(spans: Span[]): Span[] {
  const out: Span[] = [];
  for (const s of spans) {
    const last = out[out.length - 1];
    if (last && !!last.bold === !!s.bold && !!last.italic === !!s.italic && !last.code && !s.code) last.text += s.text;
    else out.push({ ...s });
  }
  return out;
}

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (s[i] === '|') {
      cells.push(cur.trim());
      cur = '';
    } else cur += s[i];
  }
  cells.push(cur.trim());
  return cells;
}

const DELIMITER = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const LIST_ITEM = /^\s*([-*+]|(\d+)[.)])\s+(.*)$/;

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) blocks.push({ type: 'paragraph', spans: parseInline(para.join(' ')) });
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      flushPara();
      continue;
    }
    if (trimmed.startsWith('```')) {
      flushPara();
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith('```'); i++) code.push(lines[i]);
      blocks.push({ type: 'code', text: code.join('\n') });
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushPara();
      const level = Math.min(3, heading[1].length) as 1 | 2 | 3;
      blocks.push({ type: 'heading', level, spans: parseInline(heading[2].replace(/\s#+$/, '')) });
      continue;
    }
    if (/^([-*_])(\s*\1){2,}$/.test(trimmed)) {
      flushPara();
      blocks.push({ type: 'rule' });
      continue;
    }
    if (trimmed.includes('|') && i + 1 < lines.length && DELIMITER.test(lines[i + 1])) {
      flushPara();
      const header = splitRow(line);
      const align = splitRow(lines[i + 1]).map((d) =>
        d.startsWith(':') && d.endsWith(':') ? 'center' : d.endsWith(':') ? 'right' : 'left',
      ) as ('left' | 'right' | 'center')[];
      const rows: Span[][][] = [];
      for (i += 2; i < lines.length && lines[i].includes('|') && lines[i].trim(); i++) {
        const cells = splitRow(lines[i]);
        rows.push(header.map((_, c) => parseInline(cells[c] ?? '')));
      }
      i--;
      blocks.push({ type: 'table', header: header.map(parseInline), align, rows });
      continue;
    }
    const item = LIST_ITEM.exec(line);
    if (item) {
      flushPara();
      const ordered = !!item[2];
      const items: Span[][] = [];
      const start = ordered ? Number(item[2]) : 1;
      for (; i < lines.length; i++) {
        const m = LIST_ITEM.exec(lines[i]);
        if (m && !!m[2] === ordered) items.push(parseInline(m[3]));
        else if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length) {
          items[items.length - 1] = parseInline(`${spansToText(items[items.length - 1])} ${lines[i].trim()}`);
        } else break;
      }
      i--;
      blocks.push({ type: 'list', ordered, start, items });
      continue;
    }
    para.push(trimmed);
  }
  flushPara();
  return blocks;
}

export function spansToText(spans: Span[]): string {
  return spans.map((s) => s.text).join('');
}
