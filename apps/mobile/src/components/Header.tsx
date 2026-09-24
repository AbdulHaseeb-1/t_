import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { row, scriptStyle, useI18n } from '../i18n';
import { type, usePalette } from '../theme';
import { IconButton } from './IconButton';

interface Props {
  title: string;
  onMenu: () => void;
  onNewChat: () => void;
  canStartNew: boolean;
}

export const Header = memo(function Header({ title, onMenu, onNewChat, canStartNew }: Props) {
  const p = usePalette();
  const { t, rtl } = useI18n();
  return (
    <View style={[styles.bar, row(rtl)]} testID="header">
      <IconButton name="menu" label={t.openConversations} onPress={onMenu} />
      <Text style={[scriptStyle(title, type.title), styles.title, { color: p.text, textAlign: 'center' }]} numberOfLines={1} accessibilityRole="header">
        {title}
      </Text>
      <IconButton name="edit" label={t.appNewChat} onPress={onNewChat} disabled={!canStartNew} />
    </View>
  );
});

const styles = StyleSheet.create({
  bar: { alignItems: 'center', paddingHorizontal: 8, height: 56, gap: 4 },
  title: { flex: 1, textAlign: 'center' },
});
