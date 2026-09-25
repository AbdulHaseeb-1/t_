import { type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { row, scriptStyle, useI18n } from '../i18n';
import { card, type, usePalette } from '../theme';
import { OnCard } from './surface';
import { IconButton } from './IconButton';
import { KeyboardAware } from './KeyboardAware';

/** Bottom sheet: dimmed backdrop, rounded top, title bar with close. */
export function Sheet({ visible, title, onClose, children, testID }: { visible: boolean; title: string; onClose: () => void; children: ReactNode; testID?: string }) {
  const p = usePalette();
  const { t, rtl } = useI18n();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAware style={styles.fill}>
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: p.scrim }]} onPress={onClose} accessibilityLabel={t.cancel} />
        <View style={[styles.sheet, { backgroundColor: p.bg, paddingBottom: insets.bottom + 12 }]} testID={testID} accessibilityViewIsModal>
          <View style={[styles.grabber, { backgroundColor: p.border }]} />
          <View style={[styles.bar, row(rtl)]}>
            <Text style={[scriptStyle(title, type.title), styles.title, { color: p.text }]} accessibilityRole="header">
              {title}
            </Text>
            <IconButton name="x" label={t.cancel} size={20} onPress={onClose} />
          </View>
          <ScrollView contentContainerStyle={styles.body}>{children}</ScrollView>
        </View>
      </KeyboardAware>
    </Modal>
  );
}

/** A titled group inside a sheet or settings page (inset, rounded, hairline dividers). */
export function Group({ title, children, footer }: { title?: string; children: ReactNode; footer?: string }) {
  const p = usePalette();
  return (
    <View style={styles.group}>
      {!!title && <Text style={[scriptStyle(title, type.meta), styles.groupTitle, { color: p.muted }]}>{title}</Text>}
      <View style={[styles.shell, card(p)]}>
        <View style={styles.card}>
          <OnCard.Provider value>{children}</OnCard.Provider>
        </View>
      </View>
      {!!footer && <Text style={[scriptStyle(footer, type.meta), styles.footer, { color: p.faint }]}>{footer}</Text>}
    </View>
  );
}

/** Label on one side, value on the other. */
export function Stat({ label, value, sub, last }: { label: string; value: string; sub?: string; last?: boolean }) {
  const p = usePalette();
  const { rtl } = useI18n();
  return (
    <View style={[styles.stat, row(rtl), !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: p.border }]} accessible accessibilityLabel={`${label}: ${value}${sub ? `, ${sub}` : ''}`}>
      <Text style={[scriptStyle(label, type.body), styles.statLabel, { color: p.text }]}>{label}</Text>
      <View style={styles.statRight}>
        <Text style={[type.body, { color: p.text, fontVariant: ['tabular-nums'] }]}>{value}</Text>
        {!!sub && <Text style={[scriptStyle(sub, type.meta), { color: p.muted }]}>{sub}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: '88%', width: '100%', maxWidth: 640, alignSelf: 'center' },
  grabber: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginTop: 8 },
  bar: { alignItems: 'center', paddingHorizontal: 12, paddingTop: 4, height: 48 },
  title: { flex: 1, paddingHorizontal: 8 },
  body: { paddingHorizontal: 16, paddingBottom: 12, gap: 18 },
  group: { gap: 6 },
  groupTitle: { paddingHorizontal: 4 },
  shell: { borderRadius: 16 },
  card: { borderRadius: 16, overflow: 'hidden' },
  footer: { paddingHorizontal: 4 },
  stat: { alignItems: 'center', paddingHorizontal: 14, paddingVertical: 11, gap: 12 },
  statLabel: { flex: 1 },
  statRight: { alignItems: 'flex-end' },
});
