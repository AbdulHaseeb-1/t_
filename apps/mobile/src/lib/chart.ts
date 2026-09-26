import type { ChartKind, QueryResult } from './api';

/**
 * Chooses how a result is shown. The data's job picks the form:
 *   one row: a value + its previous period  -> stat tile with the change
 *   one row of 2-4 numbers        -> KPI tiles (a single number stays in the prose)
 *   <= 12 periods, one measure    -> growth columns: latest period highlighted + change vs previous
 *   longer / multi-measure time   -> trend line (area for a single series)
 *   categories, "share of" intent -> donut (<= 6 positive parts)
 *   categories                    -> ranked bars (grouped when 2-3 measures)
 *   long rows (x, a second dimension, one measure) -> one series per value of the second
 *     dimension, top 5 + "Other": stacked columns over periods, stacked bars across
 *     categories, lines to compare trends, grouped bars for 2-3 series
 * Anything that would mislead (ids, ambiguous labels, too many points) stays a table.
 * The assistant's preferred form (line, column, bar, donut, stacked) wins whenever the data fits it.
 */
export interface Series {
  name: string;
  values: number[];
  /** Display name when the series is a data value ("North"), not a column name to humanize. */
  label?: string;
}

export interface Growth {
  /** Latest vs previous period, as a ratio (0.18 = +18%); undefined when previous is 0. */
  change?: number;
  /** Last vs first period. */
  overall?: number;
  peakIndex: number;
}

/** `other`: the last series is the folded tail ("Other"), drawn in the context gray. `title` names a pivoted chart. */
export type VizSpec =
  | { kind: 'kpis'; items: { label: string; value: number }[] }
  | {
      kind: 'stat';
      label: string;
      value: number;
      previous: number;
      /** The comparison period in words: "last month", "previous". */
      previousLabel: string;
      /** (value - previous) / |previous|; undefined when previous is 0. */
      change?: number;
      /** Whether a rise is good news (false for returns, costs, overdue amounts). */
      upIsGood: boolean;
    }
  | { kind: 'columns'; labels: string[]; series: Series; growth: Growth }
  | { kind: 'trend'; labels: string[]; series: Series[]; growth?: Growth; other?: boolean; title?: string }
  | { kind: 'bars'; labels: string[]; series: Series[]; total?: number; other?: boolean; title?: string }
  | { kind: 'stacked'; orientation: 'columns' | 'bars'; labels: string[]; series: Series[]; other?: boolean; title: string }
  | { kind: 'donut'; labels: string[]; series: Series; total: number; other?: boolean };

/** @deprecated kept for older call sites: same as VizSpec. */
export type ChartSpec = VizSpec;

const TIME_NAME = /(^|_|\b)(year|month|quarter|week|day|date|period|hour|yr|mon|mahina|saal)(s|_?name|_?number|_?num|_?no)?($|_|\b)/i;
const MONTH_NAME = /month|mon\b|mahina|مہین|ماہ/i;
/** Urdu column names (\b does not apply to Arabic script). */
const TIME_NAME_UR = /سال|مہین|ماہ|تاریخ|دن|ہفت|سہ ?ماہی/;
const ID_NAME = /(^id$|_id$|Id$|ID$|^code$|_code$|_no$|^no$)/;
const SHARE_WORDS =
  /\b(share|shares|distribution|breakdown|proportion|percentage|percent|split|mix|composition|hissa|tanasub|fisad)\b|حصہ|تناسب|فیصد|تقسیم/i;
const SHARE_COLUMN = /pct|percent|share|ratio|portion/i;

/** A comparison column: previous_net_sales, last_month, ly_sales, pichla_mahina. */
const PREVIOUS = /(^|_|\b)(prev|previous|prior|last|ly|pichl[aey]|guzishta|sabiq)(_|\b|$)|پچھل|گزشتہ|سابق/i;
/** Measures where a rise is bad news. */
const UP_IS_BAD = /return|refund|cancel|cost|expense|overdue|outstanding|receivable|debt|loss|discount|shortage|complaint|churn|late|expir/i;
const PERIOD_WORD = /^(day|week|month|quarter|year|mahina|saal)s?$/i;
/** Named series in a two-way breakdown before the rest is folded into "Other" (6 validated colors in all). */
const MAX_SERIES = 5;
/** Grouped bars stay readable with up to three bars per category. */
const MAX_GROUPED = 3;
const MAX_POINTS = 40;
const MAX_BARS = 15;
const MAX_DONUT = 6;
const COLUMNS_MAX = 12;
/** When columns were asked for: a month of days still reads, with thinned labels. */
const COLUMNS_PREFERRED_MAX = 31;

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_UR = ['جنوری', 'فروری', 'مارچ', 'اپریل', 'مئی', 'جون', 'جولائی', 'اگست', 'ستمبر', 'اکتوبر', 'نومبر', 'دسمبر'];

const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

function numericColumn(rows: unknown[][], c: number): boolean {
  return rows.some((r) => isNum(r[c])) && rows.every((r) => r[c] === null || isNum(r[c]));
}

function isDateLike(rows: unknown[][], c: number): boolean {
  return rows.every((r) => typeof r[c] === 'string' && /^\d{4}-\d{2}(-\d{2})?/.test(r[c] as string));
}

/**
 * Human time labels for a whole axis: month numbers -> month names; ISO dates
 * -> "Aug 26" when every value is a month start, else "3 Aug".
 */
export function timeLabels(values: unknown[], colName: string, lang: 'en' | 'ur' = 'en'): string[] {
  const months = lang === 'ur' ? MONTHS_UR : MONTHS_EN;
  const monthNumbers = MONTH_NAME.test(colName) && !/quarter|qtr|سہ ?ماہی/i.test(colName) && values.every((v) => v === null || (Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 12));
  const quarterNumbers = /quarter|qtr|سہ ?ماہی/i.test(colName) && values.every((v) => v === null || (Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 4));
  const iso = values.map((v) => /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(String(v ?? '')));
  const allIso = iso.every(Boolean);
  const monthly = allIso && iso.every((m) => !m![3] || m![3] === '01');
  return values.map((v, i) => {
    if (v === null || v === undefined) return '—';
    if (monthNumbers) return months[(v as number) - 1];
    if (quarterNumbers) return `Q${v}`;
    if (allIso) {
      const m = iso[i]!;
      const mon = months[Number(m[2]) - 1];
      return monthly ? `${mon} ${m[1].slice(2)}` : `${Number(m[3])} ${mon}`;
    }
    return String(v);
  });
}

const GRAIN = { year: 1, quarter: 2, month: 3, week: 4, day: 5 } as const;

/** How fine a time column is, from its name (or ISO date values, which are days or months). */
function grainOf(name: string, dateLike: boolean): number {
  if (dateLike || /day|date|din|tareekh|تاریخ|دن/i.test(name)) return GRAIN.day;
  if (/week|hafta|ہفت/i.test(name)) return GRAIN.week;
  if (/quarter|qtr|سہ ?ماہی/i.test(name)) return GRAIN.quarter;
  if (MONTH_NAME.test(name) || /period/i.test(name)) return GRAIN.month;
  if (/year|yr|saal|سال/i.test(name)) return GRAIN.year;
  return GRAIN.day;
}

function plainLabel(v: unknown): string {
  if (v === null || v === undefined) return '—';
  return String(v).trim();
}

export function growthOf(values: number[]): Growth {
  const n = values.length;
  const last = values[n - 1];
  const prev = values[n - 2];
  const first = values[0];
  let peakIndex = 0;
  values.forEach((v, i) => {
    if (v > values[peakIndex]) peakIndex = i;
  });
  return {
    change: n >= 2 && prev !== 0 ? (last - prev) / Math.abs(prev) : undefined,
    overall: n >= 2 && first !== 0 ? (last - first) / Math.abs(first) : undefined,
    peakIndex,
  };
}

export function inferChart(r: QueryResult | null | undefined, question = '', lang: 'en' | 'ur' = 'en', prefer?: ChartKind): VizSpec | null {
  if (!r || r.rows.length === 0 || r.columns.length === 0) return null;
  const cols = r.columns.map((col, i) => ({
    name: col.name,
    i,
    numeric: numericColumn(r.rows, i),
    time: TIME_NAME.test(col.name) || TIME_NAME_UR.test(col.name) || isDateLike(r.rows, i),
    id: ID_NAME.test(col.name),
  }));

  // One row of several numbers: headline figures, not a chart.
  if (r.rows.length === 1) {
    const nums = cols.filter((c) => c.numeric && !c.id && !c.time);
    // In one row, "this_month" and "last_month" are values, not a time axis.
    const pair = cols.filter((c) => c.numeric && !c.id);
    const stat = pair.length === 2 && pair.length === cols.length ? statOf(pair[0].name, pair[1].name, r.rows[0][pair[0].i] as number, r.rows[0][pair[1].i] as number) : null;
    if (stat) return stat;
    if (nums.length >= 2 && nums.length <= 4 && nums.length === cols.length) {
      return { kind: 'kpis', items: nums.map((c) => ({ label: c.name, value: r.rows[0][c.i] as number })) };
    }
    return null;
  }
  const pivot = pivotLong(r, cols, lang, prefer);
  if (pivot !== undefined) return pivot;
  if (r.rows.length > MAX_POINTS || r.columns.length < 2) return null;

  // The x axis: the finest time column (year + month -> month), a name before its
  // number at the same grain; else the single text column.
  const text = cols.filter((c) => !c.numeric);
  const times = cols.filter((c) => c.time).map((c) => ({ c, g: grainOf(c.name, isDateLike(r.rows, c.i)) }));
  const finest = times.length ? Math.max(...times.map((t) => t.g)) : 0;
  const time = times.filter((t) => t.g === finest).sort((a, b) => Number(a.c.numeric) - Number(b.c.numeric))[0]?.c;
  const x = time ?? (text.length === 1 ? text[0] : undefined);
  if (!x) return null;
  // A second time column (month number + month name) is the same axis, not a measure or label.
  const measures = cols.filter((c) => c !== x && c.numeric && !c.id && !c.time).slice(0, 3);
  const otherText = text.filter((c) => c !== x && !c.time);
  if (measures.length === 0 || otherText.length > 0) return null;

  const all: Series[] = measures.map((m) => ({ name: m.name, values: r.rows.map((row) => (row[m.i] as number | null) ?? 0) }));
  const series = comparable(all);

  if (x === time) {
    let labels = timeLabels(r.rows.map((row) => row[x.i]), x.name, lang);
    // Months or quarters that span several years carry the year: "Dec 25", "Jan 26".
    const year = times.find((t) => t.g === GRAIN.year && t.c !== x)?.c;
    if (year && finest > GRAIN.year && new Set(r.rows.map((row) => row[year.i])).size > 1) {
      labels = labels.map((l, k) => `${l} ${String(r.rows[k][year.i] ?? '').slice(-2)}`);
    }
    const fitsColumns = series.length === 1 && series[0].values.every((v) => v >= 0) && labels.length <= (prefer === 'column' || prefer === 'bar' ? COLUMNS_PREFERRED_MAX : COLUMNS_MAX);
    if (fitsColumns && prefer !== 'line') {
      return { kind: 'columns', labels, series: series[0], growth: growthOf(series[0].values) };
    }
    return { kind: 'trend', labels, series, growth: series.length === 1 ? growthOf(series[0].values) : undefined };
  }

  const labels = r.rows.map((row) => plainLabel(row[x.i]));
  if (labels.length > MAX_BARS) return null;
  const positive = series.every((s) => s.values.every((v) => v >= 0));
  const total = series.length === 1 && positive ? series[0].values.reduce((a, b) => a + b, 0) : undefined;
  const wantsShare =
    prefer === 'donut' || (prefer !== 'bar' && (SHARE_WORDS.test(question) || all.some((m) => SHARE_COLUMN.test(m.name))));
  if (series.length === 1 && positive && total && labels.length >= 2 && labels.length <= MAX_DONUT && wantsShare) {
    // A share column from the query is relative to the whole table, not to these
    // rows (top 5 of many): rebuild the whole and show the rest as "Other", so the
    // slices match the percentages in the answer.
    const pct = all.find((m) => SHARE_COLUMN.test(m.name));
    const whole = pct ? wholeFromShares(series[0].values, pct.values) : undefined;
    if (whole && whole - total > whole * 0.005) {
      return {
        kind: 'donut',
        labels: [...labels, lang === 'ur' ? 'دیگر' : 'Other'],
        series: { ...series[0], values: [...series[0].values, whole - total] },
        total: whole,
        other: true,
      };
    }
    return { kind: 'donut', labels, series: series[0], total };
  }
  return { kind: 'bars', labels, series, total };
}

function words(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s_]+/)
    .map((w) => w.toLowerCase())
    .filter(Boolean);
}

/** The comparison period in words: previous_net_sales vs net_sales -> "previous"; last_month vs this_month -> "last month". */
export function comparisonLabel(previous: string, current: string): string {
  const cur = new Set(words(current));
  const kept = words(previous).filter((w) => !cur.has(w) || PERIOD_WORD.test(w));
  const text = (kept.length ? kept : words(previous)).join(' ').replace(/\bly\b/, 'last year').replace(/\bprev\b/, 'previous');
  return text;
}

/** One row holding a value and the same measure for a comparison period: a stat tile with the change. */
function statOf(nameA: string, nameB: string, a: number, b: number): VizSpec | null {
  const bPrev = PREVIOUS.test(nameB);
  const aPrev = PREVIOUS.test(nameA);
  if (bPrev === aPrev) return null;
  const [curName, prevName, value, previous] = bPrev ? [nameA, nameB, a, b] : [nameB, nameA, b, a];
  return {
    kind: 'stat',
    label: humanize(curName),
    value,
    previous,
    previousLabel: comparisonLabel(prevName, curName),
    change: previous !== 0 ? (value - previous) / Math.abs(previous) : undefined,
    upIsGood: !UP_IS_BAD.test(curName),
  };
}

type Col = { name: string; i: number; numeric: boolean; time: boolean; id: boolean };

/**
 * Long rows (x, a second dimension, one measure) turned into one series per
 * value of the second dimension. The largest values keep their own series and
 * color; the rest are summed into "Other". Returns undefined when the result is
 * not in that shape, null when it is but is too large to draw (a table then).
 */
function pivotLong(r: QueryResult, cols: Col[], lang: 'en' | 'ur', prefer?: ChartKind): VizSpec | null | undefined {
  const measures = cols.filter((c) => c.numeric && !c.id && !c.time);
  if (measures.length !== 1) return undefined;
  const measure = measures[0];
  const times = cols.filter((c) => c.time).map((c) => ({ c, g: grainOf(c.name, isDateLike(r.rows, c.i)) }));
  const finest = times.length ? Math.max(...times.map((t) => t.g)) : 0;
  const time = times.filter((t) => t.g === finest).sort((a, b) => Number(a.c.numeric) - Number(b.c.numeric))[0]?.c;
  const text = cols.filter((c) => !c.numeric && !c.time && !c.id);
  let x: Col | undefined;
  let dim: Col | undefined;
  if (time && text.length === 1) [x, dim] = [time, text[0]];
  else if (!time && text.length === 2) [x, dim] = [text[0], text[1]];
  if (!x || !dim) return undefined;

  // Periods in time order; categories in the order the query returned them (its ranking).
  const xKeys: unknown[] = [];
  const seen = new Set<string>();
  for (const row of r.rows) {
    const k = String(row[x.i]);
    if (!seen.has(k)) {
      seen.add(k);
      xKeys.push(row[x.i]);
    }
  }
  if (x === time) xKeys.sort((a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b))));
  const xIndex = new Map(xKeys.map((k, i) => [String(k), i]));
  if (xKeys.length < 2 || xKeys.length > (x === time ? MAX_POINTS : MAX_BARS)) return null;

  // One second-dimension value per x (customer + their city) is an attribute, not a breakdown: a table.
  const perX = new Map<string, Set<string>>();
  for (const row of r.rows) perX.set(String(row[x.i]), (perX.get(String(row[x.i])) ?? new Set()).add(plainLabel(row[dim.i])));
  if ([...perX.values()].every((d) => d.size === 1)) return undefined;

  const byDim = new Map<string, number[]>();
  for (const row of r.rows) {
    const d = plainLabel(row[dim.i]);
    const values = byDim.get(d) ?? new Array<number>(xKeys.length).fill(0);
    values[xIndex.get(String(row[x.i]))!] += (row[measure.i] as number | null) ?? 0;
    byDim.set(d, values);
  }
  const sum = (v: number[]) => v.reduce((a, b) => a + b, 0);
  const ranked = [...byDim.entries()].sort((a, b) => sum(b[1]) - sum(a[1]));
  if (ranked.length < 2) return undefined;

  const labels = x === time ? timeLabels(xKeys, x.name, lang) : xKeys.map(plainLabel);
  const positive = ranked.every(([, v]) => v.every((n) => n >= 0));
  const grouped = x !== time && prefer !== 'stacked' && ranked.length <= MAX_GROUPED;
  const keep = grouped ? MAX_GROUPED : MAX_SERIES;
  const head = ranked.length > keep + 1 ? ranked.slice(0, keep) : ranked;
  const tail = ranked.slice(head.length);
  const series: Series[] = head.map(([name, values]) => ({ name, label: name, values }));
  if (tail.length) {
    const other = new Array<number>(xKeys.length).fill(0);
    for (const [, v] of tail) v.forEach((n, i) => (other[i] += n));
    series.push({ name: 'other', label: lang === 'ur' ? 'دیگر' : 'Other', values: other });
  }
  const other = tail.length > 0;
  const title = `${humanize(measure.name)} · ${humanize(dim.name).toLowerCase()}`;

  if (x === time) {
    const stack = positive && prefer !== 'line' && (prefer === 'stacked' || xKeys.length <= COLUMNS_MAX) && xKeys.length <= COLUMNS_PREFERRED_MAX;
    return stack ? { kind: 'stacked', orientation: 'columns', labels, series, other, title } : { kind: 'trend', labels, series, other, title };
  }
  if (grouped) return { kind: 'bars', labels, series, other, title };
  return positive ? { kind: 'stacked', orientation: 'bars', labels, series, other, title } : null;
}

/**
 * Measures that can share one axis. A percentage column next to the amount it
 * was derived from is redundant (the chart computes shares itself), and a
 * measure far smaller than the first would flatten to nothing on a shared
 * scale: both are dropped rather than drawn on a second axis.
 */
export function comparable(series: Series[]): Series[] {
  if (series.length < 2) return series;
  const amounts = series.filter((s) => !SHARE_COLUMN.test(s.name));
  const kept = amounts.length > 0 ? amounts : series.slice(0, 1);
  const peak = (s: Series) => Math.max(...s.values.map(Math.abs));
  const lead = peak(kept[0]);
  return kept.filter((s, i) => i === 0 || (lead > 0 && peak(s) >= lead / 10 && peak(s) <= lead * 10));
}

/** The total the share column was computed against (median of amount / share); percentages or ratios. */
export function wholeFromShares(amounts: number[], shares: number[]): number | undefined {
  const sum = shares.reduce((a, b) => a + b, 0);
  if (!(sum > 0)) return undefined;
  const scale = sum <= 1.0001 ? 1 : 100;
  if (sum / scale > 1.01) return undefined; // not shares of one whole
  const est = amounts.map((a, i) => (shares[i] > 0 ? (a * scale) / shares[i] : NaN)).filter(Number.isFinite).sort((a, b) => a - b);
  return est.length ? est[Math.floor(est.length / 2)] : undefined;
}

/**
 * The column a table can draw in-cell bars for: the first non-negative measure
 * (not an id, not a time), in a table of at least three rows. null when none.
 */
export function magnitudeColumn(r: QueryResult): number | null {
  if (r.rows.length < 3) return null;
  const c = r.columns.findIndex(
    (col, i) =>
      numericColumn(r.rows, i) &&
      !ID_NAME.test(col.name) &&
      !TIME_NAME.test(col.name) &&
      !TIME_NAME_UR.test(col.name) &&
      r.rows.every((row) => row[i] === null || (row[i] as number) >= 0),
  );
  if (c < 0) return null;
  return Math.max(...r.rows.map((row) => (row[c] as number | null) ?? 0)) > 0 ? c : null;
}

/** Rows ranked by that measure, highest first, with a label to rank: worth rank numbers. */
export function isRanking(r: QueryResult, c: number): boolean {
  const hasLabel = r.columns.some((_, i) => !numericColumn(r.rows, i));
  const v = r.rows.map((row) => (row[c] as number | null) ?? 0);
  return hasLabel && v.every((x, i) => i === 0 || x <= v[i - 1]) && v[0] > v[v.length - 1];
}

/** Round axis maximum: 1, 2, 2.5 or 5 x 10^n, so gridlines land on readable values. */
export function niceMax(v: number): number {
  if (v <= 0) return 1;
  const exp = Math.floor(Math.log10(v));
  const base = 10 ** exp;
  for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * base) return m * base;
  return 10 * base;
}

/** Three significant digits with a unit: 26,534,017 -> 26.5M, 1,354,256 -> 1.35M, 842 -> 842. */
export function compactNumber(n: number): string {
  const a = Math.abs(n);
  // Number(x.toFixed(d)) drops trailing zeros: 3.40 -> 3.4, 1.00 -> 1.
  const fmt = (v: number) => {
    const m = Math.abs(v);
    return String(Number(v.toFixed(m >= 100 ? 0 : m >= 10 ? 1 : 2)));
  };
  // Rounding can carry into the next unit (999,950 -> 1000K): step up instead.
  if (a >= 999.5e6) return `${fmt(n / 1e9)}B`;
  if (a >= 999.5e3) return `${fmt(n / 1e6)}M`;
  if (a >= 999.5) return `${fmt(n / 1e3)}K`;
  return fmt(n);
}

/** Signed percentage for deltas: +18%, -3.4%, +0.5%. */
export function percent(ratio: number): string {
  const p = ratio * 100;
  const a = Math.abs(p);
  const s = a >= 100 ? a.toFixed(0) : a >= 10 ? a.toFixed(0) : a.toFixed(1);
  return `${p >= 0 ? '+' : '−'}${s.replace(/\.0$/, '')}%`;
}

/**
 * Axis range for trend lines: fitted to the data (a line's slope is the
 * message), padded to readable steps. Bars always start at zero instead.
 */
export function lineDomain(values: number[]): { min: number; max: number } {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  if (lo >= 0 && lo < hi * 0.5) return { min: 0, max: niceMax(hi) };
  const span = hi - lo || Math.abs(hi) || 1;
  const step = niceMax(span / 4) / 2;
  return { min: Math.floor(lo / step) * step, max: Math.ceil(hi / step) * step || step };
}

/** Column/axis name for display: Net_Sales -> Net sales. */
export function humanize(name: string): string {
  const s = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_]+/g, ' ')
    .trim()
    .toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
