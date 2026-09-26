import Feather from '@expo/vector-icons/Feather';
import { memo, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Image,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  type TextInputKeyPressEventData,
  View,
} from 'react-native';
import { isUrduText, row, scriptStyle, useI18n } from '../i18n';
import { tap } from '../lib/feedback';
import { type PickedImage, pickImage } from '../lib/media';
import { useVoice } from '../lib/useVoice';
import type { Outgoing } from '../state/chats';
import { card, fonts, type, usePalette, weight } from '../theme';
import { IconButton } from './IconButton';
import { PulseDot, Waveform } from './Waveform';

interface Props {
  busy: boolean;
  initialText?: string;
  onSend: (out: Outgoing) => void;
  onStop: () => void;
}

const MAX_LINES = 7;

/** The primary button springs in whenever its role changes (mic, send, stop). */
function Pop({ children }: { children: ReactNode }) {
  const [v] = useState(() => new Animated.Value(0.6));
  useEffect(() => {
    let cancelled = false;
    let anim: Animated.CompositeAnimation | undefined;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      // The button may have been swapped out (typing, sending) before the check returned.
      if (cancelled) return;
      if (reduce) return v.setValue(1);
      anim = Animated.spring(v, { toValue: 1, speed: 28, bounciness: 7, useNativeDriver: true });
      anim.start();
    });
    return () => {
      cancelled = true;
      anim?.stop();
    };
  }, [v]);
  return <Animated.View style={{ opacity: v.interpolate({ inputRange: [0.6, 1], outputRange: [0.3, 1] }), transform: [{ scale: v }] }}>{children}</Animated.View>;
}

function clock(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Text, voice and photo in one box. Owns its state, so typing or a running
 * recording timer re-renders only this component, never the conversation.
 * The primary button is context-aware: mic when empty, send when there is
 * something to send, stop while an answer is pending.
 */
export const Composer = memo(function Composer({ busy, initialText = '', onSend, onStop }: Props) {
  const p = usePalette();
  const { t, rtl } = useI18n();
  const [text, setText] = useState(initialText);
  const [image, setImage] = useState<PickedImage | null>(null);
  const [menu, setMenu] = useState(false);
  const [photoError, setPhotoError] = useState(false);
  const urdu = text ? isUrduText(text) : rtl;
  const textStyle = scriptStyle(urdu ? 'ا' : 'a', type.body);
  const lineHeight = Number(textStyle.at(-1)?.lineHeight ?? type.body.lineHeight);
  const [height, setHeight] = useState<number>(lineHeight);
  const input = useRef<TextInput>(null);

  const voice = useVoice(
    useCallback((audio) => onSend({ text: text.trim(), audio, image: image ?? undefined }), [onSend, text, image]),
  );
  const recording = voice.state === 'recording' || voice.state === 'starting';
  const hasContent = text.trim().length > 0 || !!image;

  const reset = () => {
    setText('');
    setImage(null);
    setHeight(lineHeight);
  };

  const send = useCallback(() => {
    if (!hasContent || busy) return;
    tap();
    onSend({ text: text.trim(), image: image ?? undefined });
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasContent, busy, onSend, text, image]);

  const finishRecording = async () => {
    await voice.finish();
    reset();
  };

  const attach = async (source: 'library' | 'camera') => {
    setMenu(false);
    setPhotoError(false);
    const picked = await pickImage(source).catch((e: unknown) => {
      console.error('pickImage failed', e);
      setPhotoError(true);
      return null;
    });
    if (picked) setImage(picked);
  };

  const onKeyPress = useCallback(
    (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      const ne = e.nativeEvent as TextInputKeyPressEventData & { shiftKey?: boolean };
      if (Platform.OS === 'web' && ne.key === 'Enter' && !ne.shiftKey) {
        e.preventDefault();
        send();
      }
    },
    [send],
  );

  const primary = busy ? (
    <Pressable accessibilityRole="button" accessibilityLabel={t.stop} onPress={onStop} style={[styles.round, { backgroundColor: p.primary }]}>
      <View style={[styles.stopGlyph, { backgroundColor: p.onPrimary }]} />
    </Pressable>
  ) : recording ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t.sendRecording}
      onPress={finishRecording}
      disabled={voice.state === 'starting'}
      style={[styles.round, { backgroundColor: p.primary }]}
    >
      <Feather name="arrow-up" size={20} color={p.onPrimary} />
    </Pressable>
  ) : hasContent ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t.send}
      onPress={send}
      style={({ pressed }) => [styles.round, { backgroundColor: p.primary }, pressed && styles.pressed]}
    >
      <Feather name="arrow-up" size={20} color={p.onPrimary} />
    </Pressable>
  ) : (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t.record}
      onPress={voice.start}
      style={({ pressed }) => [styles.round, { backgroundColor: p.sunken }, pressed && styles.pressed]}
    >
      <Feather name="mic" size={19} color={p.text} />
    </Pressable>
  );
  const mode = busy ? 'stop' : recording ? 'recording' : hasContent ? 'send' : 'mic';

  return (
    <View style={[styles.box, card(p)]}>
      {image && (
        <View style={[row(rtl), styles.attachRow]}>
          <View>
            <Image source={{ uri: image.thumb ?? image.uri }} style={styles.thumb} resizeMode="cover" accessibilityLabel={t.photo} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.removeImage}
              onPress={() => setImage(null)}
              hitSlop={10}
              style={[styles.remove, { backgroundColor: p.primary }]}
            >
              <Feather name="x" size={12} color={p.onPrimary} />
            </Pressable>
          </View>
        </View>
      )}

      <View style={[row(rtl), styles.entryRow]}>
        {recording ? (
          <IconButton name="trash-2" label={t.cancelRecording} size={19} color={p.muted} onPress={voice.cancel} />
        ) : (
          <IconButton
            name={menu ? 'x' : 'plus'}
            label={t.attach}
            size={20}
            disabled={busy}
            // The web has no camera flow worth offering: go straight to the file picker.
            onPress={() => (Platform.OS === 'web' ? attach('library') : setMenu((m) => !m))}
          />
        )}
        {recording ? (
          <View style={[row(rtl), styles.recRow]} accessibilityLiveRegion="polite" accessibilityLabel={t.recording}>
            <PulseDot color={p.danger} />
            <Text style={[type.body, styles.clock, { color: p.text }]}>{clock(voice.durationMs)}</Text>
            <Waveform levels={voice.levels} color={p.text} rtl={rtl} />
          </View>
        ) : (
          <TextInput
            ref={input}
            autoFocus={!!initialText}
            value={text}
            onChangeText={setText}
            onKeyPress={onKeyPress}
            placeholder={t.placeholder}
            placeholderTextColor={p.muted}
            multiline
            numberOfLines={1}
            onContentSizeChange={(e) => setHeight(e.nativeEvent.contentSize.height)}
            accessibilityLabel="Message"
            style={[
              textStyle,
              styles.input,
              {
                color: p.text,
                height: text.length ? Math.min(lineHeight * MAX_LINES, Math.max(lineHeight, height)) : lineHeight,
                textAlign: urdu ? 'right' : 'left',
                writingDirection: urdu ? 'rtl' : 'ltr',
              },
            ]}
          />
        )}
        <Pop key={mode}>{primary}</Pop>
      </View>

      {photoError && (
        <Pressable onPress={() => setPhotoError(false)} accessibilityRole="alert">
          <Text style={[scriptStyle(t.photoFailed, type.meta), { color: p.danger }]}>{t.photoFailed}</Text>
        </Pressable>
      )}

      {voice.state === 'denied' && (
        <Pressable onPress={voice.dismissDenied} accessibilityRole="alert">
          <Text style={[scriptStyle(t.micDenied, type.meta), { color: p.danger }]}>{t.micDenied}</Text>
        </Pressable>
      )}

      {menu && (
        <View style={[row(rtl), styles.menu]}>
          <Pressable accessibilityRole="button" accessibilityLabel={t.choosePhoto} onPress={() => attach('library')} style={[styles.chip, { backgroundColor: p.sunken }]}>
            <Feather name="image" size={15} color={p.text} />
            <Text style={[scriptStyle(t.choosePhoto, type.meta), { color: p.text, ...(rtl ? { fontFamily: fonts.urdu } : weight.medium) }]}>{t.choosePhoto}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={t.takePhoto} onPress={() => attach('camera')} style={[styles.chip, { backgroundColor: p.sunken }]}>
            <Feather name="camera" size={15} color={p.text} />
            <Text style={[scriptStyle(t.takePhoto, type.meta), { color: p.text, ...(rtl ? { fontFamily: fonts.urdu } : weight.medium) }]}>{t.takePhoto}</Text>
          </Pressable>
        </View>
      )}

    </View>
  );
});

const styles = StyleSheet.create({
  box: {
    borderRadius: 28,
    paddingHorizontal: 8,
    paddingVertical: 7,
    gap: 8,
  },
  entryRow: { alignItems: 'flex-end', gap: 4 },
  input: { flex: 1, minWidth: 0, paddingTop: 0, paddingBottom: 0, paddingHorizontal: 6, marginBottom: 8, outlineStyle: 'none' } as never,
  attachRow: { paddingHorizontal: 4, paddingTop: 2 },
  thumb: { width: 56, height: 56, borderRadius: 10 },
  remove: { position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  recRow: { flex: 1, alignItems: 'center', gap: 10, paddingHorizontal: 4, minHeight: 42 },
  clock: { fontVariant: ['tabular-nums'], minWidth: 40 },
  menu: { gap: 8, paddingHorizontal: 4 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 6 },
  round: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.75, transform: [{ scale: 0.94 }] },
  stopGlyph: { width: 11, height: 11, borderRadius: 2 },
});
