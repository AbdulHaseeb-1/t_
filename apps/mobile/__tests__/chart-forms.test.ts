import type { QueryResult } from '../src/lib/api';
import { comparisonLabel, inferChart } from '../src/lib/chart';

const result = (columns: string[], rows: unknown[][]): QueryResult => ({
  columns: columns.map((name) => ({ name, type: 'x' })),
  rows,
  rowCount: rows.length,
  truncated: false,
  elapsedMs: 1,
});

describe('stat tiles: a value and its comparison period', () => {
  it('shows the change against the previous period', () => {
    expect(inferChart(result(['net_sales', 'previous_net_sales'], [[24_800_000, 26_300_000]]))).toMatchObject({
      kind: 'stat',
      label: 'Net sales',
      value: 24_800_000,
      previous: 26_300_000,
      previousLabel: 'previous',
      upIsGood: true,
    });
    const stat = inferChart(result(['this_month', 'last_month'], [[120, 100]]));
    expect(stat).toMatchObject({ kind: 'stat', label: 'This month', previousLabel: 'last month' });
    expect(stat?.kind === 'stat' && stat.change).toBeCloseTo(0.2);
  });

  it('knows when a rise is bad news, and leaves plain figures as KPI tiles', () => {
    expect(inferChart(result(['returns', 'previous_returns'], [[5, 3]]))).toMatchObject({ kind: 'stat', upIsGood: false });
    expect(inferChart(result(['net_sales', 'units'], [[10, 2]]))?.kind).toBe('kpis');
    expect(inferChart(result(['sales', 'previous_sales'], [[10, 0]]))).toMatchObject({ kind: 'stat', change: undefined });
  });

  it('names the comparison period in words', () => {
    expect(comparisonLabel('ly_sales', 'ty_sales')).toBe('last year');
    expect(comparisonLabel('pichla_mahina', 'is_mahina')).toBe('pichla mahina');
  });
});

describe('two-way breakdowns', () => {
  const regions = ['North', 'South', 'East', 'West', 'Central', 'Coast', 'Hills'];
  const monthly = result(
    ['month', 'region', 'net_sales'],
    ['2026-01-01', '2026-02-01', '2026-03-01'].flatMap((m, k) => regions.map((r, i) => [m, r, (i + 1) * 100 + k])),
  );

  it('stacks periods by the second dimension, keeping the top five and folding the rest into Other', () => {
    const spec = inferChart(monthly);
    expect(spec).toMatchObject({ kind: 'stacked', orientation: 'columns', labels: ['Jan 26', 'Feb 26', 'Mar 26'], other: true, title: 'Net sales · region' });
    if (spec?.kind !== 'stacked') throw new Error('expected stacked');
    expect(spec.series.map((s) => s.label)).toEqual(['Hills', 'Coast', 'Central', 'West', 'East', 'Other']);
    // Other = North + South in each month.
    expect(spec.series.at(-1)!.values).toEqual([100 + 200, 101 + 201, 102 + 202]);
  });

  it('draws lines instead when the trends are to be compared', () => {
    expect(inferChart(monthly, '', 'en', 'line')).toMatchObject({ kind: 'trend', other: true });
  });

  it('groups two or three series per category, and stacks more as horizontal bars', () => {
    const two = result(['salesman', 'company', 'net_sales'], [['Ali', 'GSK', 5], ['Ali', 'Getz', 3], ['Sara', 'GSK', 4], ['Sara', 'Getz', 6]]);
    expect(inferChart(two)).toMatchObject({ kind: 'bars', labels: ['Ali', 'Sara'], other: false });
    const many = result(
      ['salesman', 'company', 'net_sales'],
      ['Ali', 'Sara'].flatMap((m) => ['A', 'B', 'C', 'D'].map((c, i) => [m, c, i + 1])),
    );
    expect(inferChart(many)).toMatchObject({ kind: 'stacked', orientation: 'bars' });
    expect(inferChart(two, '', 'en', 'stacked')).toMatchObject({ kind: 'stacked', orientation: 'bars' });
  });

  it('keeps a ranked list with a descriptive column (one city per customer) as a table', () => {
    const list = result(['customer', 'city', 'net_sales'], [['Ali Traders', 'Lahore', 9], ['Bilal & Co', 'Karachi', 7], ['City Pharma', 'Lahore', 5]]);
    expect(inferChart(list)).toBeNull();
  });
});
