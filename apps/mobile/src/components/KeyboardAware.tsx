import { type ReactNode } from 'react';
import { KeyboardAvoidingView, type StyleProp, StyleSheet, type ViewStyle } from 'react-native';

/**
 * Keeps inputs above the software keyboard. Android draws edge-to-edge, so the
 * window is no longer resized for the keyboard (adjustResize has no effect);
 * padding by the keyboard's height is applied on both platforms instead.
 */
export function KeyboardAware({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.fill, style]}>
      {children}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
