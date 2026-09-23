import { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native';
import { usePalette } from '../theme';

/** Three softly pulsing dots; static when the user prefers reduced motion. */
export function Thinking() {
  const p = usePalette();
  const [t] = useState(() => new Animated.Value(0));
  const [reduce, setReduce] = useState(false);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduce);
  }, []);

  useEffect(() => {
    if (reduce) return;
    const loop = Animated.loop(
      Animated.timing(t, { toValue: 1, duration: 1200, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [reduce, t]);

  return (
    <View style={styles.row} accessibilityLabel="Working on it" accessibilityRole="progressbar">
      {[0, 1, 2].map((i) => {
        const opacity = reduce
          ? 0.6
          : t.interpolate({
              inputRange: [0, 0.2 + i * 0.2, 0.4 + i * 0.2, 1],
              outputRange: [0.25, 1, 0.25, 0.25],
              extrapolate: 'clamp',
            });
        return <Animated.View key={i} style={[styles.dot, { backgroundColor: p.muted, opacity }]} />;
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 6, paddingVertical: 10 },
  dot: { width: 7, height: 7, borderRadius: 3.5 },
});
