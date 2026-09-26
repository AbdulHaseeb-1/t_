import Feather from '@expo/vector-icons/Feather';
import { memo, useEffect, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Chat } from '../state/chat-reducer';
import { row, scriptStyle, useI18n } from '../i18n';
import { type, usePalette, weight } from '../theme';
import { RouteMark } from './RouteMark';

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

function relativeDay(ts: number, t: ReturnType<typeof useI18n>['t'], lang: string): string {
  const days = Math.floor((Date.now() - ts) / 86_400_000);
  if (days <= 0) return t.today;
  if (days === 1) return t.yesterday;
  if (days < 7) return t.daysAgo(days);
  return new Date(ts).toLocaleDateString(lang === 'ur' ? 'ur-PK' : undefined, { month: 'short', day: 'numeric' });
}

/** Conversation list: slides over the chat, dismissed by the scrim or a selection. */
export const Drawer = memo(function Drawer({ open, chats, activeId, onClose, onSelect, onNewChat, onDelete, onSettings, onReports, onSchedules, onInbox, unread = 0 }: Props) {
  const p = usePalette();
  const { t, rtl, lang } = useI18n();
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
            backgroundColor: p.sidebar,
            paddingTop: insets.top + 8,
            paddingBottom: insets.bottom + 8,
            transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [rtl ? panelWidth : -panelWidth, 0] }) }],
          },
        ]}
      >
        <View style={[styles.drawerHeader, row(rtl)]}>
          <View style={[styles.brand, row(rtl)]}>
            <RouteMark size={28} />
            <Text style={[styles.brandName, { color: p.text }]}>Datalink</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.closeConversations}
            onPress={onClose}
            hitSlop={6}
            style={({ pressed }) => [styles.closeButton, pressed && { backgroundColor: p.selected }]}
          >
            <Feather name="x" size={18} color={p.muted} />
          </Pressable>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.startNewChat}
          onPress={onNewChat}
          style={({ pressed }) => [styles.row, styles.newChat, row(rtl), { backgroundColor: pressed ? p.selected : p.bg, borderColor: p.border }]}
        >
          <Feather name="edit" size={17} color={p.text} />
          <Text style={[scriptStyle(t.appNewChat, { ...type.label, ...weight.semibold }), { color: p.text }]}>{t.appNewChat}</Text>
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
              style={({ pressed }) => [styles.row, row(rtl), pressed && { backgroundColor: p.selected }]}
            >
              <Feather name={icon} size={18} color={p.muted} />
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
                style={({ pressed }) => [styles.chat, (pressed || c.id === activeId) && { backgroundColor: p.selected }]}
              >
                <Text style={[scriptStyle(c.title || t.voiceMessage, type.body), { color: p.text }]} numberOfLines={1}>
                  {c.title || t.voiceMessage}
                </Text>
                <Text style={[scriptStyle(t.today, type.caption), { color: p.faint, textAlign: rtl ? 'right' : 'left' }]}>{relativeDay(c.updatedAt, t, lang)}</Text>
              </Pressable>
            ),
          )}
        </ScrollView>

        <View style={[styles.divider, { backgroundColor: p.border }]} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.settings}
          onPress={onSettings}
          style={({ pressed }) => [styles.row, row(rtl), pressed && { backgroundColor: p.selected }]}
        >
          <Feather name="settings" size={18} color={p.muted} />
          <Text style={[scriptStyle(t.settings, type.label), { color: p.text }]}>{t.settings}</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
});

const styles = StyleSheet.create({
  panel: { position: 'absolute', top: 0, bottom: 0, paddingHorizontal: 8 },
  drawerHeader: { minHeight: 52, alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, marginBottom: 8 },
  brand: { alignItems: 'center', gap: 10 },
  brandName: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  newChat: { borderWidth: 1, marginBottom: 6 },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: 12, marginVertical: 4 },
  closeButton: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  row: { alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 12, borderRadius: 10 },
  section: { paddingHorizontal: 12, paddingTop: 18, paddingBottom: 6, fontSize: 13 },
  list: { flex: 1 },
  chat: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, gap: 1 },
  empty: { paddingHorizontal: 12, paddingVertical: 8 },
  count: { minWidth: 20, paddingHorizontal: 6, borderRadius: 10, overflow: 'hidden', textAlign: 'center' },
});
