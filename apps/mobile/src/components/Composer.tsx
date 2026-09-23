import Feather from '@expo/vector-icons/Feather';
import { memo, useCallback, useRef, useState } from 'react';
import { type NativeSyntheticEvent, Platform, Pressable, StyleSheet, TextInput, type TextInputKeyPressEventData, View } from 'react-native';
import { type, usePalette } from '../theme';

const LINE_HEIGHT = type.body.lineHeight;
const MAX_INPUT_HEIGHT = LINE_HEIGHT * 7;

interface Props {
  busy: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}

/**
 * Owns its text state, so typing re-renders only this component — never the
 * message list. On the web, Enter sends and Shift+Enter adds a line.
 */
export const Composer = memo(function Composer({ busy, onSend, onStop }: Props) {
  const p = usePalette();
  const [text, setText] = useState('');
  // Starts as one line and grows with the content, up to MAX_INPUT_HEIGHT.
  const [height, setHeight] = useState<number>(LINE_HEIGHT);
  const input = useRef<TextInput>(null);
  const canSend = text.trim().length > 0 && !busy;

  const send = useCallback(() => {
    if (!text.trim() || busy) return;
    onSend(text);
    setText('');
    setHeight(LINE_HEIGHT);
  }, [text, busy, onSend]);

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

  return (
    <View style={[styles.box, { backgroundColor: p.surface, borderColor: p.border }]}>
      <TextInput
        ref={input}
        value={text}
        onChangeText={setText}
        onKeyPress={onKeyPress}
        placeholder="Ask about your data"
        placeholderTextColor={p.faint}
        multiline
        numberOfLines={1}
        onContentSizeChange={(e) => setHeight(e.nativeEvent.contentSize.height)}
        accessibilityLabel="Message"
        style={[type.body, styles.input, { color: p.text, height: Math.min(MAX_INPUT_HEIGHT, Math.max(LINE_HEIGHT, height)) }]}
      />
      <View style={styles.bar}>
        {busy ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Stop"
            onPress={onStop}
            style={[styles.send, { backgroundColor: p.primary }]}
          >
            <View style={[styles.stopGlyph, { backgroundColor: p.onPrimary }]} />
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send"
            accessibilityState={{ disabled: !canSend }}
            disabled={!canSend}
            onPress={send}
            style={[styles.send, { backgroundColor: canSend ? p.primary : p.border }]}
          >
            <Feather name="arrow-up" size={18} color={canSend ? p.onPrimary : p.faint} />
          </Pressable>
        )}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  box: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 24,
    paddingLeft: 16,
    paddingRight: 8,
    paddingTop: 10,
    paddingBottom: 8,
    gap: 4,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  input: { paddingTop: 0, paddingBottom: 0, paddingRight: 8, outlineStyle: 'none' } as never,
  bar: { flexDirection: 'row', justifyContent: 'flex-end' },
  send: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  stopGlyph: { width: 11, height: 11, borderRadius: 2 },
});
