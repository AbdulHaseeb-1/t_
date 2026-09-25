import { type ReactNode, useState } from 'react';
import { Animated, Platform, Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import { card, usePalette } from '../theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type Props = Omit<PressableProps, 'style' | 'children'> & { style?: StyleProp<ViewStyle>; children: ReactNode };

/** A borderless, softly shadowed card that eases down a touch while pressed and springs back. */
export function PressableCard({ style, children, onPressIn, onPressOut, ...rest }: Props) {
  const p = usePalette();
  const [scale] = useState(() => new Animated.Value(1));
  const to = (value: number) =>
    Animated.spring(scale, { toValue: value, speed: 40, bounciness: value === 1 ? 6 : 0, useNativeDriver: Platform.OS !== 'web' }).start();

  return (
    <AnimatedPressable
      {...rest}
      onPressIn={(e) => {
        to(0.975);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        to(1);
        onPressOut?.(e);
      }}
      style={[card(p), style, { transform: [{ scale }] }]}
    >
      {children}
    </AnimatedPressable>
  );
}
