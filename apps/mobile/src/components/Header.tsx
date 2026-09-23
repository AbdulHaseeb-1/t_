import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
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
  return (
    <View style={styles.bar}>
      <IconButton name="menu" label="Open conversations" onPress={onMenu} />
      <Text style={[type.title, styles.title, { color: p.text }]} numberOfLines={1} accessibilityRole="header">
        {title}
      </Text>
      <IconButton name="edit" label="New chat" onPress={onNewChat} disabled={!canStartNew} />
    </View>
  );
});

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, height: 52, gap: 4 },
  title: { flex: 1, textAlign: 'center' },
});
