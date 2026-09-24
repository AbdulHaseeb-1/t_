import { memo, useMemo } from 'react';
import { ScrollView, StyleSheet, Text, type TextStyle, View } from 'react-native';
import { type Block, parseMarkdown, type Span, spansToText } from '../lib/markdown';
import { isUrduText, scriptStyle } from '../i18n';
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
        if (s.bold && base.fontFamily === fonts.urdu) style.push({ fontFamily: fonts.urduBold });
        else if (s.bold) style.push({ fontFamily: base.fontFamily === fonts.serif ? fonts.serifSemibold : fonts.sansSemibold });
        if (s.italic && base.fontFamily !== fonts.urdu) style.push({ fontFamily: fonts.serifItalic });
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
/** Nastaliq glyphs run wider and taller than Latin at the same size. */
const URDU_CHAR_WIDTH = 8.6;
const CELL_PADDING = 20;

/** One width per column, from its longest cell, so header and body always line up. */
function columnWidths(block: Extract<Block, { type: 'table' }>): number[] {
  return block.header.map((h, c) => {
    const cells = [h, ...block.rows.map((r) => r[c] ?? [])].map(spansToText);
    const width = Math.max(...cells.map((t) => t.length * (isUrduText(t) ? URDU_CHAR_WIDTH : CHAR_WIDTH)));
    return Math.round(Math.min(260, Math.max(64, width + CELL_PADDING)));
  });
}

function Table({ block, p }: { block: Extract<Block, { type: 'table' }>; p: Palette }) {
  const widths = useMemo(() => columnWidths(block), [block]);
  // Urdu headings: columns read right to left, like the prose around them.
  const rtlTable = block.header.some((h) => isUrduText(spansToText(h)));
  const cell = (spans: Span[], c: number, header: boolean) => (
    <View key={c} style={[styles.cell, { width: widths[c], borderColor: p.border }]}>
      <Text
        style={[
          ...scriptStyle(spansToText(spans), header ? { ...type.meta, fontFamily: fonts.sansMedium } : type.meta),
          { color: header ? p.muted : p.text },
          !isUrduText(spansToText(spans)) && { textAlign: block.align[c] ?? 'left' },
        ]}
      >
        <Spans spans={spans} base={isUrduText(spansToText(spans)) ? { fontFamily: fonts.urdu } : type.meta} p={p} />
      </Text>
    </View>
  );
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[styles.tableWrap, { borderColor: p.border }]}>
      <View>
        <View style={[styles.row, rtlTable && styles.rowRtl, { backgroundColor: p.sunken }]}>{block.header.map((h, c) => cell(h, c, true))}</View>
        {block.rows.map((r, i) => (
          <View key={i} style={[styles.row, rtlTable && styles.rowRtl]}>
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
  /** Urdu blocks: Nastaliq, right-aligned, right-to-left; others keep the serif. */
  const proseFor = (text: string, weight: 'regular' | 'bold' = 'regular'): TextStyle =>
    StyleSheet.flatten(scriptStyle(text, weight === 'bold' ? { ...prose, fontFamily: fonts.serifSemibold } : prose, weight));

  return (
    <View style={styles.stack}>
      {blocks.map((b, i) => {
        switch (b.type) {
          case 'heading':
            return (
              <Text key={i} accessibilityRole="header" style={[proseFor(spansToText(b.spans), 'bold'), !isUrduText(spansToText(b.spans)) && { fontSize: b.level === 1 ? 21 : b.level === 2 ? 19 : 17.5 }]}>
                <Spans spans={b.spans} base={proseFor(spansToText(b.spans))} p={p} />
              </Text>
            );
          case 'paragraph':
            return (
              <Text key={i} style={proseFor(spansToText(b.spans))} selectable>
                <Spans spans={b.spans} base={proseFor(spansToText(b.spans))} p={p} />
              </Text>
            );
          case 'list': {
            const urdu = b.items.some((it) => isUrduText(spansToText(it)));
            return (
              <View key={i} style={styles.list}>
                {b.items.map((item, j) => (
                  <View key={j} style={[styles.item, urdu && { flexDirection: 'row-reverse' }]}>
                    <Text style={[prose, styles.marker, { color: p.muted, textAlign: urdu ? 'right' : 'left' }]}>{b.ordered ? `${b.start + j}.` : '•'}</Text>
                    <Text style={[proseFor(spansToText(item)), styles.itemText]} selectable>
                      <Spans spans={item} base={proseFor(spansToText(item))} p={p} />
                    </Text>
                  </View>
                ))}
              </View>
            );
          }
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
  rowRtl: { flexDirection: 'row-reverse' },
  cell: { paddingHorizontal: 10, paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: 4 },
});
