import Feather from '@expo/vector-icons/Feather';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, type ViewStyle } from 'react-native';
import { usePalette } from '../theme';

type Name = ComponentProps<typeof Feather>['name'];

interface Props {
  name: Name;
  label: string;
  onPress: () => void;
  size?: number;
  color?: string;
  style?: ViewStyle;
  disabled?: boolean;
}

/** 44pt hit target around a small glyph, per platform guidelines. */
export function IconButton({ name, label, onPress, size = 22, color, style, disabled }: Props) {
  const p = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.btn, pressed && { backgroundColor: p.sunken }, disabled && styles.disabled, style]}
    >
      <Feather name={name} size={size} color={color ?? p.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.35 },
});
