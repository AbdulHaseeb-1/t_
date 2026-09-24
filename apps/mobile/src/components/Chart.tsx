import { memo, useMemo, useState } from 'react';
import { type LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G, Line, Polyline, Rect, Text as SvgText } from 'react-native-svg';
import { type ChartSpec, compactNumber, lineDomain, niceMax } from '../lib/chart';
import { fonts, type, usePalette } from '../theme';

const BAR_H = 18;
const BAR_GAP = 10;
const LABEL_W = 96;
const LINE_H = 170;
const PAD = { top: 12, right: 12, bottom: 26, left: 40 };

/** Series colors after the first (which uses the ink color). */
const SERIES = ['#C0673E', '#4F7CAC', '#6E9F6A'];

function Legend({ spec }: { spec: ChartSpec }) {
  const p = usePalette();
  if (spec.series.length < 2) return null;
  return (
    <View style={styles.legend}>
      {spec.series.map((s, i) => (
        <View key={s.name} style={styles.legendItem}>
          <View style={[styles.swatch, { backgroundColor: i === 0 ? p.primary : SERIES[(i - 1) % SERIES.length] }]} />
          <Text style={[type.meta, { color: p.muted }]}>{s.name}</Text>
        </View>
      ))}
    </View>
  );
}

/** Horizontal bars (categories) or a line (time), drawn to one scale that starts at zero. */
export const Chart = memo(function Chart({ spec }: { spec: ChartSpec }) {
  const p = usePalette();
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width));
  const color = (i: number) => (i === 0 ? p.primary : SERIES[(i - 1) % SERIES.length]);
  const max = useMemo(() => niceMax(Math.max(0, ...spec.series.flatMap((s) => s.values))), [spec]);

  let body = null;
  if (width > 0 && spec.kind === 'bar') {
    const n = spec.series.length;
    const groupH = n * BAR_H + (n - 1) * 3;
    const plotW = width - LABEL_W - 56;
    const height = spec.labels.length * (groupH + BAR_GAP);
    body = (
      <Svg width={width} height={height} accessibilityLabel="Bar chart">
        {spec.labels.map((lab, row) => {
          const y0 = row * (groupH + BAR_GAP);
          return spec.series.map((s, si) => {
            const v = s.values[row];
            const w = Math.max(1, (v / max) * plotW);
            const y = y0 + si * (BAR_H + 3);
            return (
              <G key={`${row}-${si}`}>
                {si === 0 && (
                  <SvgText x={LABEL_W - 8} y={y0 + groupH / 2 + 4} fontSize={12} fill={p.muted} textAnchor="end" fontFamily={fonts.sans}>
                    {lab.length > 14 ? `${lab.slice(0, 13)}…` : lab}
                  </SvgText>
                )}
                <Rect x={LABEL_W} y={y} width={w} height={BAR_H} rx={3} fill={color(si)} />
                <SvgText x={LABEL_W + w + 6} y={y + BAR_H / 2 + 4} fontSize={11.5} fill={p.text} fontFamily={fonts.sans}>
                  {compactNumber(v)}
                </SvgText>
              </G>
            );
          });
        })}
      </Svg>
    );
  } else if (width > 0) {
    const plotW = width - PAD.left - PAD.right;
    const plotH = LINE_H - PAD.top - PAD.bottom;
    const n = spec.labels.length;
    const x = (i: number) => PAD.left + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
    const dom = lineDomain(spec.series.flatMap((s) => s.values));
    const y = (v: number) => PAD.top + plotH - ((v - dom.min) / (dom.max - dom.min)) * plotH;
    const ticks = [0, 0.5, 1].map((f) => dom.min + f * (dom.max - dom.min));
    const every = Math.max(1, Math.ceil(n / 6));
    body = (
      <Svg width={width} height={LINE_H} accessibilityLabel="Line chart">
        {ticks.map((tv) => (
          <G key={tv}>
            <Line x1={PAD.left} x2={width - PAD.right} y1={y(tv)} y2={y(tv)} stroke={p.border} strokeWidth={1} />
            <SvgText x={PAD.left - 6} y={y(tv) + 4} fontSize={11} fill={p.muted} textAnchor="end" fontFamily={fonts.sans}>
              {compactNumber(tv)}
            </SvgText>
          </G>
        ))}
        {spec.labels.map((lab, i) =>
          i % every === 0 || i === n - 1 ? (
            <SvgText key={lab + i} x={x(i)} y={LINE_H - 8} fontSize={11} fill={p.muted} textAnchor="middle" fontFamily={fonts.sans}>
              {lab}
            </SvgText>
          ) : null,
        )}
        {spec.series.map((s, si) => (
          <G key={s.name}>
            <Polyline points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} fill="none" stroke={color(si)} strokeWidth={2} />
            <Circle cx={x(n - 1)} cy={y(s.values[n - 1])} r={3.5} fill={color(si)} />
          </G>
        ))}
      </Svg>
    );
  }

  return (
    <View style={styles.box} onLayout={onLayout} testID="chart">
      <Legend spec={spec} />
      {body}
    </View>
  );
});

const styles = StyleSheet.create({
  box: { gap: 8, width: '100%' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 10, height: 10, borderRadius: 2 },
});
