import Feather from '@expo/vector-icons/Feather';
import * as Clipboard from 'expo-clipboard';
import { memo, useCallback, useMemo, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { row, scriptStyle, useI18n } from '../i18n';
import { inferChart } from '../lib/chart';
import type { AssistantMessage, Message, UserMessage } from '../state/chat-reducer';
import { useChatActions } from '../state/chats';
import { type, usePalette } from '../theme';
import { Chart } from './Chart';
import { DataPanel } from './DataPanel';
import { IconButton } from './IconButton';
import { Markdown } from './Markdown';
import { Thinking } from './Thinking';

function clock(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function UserBubble({ m }: { m: UserMessage }) {
  const p = usePalette();
  const { t, rtl } = useI18n();
  return (
    // The user's side is the reading "end": right in English, left in Urdu.
    <View style={[styles.userRow, rtl ? styles.userRowRtl : null]}>
      {m.image && (
        <View style={[styles.photo, { backgroundColor: p.sunken }]}>
          {m.image.thumb ? (
            <Image source={{ uri: m.image.thumb }} style={styles.photoImg} resizeMode="cover" accessibilityLabel={t.photo} />
          ) : (
            <Feather name="image" size={22} color={p.muted} />
          )}
        </View>
      )}
      {(m.text || m.audio) && (
        <View style={[styles.bubble, { backgroundColor: p.userBubble }]}>
          {m.audio && (
            <View style={[styles.voice, row(rtl)]} accessibilityLabel={`${t.voiceMessage} ${clock(m.audio.durationMs)}`}>
              <Feather name="mic" size={14} color={p.muted} />
              <Text style={[type.meta, { color: p.muted, fontVariant: ['tabular-nums'] }]}>{clock(m.audio.durationMs)}</Text>
            </View>
          )}
          {!!m.text && (
            <Text style={[scriptStyle(m.text, type.body), { color: p.text }]} selectable>
              {m.text}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

function Assistant({ m }: { m: AssistantMessage }) {
  const p = usePalette();
  const { t, rtl } = useI18n();
  const { retry } = useChatActions();
  const [copied, setCopied] = useState(false);
  const chart = useMemo(() => (m.status === 'done' ? inferChart(m.result) : null), [m.status, m.result]);

  const copy = useCallback(async () => {
    await Clipboard.setStringAsync(m.text ?? '');
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [m.text]);

  if (m.status === 'pending') return <Thinking />;

  if (m.status === 'error' || m.status === 'stopped') {
    const message = m.status === 'stopped' && m.error === 'Stopped.' ? t.stopped : m.status === 'stopped' && m.error === 'Interrupted.' ? t.interrupted : (m.error ?? '');
    return (
      <View style={styles.assistant}>
        <View style={[styles.notice, m.status === 'error' && { backgroundColor: p.dangerSoft }]}>
          <Text style={[scriptStyle(message, type.body), { color: m.status === 'error' ? p.danger : p.muted }]}>{message}</Text>
        </View>
        <View style={[styles.actions, row(rtl)]}>
          <IconButton name="rotate-ccw" label={t.retry} size={16} color={p.muted} onPress={() => retry(m.id)} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.assistant}>
      {!!m.text && <Markdown text={m.text} />}
      {chart && <Chart spec={chart} />}
      {!!m.imageNote && (
        <Text style={[scriptStyle(m.imageNote, type.meta), { color: p.muted }]}>
          {`${t.readFromImage}: ${m.imageNote}`}
        </Text>
      )}
      {m.sql && m.result && <DataPanel sql={m.sql} result={m.result} totalMs={m.meta?.totalMs} />}
      <View style={[styles.actions, row(rtl)]}>
        <IconButton name={copied ? 'check' : 'copy'} label={copied ? t.copied : t.copy} size={16} color={p.muted} onPress={copy} />
        <IconButton name="rotate-ccw" label={t.askAgain} size={16} color={p.muted} onPress={() => retry(m.id)} />
      </View>
    </View>
  );
}

/** Memoized on the message object: the reducer only replaces messages that changed. */
export const MessageRow = memo(function MessageRow({ message }: { message: Message }) {
  return message.role === 'user' ? <UserBubble m={message} /> : <Assistant m={message} />;
});

const styles = StyleSheet.create({
  userRow: { alignItems: 'flex-end', paddingLeft: 48, gap: 6 },
  userRowRtl: { alignItems: 'flex-start', paddingLeft: 0, paddingRight: 48 },
  bubble: { borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10, maxWidth: '100%', gap: 4 },
  voice: { alignItems: 'center', gap: 6 },
  photo: { width: 120, height: 120, borderRadius: 14, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  photoImg: { width: '100%', height: '100%' },
  assistant: { gap: 12 },
  notice: { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  actions: { marginHorizontal: -10, marginTop: -6 },
});
