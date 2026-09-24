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
}

export const Header = memo(function Header({ title, onMenu, onNewChat, canStartNew, tokens = 0, onUsage }: Props) {
  const p = usePalette();
  const { t, rtl } = useI18n();
  const tok = formatTokens(tokens);
  return (
    <View style={[styles.bar, row(rtl)]} testID="header">
      <IconButton name="menu" label={t.openConversations} onPress={onMenu} />
      <Text style={[scriptStyle(title, type.title), styles.title, { color: p.text, textAlign: 'center' }]} numberOfLines={1} accessibilityRole="header">
        {title}
      </Text>
      {tokens > 0 && onUsage && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.usageButton(tok)}
          onPress={onUsage}
          hitSlop={6}
          style={({ pressed }) => [styles.pill, row(rtl), { borderColor: p.border }, pressed && { backgroundColor: p.sunken }]}
          testID="usage-pill"
        >
          <Feather name="zap" size={12} color={p.muted} />
          <Text style={[type.meta, styles.pillText, { color: p.muted }]}>{tok}</Text>
        </Pressable>
      )}
      <IconButton name="edit" label={t.appNewChat} onPress={onNewChat} disabled={!canStartNew} />
    </View>
  );
});

const styles = StyleSheet.create({
  bar: { alignItems: 'center', paddingHorizontal: 8, height: 56, gap: 4 },
  title: { flex: 1, textAlign: 'center' },
  pill: { alignItems: 'center', gap: 4, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, paddingHorizontal: 8, height: 26 },
  pillText: { fontVariant: ['tabular-nums'] },
});
