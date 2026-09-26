import { memo } from 'react';
import Feather from '@expo/vector-icons/Feather';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatTokens } from '../lib/format';
import { row, scriptStyle, useI18n } from '../i18n';
import { type, usePalette, weight } from '../theme';
import { IconButton } from './IconButton';

interface Props {
  title: string;
  onMenu: () => void;
  onNewChat: () => void;
  canStartNew: boolean;
  /** Tokens used in this conversation; the usage line hides at 0. */
  tokens?: number;
  onUsage?: () => void;
  /** Unread scheduled reports: a bell with a count opens the inbox. */
  unread?: number;
  onInbox?: () => void;
}

/** Equal side slots keep the title centered whether one or two actions show. */
const SIDE = 84;

/** A quiet bar: menu, the conversation's title in the middle, new chat. No divider: the page flows under it. */
export const Header = memo(function Header({ title, onMenu, onNewChat, canStartNew, tokens = 0, onUsage, unread = 0, onInbox }: Props) {
  const p = usePalette();
  const { t, rtl } = useI18n();
  const tok = formatTokens(tokens);
  return (
    <View style={[styles.bar, row(rtl), { backgroundColor: p.bg }]} testID="header">
      <View style={[styles.side, row(rtl)]}>
        <IconButton name="menu" label={t.openConversations} onPress={onMenu} />
      </View>
      <View style={styles.heading}>
        <Text style={[scriptStyle(title, { ...type.title, ...weight.semibold }), styles.title, { color: p.text }]} numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
        {tokens > 0 && onUsage && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.usageButton(tok)}
            onPress={onUsage}
            hitSlop={8}
            style={({ pressed }) => [styles.usage, pressed && { opacity: 0.55 }]}
            testID="usage-pill"
          >
            <Feather name="zap" size={10} color={p.faint} />
            <Text style={[type.caption, styles.usageText, { color: p.faint }]}>{`${tok} ${t.tokens.toLowerCase()}`}</Text>
          </Pressable>
        )}
      </View>
      <View style={[styles.side, styles.actions, row(rtl)]}>
        {onInbox && unread > 0 && (
          <View>
            <IconButton name="bell" label={t.inboxButton(unread)} onPress={onInbox} />
            <View style={[styles.badge, { backgroundColor: p.accent, borderColor: p.bg }]} pointerEvents="none">
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
  bar: { alignItems: 'center', paddingHorizontal: 8, minHeight: 56 },
  side: { width: SIDE, alignItems: 'center' },
  actions: { justifyContent: 'flex-end' },
  heading: { flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center' },
  title: { textAlign: 'center', fontSize: 16, lineHeight: 22 },
  usage: { flexDirection: 'row', alignItems: 'center', gap: 3, minHeight: 16 },
  usageText: { fontVariant: ['tabular-nums'], fontSize: 11, lineHeight: 15 },
  badge: { position: 'absolute', top: 4, right: 3, minWidth: 17, height: 17, borderRadius: 9, borderWidth: 2, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  badgeText: { color: '#fff', fontSize: 10, lineHeight: 13, fontWeight: '700' },
});
