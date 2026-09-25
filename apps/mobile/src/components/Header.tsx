import { memo } from 'react';
import Feather from '@expo/vector-icons/Feather';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatTokens } from '../lib/format';
import { row, scriptStyle, useI18n } from '../i18n';
import { type, usePalette } from '../theme';
import { IconButton } from './IconButton';

interface Props {
  title: string;
  onMenu: () => void;
  onNewChat: () => void;
  canStartNew: boolean;
  /** Tokens used in this conversation; the pill hides at 0. */
  tokens?: number;
  onUsage?: () => void;
  /** Unread scheduled reports: a bell with a count opens the inbox. */
  unread?: number;
  onInbox?: () => void;
}

export const Header = memo(function Header({ title, onMenu, onNewChat, canStartNew, tokens = 0, onUsage, unread = 0, onInbox }: Props) {
  const p = usePalette();
  const { t, rtl } = useI18n();
  const tok = formatTokens(tokens);
  return (
    <View style={[styles.bar, row(rtl), { backgroundColor: p.bg, borderBottomColor: p.border }]} testID="header">
      <IconButton name="menu" label={t.openConversations} onPress={onMenu} style={{ backgroundColor: p.sunken }} />
      <View style={styles.heading}>
        <View style={[styles.kicker, row(rtl)]}>
          <Text style={[type.caption, styles.brand, { color: p.accent }]}>DATALINK</Text>
          {tokens > 0 && onUsage && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.usageButton(tok)}
              onPress={onUsage}
              hitSlop={6}
              style={({ pressed }) => [styles.usage, row(rtl), pressed && { opacity: 0.6 }]}
              testID="usage-pill"
            >
              <Feather name="zap" size={11} color={p.muted} />
              <Text style={[type.caption, styles.usageText, { color: p.muted }]}>{tok}</Text>
            </Pressable>
          )}
        </View>
        <Text style={[scriptStyle(title, type.title), { color: p.text, textAlign: rtl ? 'right' : 'left' }]} numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
      </View>
      <View style={[styles.actions, row(rtl)]}>
        {onInbox && unread > 0 && (
          <View>
            <IconButton name="bell" label={t.inboxButton(unread)} onPress={onInbox} />
            <View style={[styles.badge, { backgroundColor: p.accent }]} pointerEvents="none">
              <Text style={styles.badgeText}>{unread > 9 ? '9+' : unread}</Text>
            </View>
          </View>
        )}
        <IconButton name="edit" label={t.appNewChat} onPress={onNewChat} disabled={!canStartNew} />
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  bar: { alignItems: 'center', paddingHorizontal: 14, minHeight: 70, gap: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  heading: { flex: 1, minWidth: 0, justifyContent: 'center', gap: 1 },
  kicker: { alignItems: 'center', justifyContent: 'space-between', minWidth: 0 },
  brand: { fontSize: 11, lineHeight: 16, fontWeight: '600', letterSpacing: 0.8 },
  actions: { alignItems: 'center', flexShrink: 0 },
  usage: { alignItems: 'center', gap: 4, minHeight: 18 },
  usageText: { fontVariant: ['tabular-nums'] },
  badge: { position: 'absolute', top: 3, right: 1, minWidth: 17, height: 17, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  badgeText: { color: '#fff', fontSize: 11, lineHeight: 14, fontWeight: '600' },
});
