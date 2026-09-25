import Feather from '@expo/vector-icons/Feather';
import { memo, useMemo, useState } from 'react';
import { type LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { scriptStyle, useI18n } from '../i18n';
import { compactNumber, type Growth, humanize, lineDomain, niceMax, percent, type VizSpec } from '../lib/chart';
import { formatCell } from '../lib/format';
import { card, type ChartPalette, type, useChartPalette, usePalette, weight } from '../theme';

/**
 * Charts follow one spec (see lib/chart.ts for the form choice):
 * thin marks, 4px rounded data-ends on a single baseline, hairline solid grid,
 * validated series colors in fixed order, selective labels, and a readout line
 * above the plot that doubles as the tap tooltip (nothing floats over marks).
 */
const AXIS = { fontSize: 12 };

function useWidth() {
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width));
  return { width, onLayout };
}

/** Horizontal bar from the baseline with a 4px rounded data end. */
function hBar(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w, h / 2);
  return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
}

/** Vertical column from the baseline with a 4px rounded top. */
function vBar(x: number, base: number, w: number, h: number): string {
  const r = Math.min(4, h, w / 2);
  const top = base - h;
  return `M${x},${base}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${base}Z`;
}

/** Start/end angles per part, with a small gap between neighbours (the surface gap). */
export function donutArcs(values: number[], total: number): { a0: number; a1: number; i: number }[] {
  const ends = values.reduce<number[]>((acc, v) => [...acc, (acc.at(-1) ?? 0) + v], []);
  return values.map((_, i) => {
    const a0 = ((i ? ends[i - 1] : 0) / total) * Math.PI * 2;
    const a1 = (ends[i] / total) * Math.PI * 2;
    return { a0, a1: Math.max(a0, a1 - (values.length > 1 ? 0.03 : 0)), i };
  });
}

function arc(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const p = (a: number) => [cx + r * Math.sin(a), cy - r * Math.cos(a)];
  const [x0, y0] = p(a0);
  const [x1, y1] = p(a1);
  return `M${x0},${y0}A${r},${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1},${y1}`;
}

/** Signed change with an arrow: status color is never the only cue. */
function Delta({ ratio, suffix }: { ratio: number; suffix?: string }) {
  const p = usePalette();
  const c = useChartPalette();
  const up = ratio >= 0;
  return (
    <View style={styles.delta} accessibilityLabel={`${percent(ratio)} ${suffix ?? ''}`}>
      <Feather name={up ? 'arrow-up-right' : 'arrow-down-right'} size={14} color={up ? c.good : c.bad} />
      <Text style={[type.meta, styles.deltaValue, { color: p.text }]}>{percent(ratio)}</Text>
      {!!suffix && <Text style={[scriptStyle(suffix, type.meta), { color: p.muted }]}>{suffix}</Text>}
    </View>
  );
}

/** The line above a plot: headline by default, the tapped item when one is selected. */
function Readout({ label, value, delta, deltaSuffix, note }: { label: string; value: string; delta?: number; deltaSuffix?: string; note?: string }) {
  const p = usePalette();
  const { rtl } = useI18n();
  return (
    <View style={[styles.readout, { flexDirection: rtl ? 'row-reverse' : 'row' }]} accessibilityLiveRegion="polite">
      <Text style={[scriptStyle(label, type.meta), { color: p.muted }]} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.readoutValue, { color: p.text }]}>{value}</Text>
      {delta !== undefined && <Delta ratio={delta} suffix={deltaSuffix} />}
      {!!note && <Text style={[scriptStyle(note, type.meta), { color: p.muted }]}>{note}</Text>}
    </View>
  );
}

function Legend({ names, c }: { names: string[]; c: ChartPalette }) {
  const p = usePalette();
  if (names.length < 2) return null;
  return (
    <View style={styles.legend}>
      {names.map((n, i) => (
        <View key={n} style={styles.legendItem}>
          <View style={[styles.swatch, { backgroundColor: c.series[i % c.series.length] }]} />
          <Text style={[type.meta, { color: p.muted }]}>{humanize(n)}</Text>
        </View>
      ))}
    </View>
  );
}

function Title({ text }: { text: string }) {
  const p = usePalette();
  return <Text style={[scriptStyle(text, { ...type.meta, ...weight.medium }), { color: p.text }]}>{text}</Text>;
}

function Kpis({ items }: { items: { label: string; value: number }[] }) {
  const p = usePalette();
  return (
    <View style={styles.kpis} testID="chart-kpis">
      {items.map((k) => (
        <View key={k.label} style={[styles.kpi, card(p)]} accessible accessibilityLabel={`${humanize(k.label)}: ${formatCell(k.value)}`}>
          <Text style={[type.meta, { color: p.muted }]} numberOfLines={1}>
            {humanize(k.label)}
          </Text>
          <Text style={[styles.kpiValue, { color: p.text }]} numberOfLines={1} adjustsFontSizeToFit>
            {Math.abs(k.value) >= 1e5 ? compactNumber(k.value) : formatCell(k.value)}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** <= 12 periods: columns; context periods in gray, the latest (or tapped) one in the accent. */
function Columns({ spec }: { spec: Extract<VizSpec, { kind: 'columns' }> }) {
  const p = usePalette();
  const c = useChartPalette();
  const { t } = useI18n();
  const { width, onLayout } = useWidth();
  const [sel, setSel] = useState<number | null>(null);
  const { labels, series, growth } = spec;
  const n = labels.length;
  const last = n - 1;
  const i = sel ?? last;
  const prev = i > 0 ? series.values[i - 1] : undefined;
  const delta = prev ? (series.values[i] - prev) / Math.abs(prev) : undefined;

  const H = 160;
  const pad = { top: 18, right: 4, bottom: 22, left: 38 };
  const plotW = Math.max(0, width - pad.left - pad.right);
  const plotH = H - pad.top - pad.bottom;
  const max = niceMax(Math.max(...series.values));
  const band = n ? plotW / n : 0;
  const barW = Math.min(24, band * 0.62);
  const y = (v: number) => pad.top + plotH - (v / max) * plotH;
  const base = pad.top + plotH;
  const everyLabel = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 44))));

  return (
    <View style={styles.box} testID="chart-columns">
      <Title text={humanize(series.name)} />
      <Readout
        label={labels[i]}
        value={formatCell(series.values[i])}
        delta={delta}
        deltaSuffix={i > 0 ? t.vsPrevious(labels[i - 1]) : undefined}
      />
      <View onLayout={onLayout} testID="chart-plot">
        {width > 0 && (
          <Svg width={width} height={H} accessibilityLabel={`${humanize(series.name)}: ${labels.map((l, k) => `${l} ${compactNumber(series.values[k])}`).join(', ')}`}>
            {[0, 0.5, 1].map((f) => (
              <G key={f}>
                <Line x1={pad.left} x2={width - pad.right} y1={y(max * f)} y2={y(max * f)} stroke={c.grid} strokeWidth={1} />
                <SvgText x={pad.left - 6} y={y(max * f) + 4} textAnchor="end" fill={p.muted} {...AXIS}>
                  {compactNumber(max * f)}
                </SvgText>
              </G>
            ))}
            {series.values.map((v, k) => {
              const x = pad.left + k * band + (band - barW) / 2;
              const h = Math.max(v > 0 ? 2 : 0, (v / max) * plotH);
              const on = k === i;
              return (
                <G key={k}>
                  <Path d={vBar(x, base, barW, h)} fill={on ? c.series[0] : c.context} />
                  {(k === i || (k === growth.peakIndex && k !== i && sel === null)) && (
                    <SvgText x={x + barW / 2} y={base - h - 5} textAnchor="middle" fill={on ? p.text : p.muted} {...AXIS}>
                      {compactNumber(v)}
                    </SvgText>
                  )}
                  {showTick(k, n, everyLabel) && (
                    <SvgText x={x + barW / 2} y={H - 6} textAnchor="middle" fill={on ? p.text : p.muted} {...AXIS}>
                      {labels[k]}
                    </SvgText>
                  )}
                  <Rect
                    x={pad.left + k * band}
                    y={pad.top - 10}
                    width={band}
                    height={plotH + 10}
                    fill="transparent"
                    onPress={() => setSel(k === sel ? null : k)}
                    accessibilityLabel={`${labels[k]} ${formatCell(v)}`}
                  />
                </G>
              );
            })}
          </Svg>
        )}
      </View>
      {growth.overall !== undefined && n > 2 && <Delta ratio={growth.overall} suffix={t.sinceFirst(labels[0])} />}
    </View>
  );
}

/** Longer or multi-measure time series: 2px lines, a 10% area wash for a single series. */
function Trend({ spec }: { spec: Extract<VizSpec, { kind: 'trend' }> }) {
  const p = usePalette();
  const c = useChartPalette();
  const { t } = useI18n();
  const { width, onLayout } = useWidth();
  const [sel, setSel] = useState<number | null>(null);
  const { labels, series, growth } = spec;
  const n = labels.length;
  const H = 170;
  const pad = { top: 14, right: 12, bottom: 22, left: 40 };
  const plotW = Math.max(0, width - pad.left - pad.right);
  const plotH = H - pad.top - pad.bottom;
  const dom = useMemo(() => lineDomain(series.flatMap((s) => s.values)), [series]);
  const x = (k: number) => pad.left + (n === 1 ? plotW / 2 : (k / (n - 1)) * plotW);
  const y = (v: number) => pad.top + plotH - ((v - dom.min) / (dom.max - dom.min || 1)) * plotH;
  const i = sel ?? n - 1;
  const single = series.length === 1;
  const everyLabel = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 56))));
  const prev = single && i > 0 ? series[0].values[i - 1] : undefined;

  return (
    <View style={styles.box} testID="chart-trend">
      <Title text={series.map((s) => humanize(s.name)).join(' · ')} />
      <Readout
        label={labels[i]}
        value={series.map((s) => compactNumber(s.values[i])).join('  ·  ')}
        delta={prev ? (series[0].values[i] - prev) / Math.abs(prev) : undefined}
        deltaSuffix={i > 0 ? t.vsPrevious(labels[i - 1]) : undefined}
      />
      <Legend names={series.map((s) => s.name)} c={c} />
      <View onLayout={onLayout} testID="chart-plot">
        {width > 0 && (
          <Svg width={width} height={H} accessibilityLabel={`${series.map((s) => humanize(s.name)).join(', ')} over ${labels[0]} to ${labels[n - 1]}`}>
            {[0, 0.5, 1].map((f) => {
              const v = dom.min + f * (dom.max - dom.min);
              return (
                <G key={f}>
                  <Line x1={pad.left} x2={width - pad.right} y1={y(v)} y2={y(v)} stroke={c.grid} strokeWidth={1} />
                  <SvgText x={pad.left - 6} y={y(v) + 4} textAnchor="end" fill={p.muted} {...AXIS}>
                    {compactNumber(v)}
                  </SvgText>
                </G>
              );
            })}
            {labels.map((l, k) =>
              showTick(k, n, everyLabel) ? (
                <SvgText key={k} x={x(k)} y={H - 6} textAnchor={k === 0 ? 'start' : k === n - 1 ? 'end' : 'middle'} fill={p.muted} {...AXIS}>
                  {l}
                </SvgText>
              ) : null,
            )}
            {sel !== null && <Line x1={x(sel)} x2={x(sel)} y1={pad.top} y2={pad.top + plotH} stroke={p.faint} strokeWidth={1} />}
            {series.map((s, si) => {
              const color = c.series[si % c.series.length];
              const pts = s.values.map((v, k) => `${x(k)},${y(v)}`);
              return (
                <G key={s.name}>
                  {single && (
                    <Path d={`M${x(0)},${y(dom.min)}L${pts.join('L')}L${x(n - 1)},${y(dom.min)}Z`} fill={color} opacity={0.1} />
                  )}
                  <Path d={`M${pts.join('L')}`} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                  <Circle cx={x(i)} cy={y(s.values[i])} r={4} fill={color} stroke={p.bg} strokeWidth={2} />
                  {single && growth && growth.peakIndex !== i && (
                    <Circle cx={x(growth.peakIndex)} cy={y(s.values[growth.peakIndex])} r={3} fill={p.bg} stroke={color} strokeWidth={2} />
                  )}
                </G>
              );
            })}
            {labels.map((_, k) => (
              <Rect
                key={k}
                x={x(k) - plotW / Math.max(1, n - 1) / 2}
                y={pad.top}
                width={plotW / Math.max(1, n - 1)}
                height={plotH}
                fill="transparent"
                onPress={() => setSel(k === sel ? null : k)}
              />
            ))}
          </Svg>
        )}
      </View>
      {single && growth?.overall !== undefined && <Delta ratio={growth.overall} suffix={t.sinceFirst(labels[0])} />}
    </View>
  );
}

/** Categories: ranked horizontal bars, value at the tip, share of total when it adds up. */
/** Every `every`-th axis label plus the last one, dropping a regular one that would crowd it. */
function showTick(k: number, n: number, every: number): boolean {
  if (k === n - 1) return true;
  return k % every === 0 && n - 1 - k >= every;
}

/** Approximate 12px label width: capitals and digits run wider than lowercase. */
function textW(s: string, size = 12): number {
  let w = 0;
  for (const ch of s) w += /[A-Z0-9]/.test(ch) ? size * 0.68 : /[\u0600-\u06FF]/.test(ch) ? size * 0.62 : size * 0.54;
  return w;
}

/** Truncates with an ellipsis so the label fits `max` px, never clipping at the edge. */
function fitText(s: string, max: number): string {
  if (textW(s) <= max) return s;
  let out = s;
  while (out.length > 3 && textW(`${out}…`) > max) out = out.slice(0, -1);
  return `${out.trimEnd()}…`;
}

function Bars({ spec }: { spec: Extract<VizSpec, { kind: 'bars' }> }) {
  const p = usePalette();
  const c = useChartPalette();
  const { t } = useI18n();
  const { width, onLayout } = useWidth();
  const [sel, setSel] = useState<number | null>(null);
  const { labels, series, total } = spec;
  const k = series.length;
  const barH = k === 1 ? 18 : 12;
  const groupH = k * barH + (k - 1) * 2;
  const rowGap = 12;
  const labelW = Math.min(Math.max(64, Math.max(...labels.map((l) => textW(l))) + 10), width * 0.38, 150);
  const valueW = total ? 78 : 52;
  const plotW = Math.max(10, width - labelW - valueW - 8);
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values)));
  const H = labels.length * (groupH + rowGap);
  const cut = (s: string) => fitText(s, labelW - 10);
  const readIdx = sel;

  return (
    <View style={styles.box} testID="chart-bars">
      <Title text={series.map((s) => humanize(s.name)).join(' · ')} />
      {readIdx !== null ? (
        <Readout
          label={labels[readIdx]}
          value={series.map((s) => formatCell(s.values[readIdx])).join('  ·  ')}
          note={total ? `${((series[0].values[readIdx] / total) * 100).toFixed(1)}% ${t.ofShown}` : undefined}
        />
      ) : total ? (
        <Readout label={t.totalOf(labels.length)} value={formatCell(total)} />
      ) : null}
      <Legend names={series.map((s) => s.name)} c={c} />
      <View onLayout={onLayout} testID="chart-plot">
        {width > 0 && (
          <Svg width={width} height={H} accessibilityLabel={labels.map((l, r) => `${l} ${series.map((s) => compactNumber(s.values[r])).join(' ')}`).join(', ')}>
            {labels.map((lab, r) => {
              const y0 = r * (groupH + rowGap);
              const dim = sel !== null && sel !== r;
              return (
                <G key={r}>
                  <SvgText x={labelW - 8} y={y0 + groupH / 2 + 4} textAnchor="end" fill={dim ? p.faint : p.text} {...AXIS} fontSize={12}>
                    {cut(lab)}
                  </SvgText>
                  {series.map((s, si) => {
                    const v = s.values[r];
                    const w = Math.max(v > 0 ? 2 : 0, (v / max) * plotW);
                    const yy = y0 + si * (barH + 2);
                    return (
                      <G key={si}>
                        <Path d={hBar(labelW, yy, w, barH)} fill={dim ? c.context : c.series[si % c.series.length]} />
                        <SvgText x={labelW + w + 6} y={yy + barH / 2 + 4} fill={dim ? p.faint : p.text} {...AXIS}>
                          {compactNumber(v)}
                          {total && si === 0 ? `  ${Math.round((v / total) * 100)}%` : ''}
                        </SvgText>
                      </G>
                    );
                  })}
                  <Rect x={0} y={y0 - rowGap / 2} width={width} height={groupH + rowGap} fill="transparent" onPress={() => setSel(r === sel ? null : r)} />
                </G>
              );
            })}
          </Svg>
        )}
      </View>
    </View>
  );
}

/** Part-to-whole for <= 6 parts; 2px surface gaps between segments. */
function Donut({ spec }: { spec: Extract<VizSpec, { kind: 'donut' }> }) {
  const p = usePalette();
  const c = useChartPalette();
  const { t } = useI18n();
  const [sel, setSel] = useState<number | null>(null);
  const { labels, series, total, other } = spec;
  const size = 148;
  const color = (i: number) => (other && i === labels.length - 1 ? p.faint : c.series[i % c.series.length]);
  const r = 62;
  const thick = 20;
  const arcs = useMemo(() => donutArcs(series.values, total), [series.values, total]);
  const shown = sel ?? null;

  return (
    <View style={styles.box} testID="chart-donut">
      <Title text={humanize(series.name)} />
      <View style={styles.donutRow}>
        <Svg width={size} height={size} accessibilityLabel={labels.map((l, i) => `${l} ${((series.values[i] / total) * 100).toFixed(0)}%`).join(', ')}>
          {arcs.map((a) => (
            <Path
              key={a.i}
              d={arc(size / 2, size / 2, r, a.a0, a.a1 === a.a0 ? a.a0 + 0.001 : a.a1 === Math.PI * 2 ? a.a1 - 0.0001 : a.a1)}
              stroke={shown === null || shown === a.i ? color(a.i) : c.context}
              strokeWidth={thick}
              fill="none"
              onPress={() => setSel(a.i === sel ? null : a.i)}
            />
          ))}
          <SvgText x={size / 2} y={size / 2 + 2} textAnchor="middle" fill={p.text} fontWeight="600" fontSize={17}>
            {shown === null ? compactNumber(total) : `${Math.round((series.values[shown] / total) * 100)}%`}
          </SvgText>
          <SvgText x={size / 2} y={size / 2 + 18} textAnchor="middle" fill={p.muted} {...AXIS}>
            {shown === null ? t.total : labels[shown].slice(0, 14)}
          </SvgText>
        </Svg>
        <View style={styles.donutLegend}>
          {labels.map((l, i) => (
            <Pressable key={l + i} onPress={() => setSel(i === sel ? null : i)} style={styles.donutItem} accessibilityRole="button" accessibilityLabel={`${l} ${formatCell(series.values[i])}`}>
              <View style={[styles.swatch, { backgroundColor: color(i) }]} />
              <Text style={[scriptStyle(l, type.meta), styles.flex, { color: sel === null || sel === i ? p.text : p.faint }]} numberOfLines={1}>
                {l}
              </Text>
              <Text style={[type.meta, { color: p.muted, fontVariant: ['tabular-nums'] }]}>{Math.round((series.values[i] / total) * 100)}%</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

export const Chart = memo(function Chart({ spec }: { spec: VizSpec }) {
  switch (spec.kind) {
    case 'kpis':
      return <Kpis items={spec.items} />;
    case 'columns':
      return <Columns spec={spec} />;
    case 'trend':
      return <Trend spec={spec} />;
    case 'bars':
      return <Bars spec={spec} />;
    case 'donut':
      return <Donut spec={spec} />;
  }
});

export type { Growth };

const styles = StyleSheet.create({
  box: { gap: 8, width: '100%' },
  flex: { flex: 1 },
  readout: { alignItems: 'baseline', gap: 8, flexWrap: 'wrap' },
  readoutValue: { ...weight.semibold, fontSize: 21, lineHeight: 28 },
  delta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  deltaValue: { ...weight.medium },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 10, height: 10, borderRadius: 2 },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  kpi: { flexGrow: 1, flexBasis: '45%', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12, gap: 4 },
  kpiValue: { ...weight.semibold, fontSize: 24, lineHeight: 31 },
  donutRow: { flexDirection: 'row', alignItems: 'center', gap: 16, flexWrap: 'wrap' },
  donutLegend: { flex: 1, minWidth: 140, gap: 6 },
  donutItem: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 3 },
});
