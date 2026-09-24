import { parseInline, parseMarkdown } from '../src/lib/markdown';

describe('parseInline', () => {
  it('handles bold, italic and code spans', () => {
    expect(parseInline('Revenue was **$1.2M** in *March* (`SUM`).')).toEqual([
      { text: 'Revenue was ' },
      { text: '$1.2M', bold: true },
      { text: ' in ' },
      { text: 'March', italic: true },
      { text: ' (' },
      { text: 'SUM', code: true },
      { text: ').' },
    ]);
  });

  it('leaves arithmetic and snake_case alone', () => {
    expect(parseInline('quantity * price * 2')).toEqual([{ text: 'quantity * price * 2' }]);
    expect(parseInline('order_line_id')).toEqual([{ text: 'order_line_id' }]);
    expect(parseInline('a \\*literal\\* star')).toEqual([{ text: 'a *literal* star' }]);
  });
});

describe('parseMarkdown', () => {
  it('parses the shapes the server produces', () => {
    const md = [
      '## Top products',
      '',
      'The top 3 products by revenue are:',
      '',
      '| Product | Revenue |',
      '|---|---:|',
      '| Gizmo | 120,887.91 |',
      '| Pipe \\| name | 30,600 |',
      '',
      '- Gizmo leads',
      '- Ties are **not** hidden',
      '',
      '1. first',
      '2. second',
      '',
      '```sql',
      'SELECT 1',
      '```',
      '---',
    ].join('\n');
    const blocks = parseMarkdown(md);
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'table', 'list', 'list', 'code', 'rule']);
    const table = blocks[2] as Extract<(typeof blocks)[number], { type: 'table' }>;
    expect(table.align).toEqual(['left', 'right']);
    expect(table.rows[1][0]).toEqual([{ text: 'Pipe | name' }]);
    expect(blocks[4]).toMatchObject({ ordered: true, start: 1, items: [[{ text: 'first' }], [{ text: 'second' }]] });
    expect(blocks[5]).toEqual({ type: 'code', text: 'SELECT 1' });
  });

  it('joins wrapped paragraph lines and pads short table rows', () => {
    const blocks = parseMarkdown('line one\nline two\n\n| a | b |\n|--|--|\n| only |');
    expect(blocks[0]).toEqual({ type: 'paragraph', spans: [{ text: 'line one line two' }] });
    expect((blocks[1] as { rows: unknown[][] }).rows[0]).toHaveLength(2);
  });

  it('is fast enough to never matter', () => {
    const big = Array.from({ length: 400 }, (_, i) => `| row ${i} | **${i}** |`).join('\n');
    const t0 = performance.now();
    parseMarkdown(`| a | b |\n|---|---|\n${big}`);
    expect(performance.now() - t0).toBeLessThan(50);
  });
});
