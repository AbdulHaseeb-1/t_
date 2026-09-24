import Feather from '@expo/vector-icons/Feather';
import { memo, useEffect, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Chat } from '../state/chat-reducer';
import { row, scriptStyle, useI18n } from '../i18n';
import { fonts, type, usePalette } from '../theme';

interface Props {
  open: boolean;
  chats: Chat[];
  activeId: string | null;
  onClose: () => void;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onDelete: (id: string) => void;
  onSettings: () => void;
}

function relativeDay(ts: number, t: ReturnType<typeof useI18n>['t'], lang: string): string {
  const days = Math.floor((Date.now() - ts) / 86_400_000);
  if (days <= 0) return t.today;
  if (days === 1) return t.yesterday;
  if (days < 7) return t.daysAgo(days);
  return new Date(ts).toLocaleDateString(lang === 'ur' ? 'ur-PK' : undefined, { month: 'short', day: 'numeric' });
}

/** Conversation list: slides over the chat, dismissed by the scrim or a selection. */
export const Drawer = memo(function Drawer({ open, chats, activeId, onClose, onSelect, onNewChat, onDelete, onSettings }: Props) {
  const p = usePalette();
  const { t, rtl, lang } = useI18n();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const panelWidth = Math.min(320, width * 0.84);
  const [x] = useState(() => new Animated.Value(0));
  const [mounted, setMounted] = useState(open);
  const [confirming, setConfirming] = useState<string | null>(null);

  useEffect(() => {
    if (open) setMounted(true);
    Animated.timing(x, {
      toValue: open ? 1 : 0,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished && !open) {
        setMounted(false);
        setConfirming(null);
      }
    });
  }, [open, x]);

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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.startNewChat}
          onPress={onNewChat}
          style={({ pressed }) => [styles.row, row(rtl), pressed && { backgroundColor: p.sunken }]}
        >
          <Feather name="edit" size={18} color={p.text} />
          <Text style={[scriptStyle(t.appNewChat, type.label), { color: p.text }]}>{t.appNewChat}</Text>
        </Pressable>

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
                  <Text style={[scriptStyle(t.delete, { ...type.label, fontFamily: fonts.sansSemibold }, 'bold'), { color: p.danger }]}>{t.delete}</Text>
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
                <Text style={[scriptStyle(c.title || t.voiceMessage, { ...type.label, fontFamily: fonts.sans }), { color: p.text }]} numberOfLines={1}>
                  {c.title || t.voiceMessage}
                </Text>
                <Text style={[scriptStyle(t.today, type.meta), { color: p.faint, textAlign: rtl ? 'right' : 'left' }]}>{relativeDay(c.updatedAt, t, lang)}</Text>
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
  row: { alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 12, borderRadius: 10 },
  section: { paddingHorizontal: 12, paddingTop: 16, paddingBottom: 6 },
  list: { flex: 1 },
  chat: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, gap: 1 },
  empty: { paddingHorizontal: 12, paddingVertical: 8 },
});
