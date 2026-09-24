import { isUrduText, row, scriptStyle } from '../src/i18n';
import type { QueryResult } from '../src/lib/api';
import { compactNumber, inferChart, lineDomain, niceMax } from '../src/lib/chart';

const result = (columns: string[], rows: unknown[][]): QueryResult => ({
  columns: columns.map((name) => ({ name, type: 'x' })),
  rows,
  rowCount: rows.length,
  truncated: false,
  elapsedMs: 1,
});

describe('inferChart', () => {
  it('draws categories as bars', () => {
    expect(inferChart(result(['Country', 'Revenue'], [['PK', 3], ['AE', 2]]))).toEqual({
      kind: 'bar',
      labels: ['PK', 'AE'],
      series: [{ name: 'Revenue', values: [3, 2] }],
    });
  });

  it('draws time as lines, including numeric month columns and dates', () => {
    expect(inferChart(result(['MonthNumber', 'NetRevenue', 'Cumulative'], [[1, 10, 10], [2, 5, 15]]))).toMatchObject({
      kind: 'line',
      labels: ['1', '2'],
      series: [{ name: 'NetRevenue' }, { name: 'Cumulative' }],
    });
    expect(inferChart(result(['day', 'orders'], [['2025-01-01T00:00:00.000Z', 4], ['2025-01-02T00:00:00.000Z', 6]]))?.labels).toEqual([
      '2025-01-01',
      '2025-01-02',
    ]);
  });

  it('stays a table when a chart would mislead', () => {
    expect(inferChart(result(['Orders'], [[500]]))).toBeNull(); // single value
    expect(inferChart(result(['Country', 'Revenue'], [['PK', 1]]))).toBeNull(); // one row
    expect(inferChart(result(['FirstName', 'LastName', 'Revenue'], [['a', 'b', 1], ['c', 'd', 2]]))).toBeNull(); // ambiguous labels
    expect(inferChart(result(['CustomerId', 'Orders'], [[1, 2], [2, 3]]))).toBeNull(); // no label dimension
    expect(inferChart(result(['Name'], [['a'], ['b']]))).toBeNull(); // no measure
    expect(inferChart(result(['c', 'v'], Array.from({ length: 41 }, (_, i) => [`k${i}`, i])))).toBeNull(); // too many points
  });

  it('never plots id columns as measures', () => {
    expect(inferChart(result(['Region', 'RegionId', 'Revenue'], [['N', 1, 5], ['S', 2, 7]]))?.series.map((s) => s.name)).toEqual(['Revenue']);
  });
});

describe('chart scale helpers', () => {
  it('rounds axis maxima to readable values', () => {
    expect([0, 7, 12, 230, 4100, 0.3].map(niceMax)).toEqual([1, 10, 20, 250, 5000, 0.5]);
  });
  it('fits trend lines to the data but keeps a zero baseline when the data spans it', () => {
    const d = lineDomain([289_351, 315_871, 301_500]);
    expect(d.min).toBeGreaterThan(250_000);
    expect(d.min).toBeLessThanOrEqual(289_351);
    expect(d.max).toBeGreaterThanOrEqual(315_871);
    expect(lineDomain([2, 90, 40])).toEqual({ min: 0, max: 100 });
    expect(lineDomain([-5, 5]).min).toBeLessThanOrEqual(-5);
  });

  it('abbreviates large numbers', () => {
    expect([950, 1250, 45_000, 3_400_000, 2.5].map(compactNumber)).toEqual(['950', '1.3k', '45k', '3.4M', '2.5']);
  });
});

describe('Urdu typography', () => {
  it('detects Urdu script, including mixed text', () => {
    expect(isUrduText('پاکستان میں کتنے گاہک ہیں؟')).toBe(true);
    expect(isUrduText('Web چینل سے کتنے آرڈر آئے؟')).toBe(true);
    expect(isUrduText('How many orders?')).toBe(false);
    expect(isUrduText('12345')).toBe(false);
  });

  it('sets Nastaliq with room for its diagonal stacking', () => {
    const [base, urdu] = scriptStyle('آپ کیا جاننا چاہتے ہیں؟', { fontFamily: 'X', fontSize: 16, lineHeight: 23 });
    expect(base.fontFamily).toBe('X');
    expect(urdu).toMatchObject({ fontFamily: 'NotoNastaliqUrdu_400Regular', fontSize: 17, lineHeight: 36, writingDirection: 'rtl', textAlign: 'right' });
    expect(scriptStyle('Hello', { fontSize: 16 })).toHaveLength(1);
    expect(scriptStyle('بولڈ', { fontSize: 16 }, 'bold')[1].fontFamily).toBe('NotoNastaliqUrdu_700Bold');
  });

  it('mirrors rows for right-to-left layouts', () => {
    expect(row(true)).toEqual({ flexDirection: 'row-reverse' });
    expect(row(false)).toEqual({ flexDirection: 'row' });
  });
});
