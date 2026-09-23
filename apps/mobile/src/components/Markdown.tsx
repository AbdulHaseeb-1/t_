import { memo, useMemo } from 'react';
import { ScrollView, StyleSheet, Text, type TextStyle, View } from 'react-native';
import { type Block, parseMarkdown, type Span, spansToText } from '../lib/markdown';
import { fonts, type Palette, type, usePalette } from '../theme';

function Spans({ spans, base, p }: { spans: Span[]; base: TextStyle; p: Palette }) {
  return (
    <>
      {spans.map((s, i) => {
        if (s.code) {
          return (
            <Text key={i} style={[type.code, { color: p.text, backgroundColor: p.sunken }]}>
              {` ${s.text} `}
            </Text>
          );
        }
        const style: TextStyle[] = [];
        if (s.bold) style.push({ fontFamily: base.fontFamily === fonts.serif ? fonts.serifSemibold : fonts.sansSemibold });
        if (s.italic) style.push({ fontFamily: fonts.serifItalic });
        return (
          <Text key={i} style={style}>
            {s.text}
          </Text>
        );
      })}
    </>
  );
}

const CHAR_WIDTH = 7.4;
const CELL_PADDING = 20;

/** One width per column, from its longest cell, so header and body always line up. */
function columnWidths(block: Extract<Block, { type: 'table' }>): number[] {
  return block.header.map((h, c) => {
    const longest = Math.max(spansToText(h).length, ...block.rows.map((r) => spansToText(r[c] ?? []).length));
    return Math.round(Math.min(260, Math.max(64, longest * CHAR_WIDTH + CELL_PADDING)));
  });
}

function Table({ block, p }: { block: Extract<Block, { type: 'table' }>; p: Palette }) {
  const widths = useMemo(() => columnWidths(block), [block]);
  const cell = (spans: Span[], c: number, header: boolean) => (
    <View key={c} style={[styles.cell, { width: widths[c], borderColor: p.border }]}>
      <Text style={[type.meta, { color: header ? p.muted : p.text, textAlign: block.align[c] ?? 'left' }, header && { fontFamily: fonts.sansMedium }]}>
        <Spans spans={spans} base={type.meta} p={p} />
      </Text>
    </View>
  );
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[styles.tableWrap, { borderColor: p.border }]}>
      <View>
        <View style={[styles.row, { backgroundColor: p.sunken }]}>{block.header.map((h, c) => cell(h, c, true))}</View>
        {block.rows.map((r, i) => (
          <View key={i} style={styles.row}>
            {r.map((c, j) => cell(c, j, false))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

/** Renders the assistant's Markdown in the prose serif. Parsing is memoized per text. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const p = usePalette();
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  const prose: TextStyle = { ...type.prose, color: p.prose };

  return (
    <View style={styles.stack}>
      {blocks.map((b, i) => {
        switch (b.type) {
          case 'heading':
            return (
              <Text key={i} accessibilityRole="header" style={[prose, { fontFamily: fonts.serifSemibold, fontSize: b.level === 1 ? 21 : b.level === 2 ? 19 : 17.5 }]}>
                <Spans spans={b.spans} base={prose} p={p} />
              </Text>
            );
          case 'paragraph':
            return (
              <Text key={i} style={prose} selectable>
                <Spans spans={b.spans} base={prose} p={p} />
              </Text>
            );
          case 'list':
            return (
              <View key={i} style={styles.list}>
                {b.items.map((item, j) => (
                  <View key={j} style={styles.item}>
                    <Text style={[prose, styles.marker, { color: p.muted }]}>{b.ordered ? `${b.start + j}.` : '•'}</Text>
                    <Text style={[prose, styles.itemText]} selectable>
                      <Spans spans={item} base={prose} p={p} />
                    </Text>
                  </View>
                ))}
              </View>
            );
          case 'code':
            return (
              <ScrollView key={i} horizontal style={[styles.code, { backgroundColor: p.sunken }]}>
                <Text style={[type.code, { color: p.text }]} selectable>
                  {b.text}
                </Text>
              </ScrollView>
            );
          case 'table':
            return <Table key={i} block={b} p={p} />;
          case 'rule':
            return <View key={i} style={[styles.rule, { backgroundColor: p.border }]} />;
        }
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  stack: { gap: 12 },
  list: { gap: 4 },
  item: { flexDirection: 'row' },
  marker: { width: 22 },
  itemText: { flex: 1 },
  code: { borderRadius: 8, padding: 12 },
  tableWrap: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, alignSelf: 'flex-start', maxWidth: '100%' },
  row: { flexDirection: 'row' },
  cell: { paddingHorizontal: 10, paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: 4 },
});
