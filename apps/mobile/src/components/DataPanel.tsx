import Feather from '@expo/vector-icons/Feather';
import { memo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import type { QueryResult } from '../lib/api';
import { row, scriptStyle, useI18n } from '../i18n';
import { formatCell } from '../lib/format';
import { humanize } from '../lib/chart';
import { card, layout, type, usePalette, weight } from '../theme';

const PAGE_ROWS = 25;

interface Props {
  /** Omitted when SQL is hidden in Settings: the panel then shows only the data. */
  sql?: string;
  result: QueryResult;
  /** Heading instead of "Data"/"Query" (the result's title from the assistant). */
  title?: string;
  /** Open from the start: the assistant chose to answer with this table. */
  defaultOpen?: boolean;
}

/**
 * "Data · 12 rows" disclosure: the evidence behind an answer (and the chart's
 * table view), one tap away. The query itself shows only when enabled in Settings.
 */
export const DataPanel = memo(function DataPanel({ sql, result, title: heading, defaultOpen = false }: Props) {
  const p = usePalette();
  const { t, rtl } = useI18n();
  const { width } = useWindowDimensions();
  const [open, setOpen] = useState(defaultOpen);
  const [page, setPage] = useState(0);
  const available = result.rows.length;
  const pageCount = Math.max(1, Math.ceil(available / PAGE_ROWS));
  const currentPage = Math.min(page, pageCount - 1);
  const start = currentPage * PAGE_ROWS;
  const rows = result.rows.slice(start, start + PAGE_ROWS);
  const numeric = result.columns.map((_, c) => result.rows.length > 0 && result.rows.every((r) => r[c] === null || typeof r[c] === 'number'));
  const columnWidth = (i: number) => ({ width: numeric[i] ? 128 : i === 0 ? 200 : 168 });
  const needsHorizontalScroll = result.columns.reduce((sum, _, i) => sum + columnWidth(i).width, 0) > Math.min(width, layout.pageWidth) - 64;
  const count = result.rowCount === 1 ? t.row : t.rows(formatCell(result.rowCount));
  const summary = `${count}${result.truncated ? '+' : ''}`;
  const title = heading || (sql ? t.query : t.data);

  return (
    <View style={[styles.shell, card(p)]}>
      <View style={styles.box}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={sql ? (open ? t.hideQuery : t.showQuery) : open ? t.hideData : t.showData}
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen((o) => !o)}
          style={({ pressed }) => [styles.head, row(rtl), pressed && { backgroundColor: p.sunken }]}
        >
          <Feather name={sql ? 'code' : 'table'} size={14} color={p.muted} />
          <Text style={[scriptStyle(title, { ...type.meta, ...weight.medium }), { color: p.text, flexShrink: 1 }]} numberOfLines={1}>
            {title}
          </Text>
          <Text style={[scriptStyle(summary, type.meta), { color: p.muted, flexGrow: 1, flexShrink: 0 }]} numberOfLines={1}>
            {summary}
          </Text>
          <Feather name={open ? 'chevron-up' : 'chevron-down'} size={16} color={p.muted} />
        </Pressable>

        {open && (
          <View style={[styles.body, { borderColor: p.border }]}>
            {!!sql && (
              <ScrollView horizontal style={[styles.sql, { backgroundColor: p.sunken }]}>
                <Text style={[type.code, { color: p.text }]} selectable>
                  {sql}
                </Text>
              </ScrollView>
            )}
            {pageCount > 1 && (
              <View style={[styles.pager, row(rtl)]}>
                <Pressable accessibilityRole="button" accessibilityLabel={t.previousPage} accessibilityState={{ disabled: currentPage === 0 }} disabled={currentPage === 0} onPress={() => setPage(currentPage - 1)} style={[styles.pageButton, { borderColor: p.border }]}>
                  <Feather name={rtl ? 'chevron-right' : 'chevron-left'} size={16} color={currentPage === 0 ? p.faint : p.text} />
                  <Text style={[scriptStyle(t.previousPage, type.meta), { color: currentPage === 0 ? p.faint : p.text }]}>{t.previousPage}</Text>
                </Pressable>
                <Text style={[scriptStyle(t.tablePage(start + 1, start + rows.length, formatCell(result.rowCount), result.truncated), type.caption), styles.pageStatus, { color: p.muted }]}>
                  {t.tablePage(start + 1, start + rows.length, formatCell(result.rowCount), result.truncated)}
                </Text>
                <Pressable accessibilityRole="button" accessibilityLabel={t.nextPage} accessibilityState={{ disabled: currentPage >= pageCount - 1 }} disabled={currentPage >= pageCount - 1} onPress={() => setPage(currentPage + 1)} style={[styles.pageButton, { borderColor: p.border }]}>
                  <Text style={[scriptStyle(t.nextPage, type.meta), { color: currentPage >= pageCount - 1 ? p.faint : p.text }]}>{t.nextPage}</Text>
                  <Feather name={rtl ? 'chevron-left' : 'chevron-right'} size={16} color={currentPage >= pageCount - 1 ? p.faint : p.text} />
                </Pressable>
              </View>
            )}
            {result.columns.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View>
                  <View style={[styles.row, styles.headerRow, { borderColor: p.border, backgroundColor: p.sunken }]}>
                    {result.columns.map((c, i) => (
                      <Text key={i} style={[styles.cell, columnWidth(i), type.meta, { color: p.text, ...weight.medium, textAlign: numeric[i] ? 'right' : 'left' }]} numberOfLines={2}>
                        {humanize(c.name)}
                      </Text>
                    ))}
                  </View>
                  {rows.map((r, i) => (
                    <View key={i} style={[styles.row, { borderColor: p.border, backgroundColor: i % 2 ? p.sunken : p.surface }]}>
                      {result.columns.map((_, j) => (
                        <Text key={j} style={[styles.cell, columnWidth(j), type.meta, { color: p.text, textAlign: numeric[j] ? 'right' : 'left', fontVariant: ['tabular-nums'] }]} numberOfLines={2} selectable>
                          {formatCell(r[j])}
                        </Text>
                      ))}
                    </View>
                  ))}
                </View>
              </ScrollView>
            )}
            {needsHorizontalScroll && (
              <View style={[styles.scrollHint, row(rtl)]}>
                <Feather name={rtl ? 'arrow-left' : 'arrow-right'} size={13} color={p.muted} />
                <Text style={[scriptStyle(rtl ? 'مزید کالم دیکھنے کے لیے ٹیبل سرکائیں' : 'Scroll to see more columns', type.caption), { color: p.muted }]}>
                  {rtl ? 'مزید کالم دیکھنے کے لیے ٹیبل سرکائیں' : 'Scroll to see more columns'}
                </Text>
              </View>
            )}
            {result.rowCount > available && <Text style={[scriptStyle(t.savedRows(available, formatCell(result.rowCount)), type.caption), { color: p.muted }]}>{t.savedRows(available, formatCell(result.rowCount))}</Text>}
            {result.truncated && <Text style={[scriptStyle(t.cappedRows(formatCell(result.rowCount)), type.caption), { color: p.muted }]}>{t.cappedRows(formatCell(result.rowCount))}</Text>}
          </View>
        )}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  shell: { borderRadius: 14 },
  box: { borderRadius: 14, overflow: 'hidden' },
  head: { alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10 },
  body: { borderTopWidth: StyleSheet.hairlineWidth, padding: 8, gap: 12 },
  sql: { borderRadius: 8, padding: 10 },
  row: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  headerRow: { minHeight: 38 },
  cell: { paddingHorizontal: 10, paddingVertical: 9 },
  scrollHint: { alignItems: 'center', gap: 5, paddingHorizontal: 6 },
  pager: { alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  pageButton: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, minHeight: 36, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 2 },
  pageStatus: { textAlign: 'center', flexShrink: 1 },
});
