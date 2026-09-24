import { memo, useEffect, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, View } from 'react-native';

const NATIVE = Platform.OS !== 'web';
const MAX_H = 26;
const MIN_H = 3;

/** Live input level as a scrolling bar strip; newest bar on the trailing edge. */
export const Waveform = memo(function Waveform({ levels, color, rtl }: { levels: number[]; color: string; rtl: boolean }) {
  return (
    <View style={[styles.strip, { flexDirection: rtl ? 'row-reverse' : 'row' }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {levels.map((l, i) => (
        <View
          key={i}
          style={[
            styles.bar,
            {
              height: MIN_H + l * (MAX_H - MIN_H),
              backgroundColor: color,
              // Older bars fade slightly, so the eye follows the live edge.
              opacity: 0.35 + 0.65 * ((i + 1) / levels.length),
            },
          ]}
        />
      ))}
    </View>
  );
});

/** Recording indicator: a red dot that breathes. */
export function PulseDot({ color }: { color: string }) {
  const [v] = useState(() => new Animated.Value(1));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 0.25, duration: 650, easing: Easing.inOut(Easing.quad), useNativeDriver: NATIVE }),
        Animated.timing(v, { toValue: 1, duration: 650, easing: Easing.inOut(Easing.quad), useNativeDriver: NATIVE }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [v]);
  return <Animated.View style={[styles.dot, { backgroundColor: color, opacity: v }]} />;
}

const styles = StyleSheet.create({
  strip: { flex: 1, height: MAX_H, alignItems: 'center', justifyContent: 'flex-end', gap: 2, overflow: 'hidden' },
  bar: { width: 3, borderRadius: 1.5 },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
