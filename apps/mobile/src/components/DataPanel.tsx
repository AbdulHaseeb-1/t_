import Feather from '@expo/vector-icons/Feather';
import { memo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { QueryResult } from '../lib/api';
import { row, scriptStyle, useI18n } from '../i18n';
import { formatCell, formatDuration } from '../lib/format';
import { fonts, type, usePalette } from '../theme';

const PREVIEW_ROWS = 50;

interface Props {
  sql: string;
  result: QueryResult;
  totalMs?: number;
}

/** "SQL · 12 rows" disclosure: the evidence behind an answer, one tap away. */
export const DataPanel = memo(function DataPanel({ sql, result, totalMs }: Props) {
  const p = usePalette();
  const { t, rtl, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const rows = result.rows.slice(0, PREVIEW_ROWS);
  const numeric = result.columns.map((_, c) => rows.length > 0 && rows.every((r) => r[c] === null || typeof r[c] === 'number'));
  const count = result.rowCount === 1 ? t.row : t.rows(formatCell(result.rowCount));
  const summary = `${count}${result.truncated ? '+' : ''}${totalMs ? ` · ${formatDuration(totalMs, lang)}` : ''}`;

  return (
    <View style={[styles.box, { borderColor: p.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={open ? t.hideQuery : t.showQuery}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((o) => !o)}
        style={({ pressed }) => [styles.head, row(rtl), pressed && { backgroundColor: p.sunken }]}
      >
        <Feather name="database" size={14} color={p.muted} />
        <Text style={[scriptStyle(t.query, { ...type.meta, fontFamily: fonts.sansMedium }), { color: p.text }]}>{t.query}</Text>
        <Text style={[scriptStyle(summary, type.meta), { color: p.muted, flex: 1 }]} numberOfLines={1}>
          {summary}
        </Text>
        <Feather name={open ? 'chevron-up' : 'chevron-down'} size={16} color={p.muted} />
      </Pressable>

      {open && (
        <View style={[styles.body, { borderColor: p.border }]}>
          <ScrollView horizontal style={[styles.sql, { backgroundColor: p.sunken }]}>
            <Text style={[type.code, { color: p.text }]} selectable>
              {sql}
            </Text>
          </ScrollView>
          {result.columns.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View>
                <View style={[styles.row, { borderColor: p.border }]}>
                  {result.columns.map((c, i) => (
                    <Text key={i} style={[styles.cell, type.meta, { color: p.muted, fontFamily: fonts.sansMedium, textAlign: numeric[i] ? 'right' : 'left' }]} numberOfLines={1}>
                      {c.name}
                    </Text>
                  ))}
                </View>
                {rows.map((r, i) => (
                  <View key={i} style={[styles.row, { borderColor: p.border }]}>
                    {r.map((v, j) => (
                      <Text key={j} style={[styles.cell, type.meta, { color: p.text, textAlign: numeric[j] ? 'right' : 'left', fontVariant: ['tabular-nums'] }]} numberOfLines={1} selectable>
                        {formatCell(v)}
                      </Text>
                    ))}
                  </View>
                ))}
              </View>
            </ScrollView>
          )}
          {result.rowCount > rows.length && (
            <Text style={[scriptStyle(t.showingRows(rows.length, ''), type.meta), { color: p.muted }]}>
              {t.showingRows(rows.length, formatCell(result.rowCount))}
            </Text>
          )}
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  box: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, overflow: 'hidden' },
  head: { alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10 },
  body: { borderTopWidth: StyleSheet.hairlineWidth, padding: 12, gap: 12 },
  sql: { borderRadius: 8, padding: 10 },
  row: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth },
  cell: { width: 120, paddingHorizontal: 8, paddingVertical: 6 },
});
