import Feather from '@expo/vector-icons/Feather';
import { memo, useCallback, useRef, useState } from 'react';
import {
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
import { type PickedImage, pickImage } from '../lib/media';
import { useVoice } from '../lib/useVoice';
import type { Outgoing } from '../state/chats';
import { fonts, type, usePalette } from '../theme';
import { IconButton } from './IconButton';

interface Props {
  busy: boolean;
  onSend: (out: Outgoing) => void;
  onStop: () => void;
}

const MAX_LINES = 7;

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
export const Composer = memo(function Composer({ busy, onSend, onStop }: Props) {
  const p = usePalette();
  const { t, rtl } = useI18n();
  const [text, setText] = useState('');
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
  const recording = voice.state === 'recording';
  const hasContent = text.trim().length > 0 || !!image;

  const reset = () => {
    setText('');
    setImage(null);
    setHeight(lineHeight);
  };

  const send = useCallback(() => {
    if (!hasContent || busy) return;
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
    <Pressable accessibilityRole="button" accessibilityLabel={t.sendRecording} onPress={finishRecording} style={[styles.round, { backgroundColor: p.primary }]}>
      <Feather name="arrow-up" size={18} color={p.onPrimary} />
    </Pressable>
  ) : hasContent ? (
    <Pressable accessibilityRole="button" accessibilityLabel={t.send} onPress={send} style={[styles.round, { backgroundColor: p.primary }]}>
      <Feather name="arrow-up" size={18} color={p.onPrimary} />
    </Pressable>
  ) : (
    <Pressable accessibilityRole="button" accessibilityLabel={t.record} onPress={voice.start} style={[styles.round, { backgroundColor: p.sunken }]}>
      <Feather name="mic" size={17} color={p.text} />
    </Pressable>
  );

  return (
    <View style={[styles.box, { backgroundColor: p.surface, borderColor: p.border }]}>
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

      {recording ? (
        <View style={[row(rtl), styles.recRow]} accessibilityLiveRegion="polite">
          <View style={[styles.recDot, { backgroundColor: p.danger }]} />
          <Text style={[type.body, { color: p.text, fontVariant: ['tabular-nums'] }]}>{clock(voice.durationMs)}</Text>
          <Text style={[scriptStyle(t.recording, type.meta), { color: p.muted }]}>{t.recording}</Text>
        </View>
      ) : (
        <TextInput
          ref={input}
          value={text}
          onChangeText={setText}
          onKeyPress={onKeyPress}
          placeholder={t.placeholder}
          placeholderTextColor={p.faint}
          multiline
          numberOfLines={1}
          onContentSizeChange={(e) => setHeight(e.nativeEvent.contentSize.height)}
          accessibilityLabel="Message"
          style={[
            textStyle,
            styles.input,
            {
              color: p.text,
              height: Math.min(lineHeight * MAX_LINES, Math.max(lineHeight, height)),
              textAlign: urdu ? 'right' : 'left',
              writingDirection: urdu ? 'rtl' : 'ltr',
            },
          ]}
        />
      )}

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
          <Pressable accessibilityRole="button" accessibilityLabel={t.choosePhoto} onPress={() => attach('library')} style={[styles.chip, { borderColor: p.border }]}>
            <Feather name="image" size={15} color={p.text} />
            <Text style={[scriptStyle(t.choosePhoto, type.meta), { color: p.text, fontFamily: rtl ? fonts.urdu : fonts.sansMedium }]}>{t.choosePhoto}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={t.takePhoto} onPress={() => attach('camera')} style={[styles.chip, { borderColor: p.border }]}>
            <Feather name="camera" size={15} color={p.text} />
            <Text style={[scriptStyle(t.takePhoto, type.meta), { color: p.text, fontFamily: rtl ? fonts.urdu : fonts.sansMedium }]}>{t.takePhoto}</Text>
          </Pressable>
        </View>
      )}

      <View style={[row(rtl), styles.bar]}>
        {recording ? (
          <IconButton name="x" label={t.cancelRecording} size={20} onPress={voice.cancel} />
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
        <View style={styles.spacer} />
        {primary}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  box: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 24,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 6,
    gap: 6,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  input: { paddingTop: 0, paddingBottom: 0, paddingHorizontal: 4, outlineStyle: 'none' } as never,
  attachRow: { paddingHorizontal: 4, paddingTop: 2 },
  thumb: { width: 56, height: 56, borderRadius: 10 },
  remove: { position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  recRow: { alignItems: 'center', gap: 10, paddingHorizontal: 4, minHeight: 28 },
  recDot: { width: 9, height: 9, borderRadius: 4.5 },
  menu: { gap: 8, paddingHorizontal: 4 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 6 },
  bar: { alignItems: 'center' },
  spacer: { flex: 1 },
  round: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  stopGlyph: { width: 11, height: 11, borderRadius: 2 },
});
