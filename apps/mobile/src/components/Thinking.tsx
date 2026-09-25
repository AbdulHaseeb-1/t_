import { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native';
import { row, scriptStyle, useI18n } from '../i18n';
import { card, type, usePalette } from '../theme';

/** Three softly pulsing dots, with what the assistant is doing; static when the user prefers reduced motion. */
export function Thinking({ label }: { label?: string }) {
  const p = usePalette();
  const { t: strings, rtl } = useI18n();
  const [t] = useState(() => new Animated.Value(0));
  const [reduce, setReduce] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const elapsed = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const shown = label ?? strings.stageThinking;

  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);

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
    <View
      style={[styles.row, row(rtl), { alignSelf: rtl ? 'flex-end' : 'flex-start' }]}
      accessibilityLabel={`${shown}, ${elapsed}`}
      accessibilityRole="progressbar"
      accessibilityLiveRegion="polite"
    >
      <View style={[styles.indicator, card(p, 'sm')]}>
        <View style={[styles.dots, row(rtl)]}>
          {[0, 1, 2].map((i) => {
            const opacity = reduce
              ? 0.65
              : t.interpolate({
                  inputRange: [0, 0.2 + i * 0.2, 0.4 + i * 0.2, 1],
                  outputRange: [0.25, 1, 0.25, 0.25],
                  extrapolate: 'clamp',
                });
            return <Animated.View key={i} style={[styles.dot, { backgroundColor: p.accent, opacity }]} />;
          })}
        </View>
      </View>
      <View style={[styles.copy, { alignItems: rtl ? 'flex-end' : 'flex-start' }]}>
        <Animated.Text style={[scriptStyle(shown, type.label), styles.label, { color: p.text }]} numberOfLines={1}>
          {shown}
        </Animated.Text>
        <Animated.Text style={[type.meta, styles.elapsed, { color: p.faint }]}>{elapsed}</Animated.Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'center', gap: 10, paddingVertical: 4, maxWidth: '100%' },
  indicator: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  dots: { gap: 3, alignItems: 'center' },
  dot: { width: 4, height: 4, borderRadius: 2 },
  copy: { gap: 0, flexShrink: 1 },
  label: { flexShrink: 1 },
  elapsed: { fontVariant: ['tabular-nums'] },
});
