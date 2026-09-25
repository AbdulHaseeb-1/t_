import Feather from '@expo/vector-icons/Feather';
import { memo, useEffect, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Chat } from '../state/chat-reducer';
import { row, scriptStyle, useI18n } from '../i18n';
import { type, usePalette, weight } from '../theme';

interface Props {
  open: boolean;
  chats: Chat[];
  activeId: string | null;
  onClose: () => void;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onDelete: (id: string) => void;
  onSettings: () => void;
  onReports?: () => void;
  onSchedules?: () => void;
  onInbox?: () => void;
  unread?: number;
}

/** Conversation list: slides over the chat, dismissed by the scrim or a selection. */
export const Drawer = memo(function Drawer({ open, chats, activeId, onClose, onSelect, onNewChat, onDelete, onSettings, onReports, onSchedules, onInbox, unread = 0 }: Props) {
  const p = usePalette();
  const { t, rtl } = useI18n();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const panelWidth = Math.min(320, width * 0.84);
  const [x] = useState(() => new Animated.Value(0));
  const [mounted, setMounted] = useState(open);
  const [confirming, setConfirming] = useState<string | null>(null);

  useEffect(() => {
    // Mount the panel first so its native-driven opening animation is attached to a view.
    if (open && !mounted) {
      setMounted(true);
      return;
    }
    if (!mounted) return;

    const animation = Animated.timing(x, {
      toValue: open ? 1 : 0,
      duration: open ? 260 : 220,
      easing: open ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (finished && !open) {
        setMounted(false);
        setConfirming(null);
      }
    });
    return () => animation.stop();
  }, [open, mounted, x]);

  if (!mounted) return null;

  return (
    <View style={StyleSheet.absoluteFill} accessibilityViewIsModal>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: p.scrim, opacity: x }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel={t.closeConversations} />
      </Animated.View>
      <Animated.View
        style={[
          styles.panel,
          {
            width: panelWidth,
            // Slides in from the reading start: left in English, right in Urdu.
            ...(rtl ? { right: 0 } : { left: 0 }),
            backgroundColor: p.bg,
            paddingTop: insets.top + 8,
            paddingBottom: insets.bottom + 8,
            transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [rtl ? panelWidth : -panelWidth, 0] }) }],
          },
        ]}
      >
        <View style={[styles.drawerHeader, row(rtl), { borderBottomColor: p.border }]}>
          <View style={[styles.brand, row(rtl)]}>
            <View style={[styles.brandMark, { backgroundColor: p.sunken }]}>
              <Feather name="database" size={16} color={p.accent} />
            </View>
            <Text style={[styles.brandName, { color: p.text }]}>DATALINK</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.closeConversations}
            onPress={onClose}
            hitSlop={6}
            style={({ pressed }) => [styles.closeButton, pressed && { backgroundColor: p.sunken }]}
          >
            <Feather name="x" size={18} color={p.muted} />
          </Pressable>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.startNewChat}
          onPress={onNewChat}
          style={({ pressed }) => [styles.row, row(rtl), pressed && { backgroundColor: p.sunken }]}
        >
          <Feather name="edit" size={18} color={p.text} />
          <Text style={[scriptStyle(t.appNewChat, type.label), { color: p.text }]}>{t.appNewChat}</Text>
        </Pressable>

        {(
          [
            [onReports, 'grid', t.reports, 0],
            [onSchedules, 'clock', t.schedules, 0],
            [onInbox, 'inbox', t.inbox, unread],
          ] as const
        ).map(([onPress, icon, label, count]) =>
          onPress ? (
            <Pressable
              key={label}
              accessibilityRole="button"
              accessibilityLabel={count ? t.inboxButton(count) : label}
              onPress={onPress}
              style={({ pressed }) => [styles.row, row(rtl), pressed && { backgroundColor: p.sunken }]}
            >
              <Feather name={icon} size={18} color={p.text} />
              <Text style={[scriptStyle(label, type.label), { color: p.text, flex: 1 }]}>{label}</Text>
              {count > 0 && <Text style={[type.meta, styles.count, { color: '#fff', backgroundColor: p.accent }]}>{count > 99 ? '99+' : count}</Text>}
            </Pressable>
          ) : null,
        )}

        <Text style={[scriptStyle(t.recents, type.meta), styles.section, { color: p.muted, textAlign: rtl ? 'right' : 'left' }]}>{t.recents}</Text>
        <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 8 }}>
          {chats.length === 0 && <Text style={[scriptStyle(t.noChats, type.meta), styles.empty, { color: p.faint }]}>{t.noChats}</Text>}
          {chats.map((c) =>
            confirming === c.id ? (
              <View key={c.id} style={[styles.row, row(rtl), { backgroundColor: p.dangerSoft }]}>
                <Text style={[scriptStyle(t.deleteChat, type.label), { color: p.text, flex: 1 }]} numberOfLines={1}>
                  {t.deleteChat}
                </Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Cancel delete" onPress={() => setConfirming(null)} hitSlop={8}>
                  <Text style={[scriptStyle(t.cancel, type.label), { color: p.muted }]}>{t.cancel}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel="Confirm delete" onPress={() => onDelete(c.id)} hitSlop={8}>
                  <Text style={[scriptStyle(t.delete, { ...type.label, ...weight.semibold }, 'bold'), { color: p.danger }]}>{t.delete}</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable
                key={c.id}
                accessibilityRole="button"
                accessibilityLabel={`Open ${c.title || t.voiceMessage}`}
                accessibilityHint="Long press to delete"
                accessibilityState={{ selected: c.id === activeId }}
                onPress={() => onSelect(c.id)}
                onLongPress={() => setConfirming(c.id)}
                style={({ pressed }) => [styles.chat, (pressed || c.id === activeId) && { backgroundColor: p.sunken }]}
              >
                <Text style={[scriptStyle(c.title || t.voiceMessage, type.body), { color: p.text }]} numberOfLines={1}>
                  {c.title || t.voiceMessage}
                </Text>
              </Pressable>
            ),
          )}
        </ScrollView>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.settings}
          onPress={onSettings}
          style={({ pressed }) => [styles.row, row(rtl), { borderTopColor: p.border, borderTopWidth: StyleSheet.hairlineWidth }, pressed && { backgroundColor: p.sunken }]}
        >
          <Feather name="settings" size={18} color={p.text} />
          <Text style={[scriptStyle(t.settings, type.label), { color: p.text }]}>{t.settings}</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
});

const styles = StyleSheet.create({
  panel: { position: 'absolute', top: 0, bottom: 0, paddingHorizontal: 8 },
  drawerHeader: { minHeight: 52, alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, marginBottom: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  brand: { alignItems: 'center', gap: 10 },
  brandMark: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  brandName: { fontSize: 13, lineHeight: 18, fontWeight: '700', letterSpacing: 1.1 },
  closeButton: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  row: { alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 12, borderRadius: 10 },
  section: { paddingHorizontal: 12, paddingTop: 16, paddingBottom: 6 },
  list: { flex: 1 },
  chat: { paddingHorizontal: 12, paddingVertical: 11, borderRadius: 10 },
  empty: { paddingHorizontal: 12, paddingVertical: 8 },
  count: { minWidth: 20, paddingHorizontal: 6, borderRadius: 10, overflow: 'hidden', textAlign: 'center' },
});
