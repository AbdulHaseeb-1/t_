import { memo, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { QueryResult, ShownResult } from '../lib/api';
import { inferChart } from '../lib/chart';
import { formatCell } from '../lib/format';
import { scriptStyle, useI18n } from '../i18n';
import { card, type, usePalette } from '../theme';
import { Chart } from './Chart';
import { DataPanel } from './DataPanel';

/** A list request needs visible rows even if an older model chose a chart. */
export function asksForTable(question: string): boolean {
  return /\b(list|enlist|enlsit|table|tabular|rows|records)\b|فہرست|لسٹ|ٹیبل|جدول/i.test(question);
}

function NumberCard({ title, result }: { title: string; result: QueryResult }) {
  const p = usePalette();
  const value = result.rows[0]?.[0];
  if (typeof value !== 'number' || !Number.isFinite(value) || result.columns.length !== 1) return null;
  return (
    <View style={[styles.number, card(p)]} accessible accessibilityLabel={`${title}: ${formatCell(value)}`}>
      <Text style={[scriptStyle(title, type.meta), { color: p.muted }]}>{title}</Text>
      <Text style={[type.display, { color: p.text, fontVariant: ['tabular-nums'] }]} selectable>{formatCell(value)}</Text>
    </View>
  );
}

/** Render the tool's requested presentation and keep its underlying rows available. */
export const ResultWidget = memo(function ResultWidget({ item, question, showSql }: { item: ShownResult; question: string; showSql: boolean }) {
  const { lang } = useI18n();
  const table = item.display.view === 'table' || asksForTable(question);
  const spec = useMemo(
    () => (table ? null : inferChart(item.result, question, lang, item.display.chart)),
    [table, item.result, question, lang, item.display.chart],
  );
  const showChart = !table && spec && (item.display.view === 'chart' || (item.display.view === 'number' && spec.kind === 'kpis'));
  const number = !table && item.display.view === 'number' && !showChart && item.result.columns.length === 1 && item.result.rows.length === 1 && typeof item.result.rows[0]?.[0] === 'number';
  const hasVisual = !!showChart || number;
  return (
    <View style={styles.group}>
      {!!showChart && <Chart spec={spec} />}
      {number && <NumberCard title={item.title} result={item.result} />}
      <DataPanel
        key={item.id}
        sql={showSql ? item.sql : undefined}
        title={item.title}
        result={item.result}
        defaultOpen={table || !hasVisual}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  group: { gap: 12 },
  number: { borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14, gap: 4 },
});
