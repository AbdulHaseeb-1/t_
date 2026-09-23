import type { QueryResult } from '../database/database.types.js';
import { cannotAnswerReason, extractSql } from './prompts.js';
import { normalizeQuestion } from './query-cache.service.js';
import { numericStats, toPromptTable } from './result-format.js';

const result = (rows: unknown[][], truncated = false): QueryResult => ({
  columns: [
    { name: 'name', type: 'nvarchar' },
    { name: 'total', type: 'int' },
  ],
  rows,
  rowCount: rows.length,
  truncated,
  elapsedMs: 1,
});

describe('extractSql / cannotAnswerReason', () => {
  it('extracts fenced SQL', () => {
    expect(extractSql('Here:\n```sql\nSELECT 1\n```\nthanks')).toBe('SELECT 1');
    expect(extractSql('SELECT 2')).toBe('SELECT 2');
  });

  it('detects refusals', () => {
    expect(cannotAnswerReason('-- CANNOT_ANSWER: no weather data')).toBe('no weather data');
    expect(cannotAnswerReason('-- top customers\nSELECT 1')).toBeUndefined();
  });
});

describe('toPromptTable', () => {
  it('encodes TSV and flattens cells', () => {
    expect(
      toPromptTable(
        result([
          ['a\tb', 1],
          [null, 2],
        ]),
        10,
      ),
    ).toBe('name\ttotal\na b\t1\nNULL\t2');
  });

  it('samples large results and adds stats over all rows', () => {
    const rows = Array.from({ length: 100 }, (_, i) => [`n${i}`, i + 1]);
    const out = toPromptTable(result(rows, true), 3);
    expect(out.split('\n')).toHaveLength(5);
    expect(out).toContain('showing first 3 of 100');
    expect(out).toContain('row cap');
    expect(out).toContain('total{min=1 max=100 sum=5050 avg=50.5}');
  });

  it('only computes stats for numeric columns', () => {
    expect(numericStats(result([['x', 1]])).map((s) => s.column)).toEqual(['total']);
  });
});

describe('normalizeQuestion', () => {
  it('ignores case, spacing and trailing punctuation', () => {
    expect(normalizeQuestion('  How MANY   orders?? ')).toBe(normalizeQuestion('how many orders'));
  });
});
