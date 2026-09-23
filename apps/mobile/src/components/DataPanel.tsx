import Feather from '@expo/vector-icons/Feather';
import { memo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { QueryResult } from '../lib/api';
import { formatCell, formatDuration, plural } from '../lib/format';
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
  const [open, setOpen] = useState(false);
  const rows = result.rows.slice(0, PREVIEW_ROWS);
  const numeric = result.columns.map((_, c) => rows.length > 0 && rows.every((r) => r[c] === null || typeof r[c] === 'number'));
  const summary = `${plural(result.rowCount, 'row')}${result.truncated ? '+' : ''}${totalMs ? ` · ${formatDuration(totalMs)}` : ''}`;

  return (
    <View style={[styles.box, { borderColor: p.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={open ? 'Hide query and data' : 'Show query and data'}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((o) => !o)}
        style={({ pressed }) => [styles.head, pressed && { backgroundColor: p.sunken }]}
      >
        <Feather name="database" size={14} color={p.muted} />
        <Text style={[type.meta, { color: p.text, fontFamily: fonts.sansMedium }]}>Query</Text>
        <Text style={[type.meta, { color: p.muted, flex: 1 }]} numberOfLines={1}>
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
            <Text style={[type.meta, { color: p.muted }]}>
              Showing {rows.length} of {plural(result.rowCount, 'row')}.
            </Text>
          )}
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  box: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, overflow: 'hidden' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10 },
  body: { borderTopWidth: StyleSheet.hairlineWidth, padding: 12, gap: 12 },
  sql: { borderRadius: 8, padding: 10 },
  row: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth },
  cell: { width: 120, paddingHorizontal: 8, paddingVertical: 6 },
});
