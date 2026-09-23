import type { QueryResult } from '../database/database.types.js';
import { compareResults, normalizeCell, resultFingerprint } from './result-compare.js';

const r = (columns: string[], rows: unknown[][]): QueryResult => ({
  columns: columns.map((name) => ({ name, type: 'x' })),
  rows,
  rowCount: rows.length,
  truncated: false,
  elapsedMs: 0,
});

describe('normalizeCell', () => {
  it('canonicalizes types', () => {
    expect(normalizeCell(true)).toBe(1);
    expect(normalizeCell(' PK ')).toBe('pk');
    expect(normalizeCell('2025-03-01T00:00:00.000Z')).toBe('2025-03-01');
    expect(normalizeCell('2025-03-01T10:00:00.000Z')).toBe('2025-03-01t10:00:00.000z');
    expect(normalizeCell('42.50')).toBe(42.5);
    expect(normalizeCell('00123456789012345678')).toBe('00123456789012345678');
  });
});

describe('compareResults', () => {
  const gold = r(
    ['Country', 'Revenue'],
    [
      ['PK', 100.5],
      ['AE', 50],
    ],
  );

  it('matches regardless of column names, column order, row order and extra columns', () => {
    const pred = r(
      ['orders', 'rev', 'code'],
      [
        [3, 50.001, 'ae'],
        [7, 100.5, 'PK'],
      ],
    );
    expect(compareResults(gold, pred)).toMatchObject({ match: true, mapping: [2, 1] });
  });

  it('enforces order only when asked', () => {
    const pred = r(
      ['c', 'v'],
      [
        ['AE', 50],
        ['PK', 100.5],
      ],
    );
    expect(compareResults(gold, pred).match).toBe(true);
    expect(compareResults(gold, pred, { ordered: true })).toMatchObject({ match: false, reason: 'order' });
  });

  it('reports row count, missing column and cross-row mismatches', () => {
    expect(compareResults(gold, r(['c', 'v'], [['PK', 100.5]]))).toMatchObject({ reason: 'row_count' });
    expect(
      compareResults(
        gold,
        r(
          ['c', 'v'],
          [
            ['PK', 1],
            ['AE', 2],
          ],
        ),
      ),
    ).toMatchObject({ reason: 'missing_column' });
    // Each column individually matches, but pairs are swapped across rows.
    expect(
      compareResults(
        gold,
        r(
          ['c', 'v'],
          [
            ['PK', 50],
            ['AE', 100.5],
          ],
        ),
      ),
    ).toMatchObject({ reason: 'values' });
  });

  it('applies numeric tolerance and treats integer division as wrong', () => {
    const avg = r(['avg'], [[2.6667]]);
    expect(compareResults(avg, r(['a'], [[2.666666]])).match).toBe(true);
    expect(compareResults(avg, r(['a'], [[2]])).match).toBe(false);
  });

  it('resolves duplicate-valued columns by backtracking', () => {
    const g = r(
      ['a', 'b'],
      [
        [1, 2],
        [2, 1],
      ],
    );
    expect(
      compareResults(
        g,
        r(
          ['x', 'y'],
          [
            [2, 1],
            [1, 2],
          ],
        ),
      ).match,
    ).toBe(true);
  });

  it('handles empty and missing results', () => {
    expect(compareResults(r(['a'], []), r(['b', 'c'], [])).match).toBe(true);
    expect(compareResults(gold, null)).toMatchObject({ reason: 'no_result' });
  });
});

describe('resultFingerprint', () => {
  it('is invariant to row order, column order and names', () => {
    const a = r(
      ['x', 'y'],
      [
        ['PK', 1],
        ['AE', 2],
      ],
    );
    const b = r(
      ['n', 'c'],
      [
        [2, 'ae'],
        [1, 'pk'],
      ],
    );
    expect(resultFingerprint(a)).toBe(resultFingerprint(b));
    expect(resultFingerprint(a)).not.toBe(
      resultFingerprint(
        r(
          ['x', 'y'],
          [
            ['PK', 2],
            ['AE', 1],
          ],
        ),
      ),
    );
  });
});
