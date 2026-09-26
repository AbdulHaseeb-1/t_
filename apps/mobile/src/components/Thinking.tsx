import { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native';
import { row, scriptStyle, useI18n } from '../i18n';
import { type, usePalette } from '../theme';

/** The timer appears only once a wait is long enough to be worth measuring. */
const SHOW_TIMER_S = 4;

/**
 * What the assistant is doing before its answer starts: a softly breathing dot
 * and a shimmering stage label ("Thinking", "Querying: Net sales by month").
 * Static when the person prefers reduced motion.
 */
export function Thinking({ label }: { label?: string }) {
  const p = usePalette();
  const { t: strings, rtl } = useI18n();
  const [pulse] = useState(() => new Animated.Value(0));
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
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduce, pulse]);

  const dot = reduce
    ? { opacity: 0.8 }
    : {
        opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }),
        transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.78, 1.08] }) }],
      };
  const shimmer = reduce ? { opacity: 0.8 } : { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0.95] }) };

  return (
    <View
      style={[styles.row, row(rtl), { alignSelf: rtl ? 'flex-end' : 'flex-start' }]}
      accessibilityLabel={`${shown}, ${elapsed}`}
      accessibilityRole="progressbar"
      accessibilityLiveRegion="polite"
    >
      <Animated.View style={[styles.dot, { backgroundColor: p.text }, dot]} />
      <Animated.Text style={[scriptStyle(shown, type.body), styles.label, { color: p.text }, shimmer]} numberOfLines={1}>
        {shown}
      </Animated.Text>
      {seconds >= SHOW_TIMER_S && <Animated.Text style={[type.meta, styles.elapsed, { color: p.faint }]}>{elapsed}</Animated.Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'center', gap: 10, minHeight: 32, maxWidth: '100%' },
  dot: { width: 12, height: 12, borderRadius: 6 },
  label: { flexShrink: 1 },
  elapsed: { fontVariant: ['tabular-nums'] },
});
