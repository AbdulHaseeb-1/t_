import { isUrduText, row, scriptStyle } from '../src/i18n';
import type { QueryResult } from '../src/lib/api';
import { compactNumber, growthOf, humanize, inferChart, lineDomain, niceMax, percent } from '../src/lib/chart';
import { formatCost, formatMs, formatTokens } from '../src/lib/format';

const result = (columns: string[], rows: unknown[][]): QueryResult => ({
  columns: columns.map((name) => ({ name, type: 'x' })),
  rows,
  rowCount: rows.length,
  truncated: false,
  elapsedMs: 1,
});

describe('inferChart: the data picks the form', () => {
  it('ranks categories as bars with a total for share-of-total labels', () => {
    expect(inferChart(result(['Country', 'Revenue'], [['PK', 3], ['AE', 2]]))).toEqual({
      kind: 'bars',
      labels: ['PK', 'AE'],
      series: [{ name: 'Revenue', values: [3, 2] }],
      total: 5,
    });
  });

  it('draws a donut only for share questions with few positive parts', () => {
    const r = result(['Channel', 'Orders'], [['Online', 60], ['Store', 30], ['Phone', 10]]);
    expect(inferChart(r, 'What is the share of orders by channel?')?.kind).toBe('donut');
    expect(inferChart(r, 'چینل کے لحاظ سے آرڈرز کا حصہ')?.kind).toBe('donut');
    expect(inferChart(r, 'Orders by channel')?.kind).toBe('bars');
    expect(inferChart(result(['Channel', 'pct_of_orders'], [['a', 60], ['b', 40]]))?.kind).toBe('donut');
  });

  it('never mixes an amount with its percentage (or a far smaller measure) on one axis', () => {
    const shares = result(['Booking_man', 'Net_sales', 'Share_pct'], [['A', 22_137_330, 83.4], ['B', 1_354_256, 5.1], ['C', 1_031_092, 3.9]]);
    const donut = inferChart(shares, 'Share of net sales by booking man');
    expect(donut).toMatchObject({ kind: 'donut', series: { name: 'Net_sales' }, other: true });
    // The slices match the query's own percentages: the rest of the whole becomes "Other".
    if (donut?.kind !== 'donut') throw new Error('expected a donut');
    expect(donut.labels.at(-1)).toBe('Other');
    expect(Math.round((donut.series.values[0] / donut.total) * 1000) / 10).toBeCloseTo(83.4, 0);
    // Shares of the rows themselves (summing to 100) add no Other slice.
    const full = inferChart(result(['Channel', 'Orders', 'pct'], [['a', 60, 60], ['b', 40, 40]]), 'share by channel');
    expect(full).toMatchObject({ kind: 'donut', labels: ['a', 'b'], total: 100 });
    const mixed = inferChart(result(['Region', 'Revenue', 'Orders'], [['N', 2_000_000, 40], ['S', 1_500_000, 30]]), 'revenue and orders by region');
    expect(mixed?.kind === 'bars' && mixed.series.map((x) => x.name)).toEqual(['Revenue']);
    const grouped = inferChart(result(['Region', 'Revenue', 'Cost'], [['N', 2_000_000, 1_200_000], ['S', 1_500_000, 900_000]]));
    expect(grouped?.kind === 'bars' && grouped.series.map((x) => x.name)).toEqual(['Revenue', 'Cost']);
  });

  it('shows up to 12 periods as growth columns with change vs the previous period', () => {
    const spec = inferChart(result(['month_number', 'net_sales'], [[6, 100], [7, 120], [8, 150]]));
    expect(spec).toMatchObject({ kind: 'columns', labels: ['Jun', 'Jul', 'Aug'], series: { name: 'net_sales', values: [100, 120, 150] } });
    if (spec?.kind !== 'columns') throw new Error('expected columns');
    expect(spec.growth.change).toBeCloseTo(0.25);
    expect(spec.growth.overall).toBeCloseTo(0.5);
    expect(spec.growth.peakIndex).toBe(2);
  });

  it('uses Urdu month names in the Urdu interface', () => {
    const spec = inferChart(result(['Month', 'Sales'], [[1, 5], [2, 7]]), '', 'ur');
    expect(spec?.kind === 'columns' && spec.labels).toEqual(['جنوری', 'فروری']);
  });

  it('prefers a month-name column over its month number, and never plots either as a measure', () => {
    const spec = inferChart(result(['month_number', 'month_name', 'total_sales'], [[1, 'January', 5], [2, 'February', 7]]));
    expect(spec).toMatchObject({ kind: 'columns', labels: ['January', 'February'], series: { name: 'total_sales' } });
  });

  it('puts months (not the year) on the axis, with the year only when it changes', () => {
    const oneYear = inferChart(result(['sales_year', 'sales_month', 'net'], [[2026, 1, 5], [2026, 2, 7], [2026, 3, 6]]));
    expect(oneYear).toMatchObject({ kind: 'columns', labels: ['Jan', 'Feb', 'Mar'] });
    const span = inferChart(result(['yr', 'month', 'net'], [[2025, 12, 5], [2026, 1, 7]]), '', 'ur');
    expect(span).toMatchObject({ kind: 'columns', labels: ['دسمبر 25', 'جنوری 26'] });
    const urdu = inferChart(result(['سال', 'مہینہ', 'نیٹ_سیل'], [[2026, 1, 5], [2026, 2, 7]]), '', 'ur');
    expect(urdu).toMatchObject({ kind: 'columns', labels: ['جنوری', 'فروری'], series: { name: 'نیٹ_سیل' } });
    const quarters = inferChart(result(['year', 'quarter', 'revenue'], [[2025, 4, 9], [2026, 1, 11]]));
    expect(quarters).toMatchObject({ labels: ['Q4 25', 'Q1 26'] });
  });

  it('draws long or multi-measure time series as trend lines, with readable date labels', () => {
    const days = Array.from({ length: 20 }, (_, i) => [`2026-08-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`, i]);
    const trend = inferChart(result(['day', 'orders'], days));
    expect(trend?.kind).toBe('trend');
    expect(trend?.kind === 'trend' && trend.labels.slice(0, 2)).toEqual(['1 Aug', '2 Aug']);
    const multi = inferChart(result(['MonthNumber', 'NetRevenue', 'Cumulative'], [[1, 10, 10], [2, 5, 15]]));
    expect(multi).toMatchObject({ kind: 'trend', series: [{ name: 'NetRevenue' }, { name: 'Cumulative' }] });
    const monthly = inferChart(result(['month', 'v'], [['2026-01-01', 1], ['2026-02-01', 2]]));
    expect(monthly?.kind === 'columns' && monthly.labels).toEqual(['Jan 26', 'Feb 26']);
  });

  it('turns one row of a few numbers into KPI tiles, but leaves a single number to the prose', () => {
    expect(inferChart(result(['Revenue', 'Orders', 'AvgOrder'], [[1000, 20, 50]]))).toEqual({
      kind: 'kpis',
      items: [
        { label: 'Revenue', value: 1000 },
        { label: 'Orders', value: 20 },
        { label: 'AvgOrder', value: 50 },
      ],
    });
    expect(inferChart(result(['Orders'], [[500]]))).toBeNull();
  });

  it('stays a table when a chart would mislead', () => {
    expect(inferChart(result(['Country', 'Revenue'], [['PK', 1]]))).toBeNull(); // one row, one label
    expect(inferChart(result(['FirstName', 'LastName', 'Revenue'], [['a', 'b', 1], ['c', 'd', 2]]))).toBeNull(); // ambiguous labels
    expect(inferChart(result(['CustomerId', 'Orders'], [[1, 2], [2, 3]]))).toBeNull(); // no label dimension
    expect(inferChart(result(['Name'], [['a'], ['b']]))).toBeNull(); // no measure
    expect(inferChart(result(['c', 'v'], Array.from({ length: 16 }, (_, i) => [`k${i}`, i])))).toBeNull(); // too many bars
  });

  it('never plots id columns as measures', () => {
    const spec = inferChart(result(['Region', 'RegionId', 'Revenue'], [['N', 1, 5], ['S', 2, 7]]));
    expect(spec?.kind === 'bars' && spec.series.map((s) => s.name)).toEqual(['Revenue']);
  });
});

describe('growth and number formatting', () => {
  it('computes change vs previous and since first, guarding division by zero', () => {
    expect(growthOf([0, 10])).toEqual({ change: undefined, overall: undefined, peakIndex: 1 });
    expect(growthOf([0, 10]).change).toBeUndefined();
    expect(growthOf([10, 5]).change).toBeCloseTo(-0.5);
    expect(growthOf([-10, 10]).overall).toBeCloseTo(2);
  });
  it('formats signed percentages and compact numbers', () => {
    expect([0.184, -0.034, 1.5, 0].map(percent)).toEqual(['+18%', '−3.4%', '+150%', '+0%']);
    expect([950, 1234, 22137330, 1_000_000, 2.5e9].map(compactNumber)).toEqual(['950', '1.23K', '22.1M', '1M', '2.5B']);
    expect(humanize('net_amt')).toBe('Net amt');
    expect(humanize('TotalSales')).toBe('Total sales');
  });
  it('formats tokens, costs and durations for the usage views', () => {
    expect([842, 1234, 12345, 2_500_000].map(formatTokens)).toEqual(['842', '1.2K', '12K', '2.5M']);
    expect([undefined, 0, 0.00004, 0.00042, 0.0321].map(formatCost)).toEqual(['—', '$0', '< $0.0001', '$0.0004', '$0.032']);
    expect(formatMs(340)).toBe('340 ms');
    expect(formatMs(1400)).toBe('1.4 s');
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

  it('keeps three significant digits and carries into the next unit', () => {
    expect([26_534_017, 999_999, 999_400, 126_538_212, 0.456].map(compactNumber)).toEqual(['26.5M', '1M', '999K', '127M', '0.46']);
  });

  it('abbreviates large numbers', () => {
    expect([950, 1250, 45_000, 3_400_000, 2.5].map(compactNumber)).toEqual(['950', '1.25K', '45K', '3.4M', '2.5']);
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
    expect(urdu).toMatchObject({ fontFamily: 'NotoNastaliqUrdu_400Regular', fontSize: 18, lineHeight: 36, writingDirection: 'rtl', textAlign: 'right' });
    expect(scriptStyle('Hello', { fontSize: 16 })).toHaveLength(1);
    expect(scriptStyle('بولڈ', { fontSize: 16 }, 'bold')[1].fontFamily).toBe('NotoNastaliqUrdu_700Bold');
  });

  it('mirrors rows for right-to-left layouts', () => {
    expect(row(true)).toEqual({ flexDirection: 'row-reverse' });
    expect(row(false)).toEqual({ flexDirection: 'row' });
  });
});
