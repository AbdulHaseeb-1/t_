import * as Clipboard from 'expo-clipboard';
import { memo, useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { AssistantMessage, Message } from '../state/chat-reducer';
import { useChatActions } from '../state/chats';
import { type, usePalette } from '../theme';
import { DataPanel } from './DataPanel';
import { IconButton } from './IconButton';
import { Markdown } from './Markdown';
import { Thinking } from './Thinking';

function UserBubble({ text }: { text: string }) {
  const p = usePalette();
  return (
    <View style={styles.userRow}>
      <View style={[styles.bubble, { backgroundColor: p.userBubble }]}>
        <Text style={[type.body, { color: p.text }]} selectable>
          {text}
        </Text>
      </View>
    </View>
  );
}

function Assistant({ m }: { m: AssistantMessage }) {
  const p = usePalette();
  const { retry } = useChatActions();
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    await Clipboard.setStringAsync(m.text ?? '');
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [m.text]);

  if (m.status === 'pending') return <Thinking />;

  if (m.status === 'error' || m.status === 'stopped') {
    return (
      <View style={styles.assistant}>
        <View style={[styles.notice, m.status === 'error' && { backgroundColor: p.dangerSoft }]}>
          <Text style={[type.body, { color: m.status === 'error' ? p.danger : p.muted }]}>{m.error}</Text>
        </View>
        <View style={styles.actions}>
          <IconButton name="rotate-ccw" label="Retry" size={16} color={p.muted} onPress={() => retry(m.id)} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.assistant}>
      {!!m.text && <Markdown text={m.text} />}
      {m.sql && m.result && <DataPanel sql={m.sql} result={m.result} totalMs={m.meta?.totalMs} />}
      <View style={styles.actions}>
        <IconButton name={copied ? 'check' : 'copy'} label={copied ? 'Copied' : 'Copy answer'} size={16} color={p.muted} onPress={copy} />
        <IconButton name="rotate-ccw" label="Ask again" size={16} color={p.muted} onPress={() => retry(m.id)} />
      </View>
    </View>
  );
}

/** Memoized on the message object: the reducer only replaces messages that changed. */
export const MessageRow = memo(function MessageRow({ message }: { message: Message }) {
  return message.role === 'user' ? <UserBubble text={message.text} /> : <Assistant m={message} />;
});

const styles = StyleSheet.create({
  userRow: { alignItems: 'flex-end', paddingLeft: 48 },
  bubble: { borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10, maxWidth: '100%' },
  assistant: { gap: 12 },
  notice: { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  actions: { flexDirection: 'row', marginLeft: -10, marginTop: -6 },
});
