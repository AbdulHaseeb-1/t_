import { type ReactNode, useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, type StyleProp, type ViewStyle } from 'react-native';

/**
 * Fades and lifts its content into place once, when it first appears in a
 * live answer (charts and tables after the text). Content that is simply
 * scrolled back into view is not animated again. Respects reduced motion.
 */
export function FadeIn({
  children,
  enabled,
  delay = 0,
  distance = 10,
  duration = 340,
  style,
}: {
  children: ReactNode;
  enabled: boolean;
  delay?: number;
  /** How far below its place the content starts, in points. */
  distance?: number;
  duration?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const [v] = useState(() => new Animated.Value(enabled ? 0 : 1));

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let anim: Animated.CompositeAnimation | undefined;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (cancelled) return;
      if (reduce) return v.setValue(1);
      anim = Animated.timing(v, { toValue: 1, duration, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true });
      anim.start();
    });
    return () => {
      cancelled = true;
      anim?.stop();
      v.setValue(1);
    };
  }, [enabled, delay, duration, v]);

  return (
    <Animated.View style={[style, { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) }] }]}>
      {children}
    </Animated.View>
  );
}
