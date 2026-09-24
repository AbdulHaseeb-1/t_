import { router } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, type ListRenderItem, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Composer } from '../components/Composer';
import { Drawer } from '../components/Drawer';
import { Header } from '../components/Header';
import { MessageRow } from '../components/MessageRow';
import { scriptStyle, useI18n } from '../i18n';
import type { Message } from '../state/chat-reducer';
import { type Outgoing, useActiveChat, useChatActions, useChatState } from '../state/chats';
import { fonts, type, usePalette } from '../theme';

const EMPTY: Message[] = [];
const keyExtractor = (m: Message) => m.id;
const renderItem: ListRenderItem<Message> = ({ item }) => <MessageRow message={item} />;
const Gap = () => <View style={styles.gap} />;

export default function ChatScreen() {
  const p = usePalette();
  const { t } = useI18n();
  const state = useChatState();
  const actions = useChatActions();
  const chat = useActiveChat();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const list = useRef<FlatList<Message>>(null);

  const messages = chat?.messages ?? EMPTY;
  // Inverted list: newest at the bottom, keyboard-friendly, no scroll-to-end bookkeeping.
  const data = useMemo(() => [...messages].reverse(), [messages]);
  const busy = useMemo(() => messages.some((m) => m.role === 'assistant' && m.status === 'pending'), [messages]);
  const chats = useMemo(() => state.order.map((id) => state.chats[id]), [state.order, state.chats]);

  const send = useCallback(
    (out: Outgoing) => {
      actions.send(out);
      list.current?.scrollToOffset({ offset: 0, animated: true });
    },
    [actions],
  );
  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const newChat = useCallback(() => {
    actions.newChat();
    setDrawerOpen(false);
  }, [actions]);
  const select = useCallback(
    (id: string) => {
      actions.select(id);
      setDrawerOpen(false);
    },
    [actions],
  );
  const openSettings = useCallback(() => {
    setDrawerOpen(false);
    router.push('/settings');
  }, []);

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: p.bg }]} edges={['top', 'bottom', 'left', 'right']}>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Header title={chat ? chat.title || t.voiceMessage : t.appNewChat} onMenu={openDrawer} onNewChat={newChat} canStartNew={!!chat} />
        <View style={styles.fill}>
          {messages.length === 0 ? (
            <View style={styles.empty}>
              <Text style={[scriptStyle(t.greeting, styles.greeting), { color: p.text, textAlign: 'center' }]}>{t.greeting}</Text>
              <Text style={[scriptStyle(t.greetingHint, type.meta), { color: p.muted, textAlign: 'center' }]}>{t.greetingHint}</Text>
            </View>
          ) : (
            <FlatList
              ref={list}
              inverted
              data={data}
              keyExtractor={keyExtractor}
              renderItem={renderItem}
              ItemSeparatorComponent={Gap}
              contentContainerStyle={styles.content}
              keyboardDismissMode="interactive"
              keyboardShouldPersistTaps="handled"
              initialNumToRender={10}
              maxToRenderPerBatch={8}
              windowSize={9}
              removeClippedSubviews={Platform.OS === 'android'}
              accessibilityLabel="Conversation"
            />
          )}
        </View>
        <View style={styles.composer}>
          <Composer busy={busy} onSend={send} onStop={actions.stop} />
        </View>
      </KeyboardAvoidingView>
      <Drawer
        open={drawerOpen}
        chats={chats}
        activeId={state.activeId}
        onClose={closeDrawer}
        onSelect={select}
        onNewChat={newChat}
        onDelete={actions.remove}
        onSettings={openSettings}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { paddingHorizontal: 20, paddingVertical: 16, maxWidth: 760, width: '100%', alignSelf: 'center' },
  gap: { height: 22 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 10 },
  greeting: { fontFamily: fonts.serif, fontSize: 28, lineHeight: 36, textAlign: 'center' },
  composer: { paddingHorizontal: 12, paddingTop: 4, paddingBottom: 8, maxWidth: 784, width: '100%', alignSelf: 'center' },
});
