import Feather from '@expo/vector-icons/Feather';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  FlatList,
  type ListRenderItem,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Composer } from '../components/Composer';
import { Drawer } from '../components/Drawer';
import { Header } from '../components/Header';
import { MessageRow } from '../components/MessageRow';
import { PromptStarters } from '../components/PromptStarters';
import { ReportChips } from '../components/ReportParts';
import { RouteMark } from '../components/RouteMark';
import { useOpenReport } from '../components/useOpenReport';
import { scriptStyle, useI18n } from '../i18n';
import { UsageSheet } from '../components/Details';
import { type Message, usageTotals } from '../state/chat-reducer';
import { type Outgoing, useActiveChat, useChatActions, useChatState } from '../state/chats';
import { useReports } from '../state/reports';
import { useSettings } from '../state/settings';
import { card, layout, type, usePalette, weight } from '../theme';

const EMPTY: Message[] = [];
const keyExtractor = (m: Message) => m.id;
const renderItem: ListRenderItem<Message> = ({ item }) => <MessageRow message={item} />;
const Gap = () => <View style={styles.gap} />;
/** Scrolled this far from the latest message, a button offers the way back. */
const AWAY_PX = 280;

/** Round "jump to latest" button over the conversation; fades and lifts in. */
function JumpToLatest({ visible, onPress, label }: { visible: boolean; onPress: () => void; label: string }) {
  const p = usePalette();
  const [v] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const anim = Animated.timing(v, { toValue: visible ? 1 : 0, duration: 180, easing: Easing.out(Easing.quad), useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [visible, v]);
  return (
    <Animated.View
      pointerEvents={visible ? 'box-none' : 'none'}
      style={[styles.jump, { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] }]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        hitSlop={8}
        style={({ pressed }) => [styles.jumpButton, card(p, 'sm'), pressed && { backgroundColor: p.sunken }]}
      >
        <Feather name="arrow-down" size={18} color={p.text} />
      </Pressable>
    </Animated.View>
  );
}

export default function ChatScreen() {
  const p = usePalette();
  const { height: windowHeight } = useWindowDimensions();
  const { t } = useI18n();
  const state = useChatState();
  const actions = useChatActions();
  const chat = useActiveChat();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const [starter, setStarter] = useState<{ id: number; text: string }>();
  const [away, setAway] = useState(false);
  const awayRef = useRef(false);
  // Inverted list: offset 0 is the latest message.
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = e.nativeEvent.contentOffset.y > AWAY_PX;
    if (next !== awayRef.current) {
      awayRef.current = next;
      setAway(next);
    }
  }, []);
  const jumpToLatest = useCallback(() => list.current?.scrollToOffset({ offset: 0, animated: true }), []);
  const openUsage = useCallback(() => setUsageOpen(true), []);
  const list = useRef<FlatList<Message>>(null);
  const { server, ready } = useSettings();
  const needsServer = ready && !server.baseUrl;
  const { templates, unread } = useReports();
  const { openReport, sheet } = useOpenReport();
  const go = useCallback((path: '/reports' | '/schedules' | '/inbox') => {
    setDrawerOpen(false);
    router.push(path);
  }, []);
  const openReports = useCallback(() => go('/reports'), [go]);
  const openSchedules = useCallback(() => go('/schedules'), [go]);
  const openInbox = useCallback(() => go('/inbox'), [go]);

  const messages = chat?.messages ?? EMPTY;
  // Inverted list: newest at the bottom, keyboard-friendly, no scroll-to-end bookkeeping.
  const data = useMemo(() => [...messages].reverse(), [messages]);
  const busy = useMemo(() => messages.some((m) => m.role === 'assistant' && m.status === 'pending'), [messages]);
  const chats = useMemo(() => state.order.map((id) => state.chats[id]), [state.order, state.chats]);
  const totals = useMemo(() => usageTotals(chat), [chat]);

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
  const pickStarter = useCallback((text: string) => setStarter((current) => ({ id: (current?.id ?? 0) + 1, text })), []);

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: p.bg }]} edges={['top', 'bottom', 'left', 'right']}>
      {/* Android draws edge to edge, so the window no longer resizes for the keyboard: the composer is lifted here, frame by frame with the keyboard, on both platforms. */}
      <KeyboardAvoidingView style={styles.fill} behavior="padding" automaticOffset>
        <View style={styles.headerFrame}>
          <Header
            title={chat ? chat.title || t.voiceMessage : t.appNewChat}
            onMenu={openDrawer}
            onNewChat={newChat}
            canStartNew={!!chat}
            tokens={totals.tokens}
            onUsage={openUsage}
            unread={unread}
            onInbox={openInbox}
          />
        </View>
        <View style={styles.fill}>
          {messages.length === 0 ? (
            <ScrollView contentContainerStyle={[styles.empty, windowHeight < 700 && styles.emptyCompact]} keyboardShouldPersistTaps="handled">
              <RouteMark size={44} />
              {needsServer ? (
                <>
                  <Text style={[scriptStyle(t.setupTitle, styles.greeting), { color: p.text, textAlign: 'center' }]}>{t.setupTitle}</Text>
                  <Text style={[scriptStyle(t.setupBody, type.body), styles.emptyHint, { color: p.muted, textAlign: 'center' }]}>{t.setupBody}</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t.setupAction}
                    onPress={() => router.push('/settings/server')}
                    style={({ pressed }) => [styles.setup, { backgroundColor: p.primary }, pressed && styles.pressed]}
                  >
                    <Text style={[scriptStyle(t.setupAction, type.label), { color: p.onPrimary }]}>{t.setupAction}</Text>
                  </Pressable>
                </>
              ) : (
                <>
                  <Text style={[scriptStyle(t.greeting, styles.greeting), { color: p.text, textAlign: 'center' }]}>{t.greeting}</Text>
                  <Text style={[scriptStyle(t.greetingHint, type.body), styles.emptyHint, { color: p.muted, textAlign: 'center' }]}>{t.greetingHint}</Text>
                  {templates.some((template) => template.id === 'top-products' && template.builtIn) && <PromptStarters onPick={pickStarter} />}
                  <ReportChips templates={templates} onPick={openReport} onAll={openReports} />
                </>
              )}
            </ScrollView>
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
              onScroll={onScroll}
              scrollEventThrottle={64}
              initialNumToRender={10}
              maxToRenderPerBatch={8}
              windowSize={9}
              removeClippedSubviews={Platform.OS === 'android'}
              accessibilityLabel="Conversation"
            />
          )}
          {messages.length > 0 && <JumpToLatest visible={away} onPress={jumpToLatest} label={t.jumpToLatest} />}
        </View>
        <View style={[styles.composerDock, { backgroundColor: p.bg }]}>
          <View style={styles.composer}>
            <Composer key={starter?.id ?? 0} busy={busy} initialText={starter?.text} onSend={send} onStop={actions.stop} />
          </View>
        </View>
      </KeyboardAvoidingView>
      {usageOpen && <UsageSheet totals={totals} visible={usageOpen} onClose={() => setUsageOpen(false)} />}
      <Drawer
        open={drawerOpen}
        chats={chats}
        activeId={state.activeId}
        onClose={closeDrawer}
        onSelect={select}
        onNewChat={newChat}
        onDelete={actions.remove}
        onSettings={openSettings}
        onReports={openReports}
        onSchedules={openSchedules}
        onInbox={openInbox}
        unread={unread}
      />
      {sheet}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  headerFrame: { width: '100%', maxWidth: layout.pageWidth, alignSelf: 'center' },
  content: { paddingHorizontal: layout.gutter + 4, paddingVertical: 20, maxWidth: layout.pageWidth, width: '100%', alignSelf: 'center' },
  gap: { height: 24 },
  empty: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 32, gap: 10, maxWidth: layout.pageWidth, width: '100%', alignSelf: 'center' },
  emptyCompact: { paddingVertical: 14, gap: 8 },
  greeting: { ...type.display, ...weight.semibold, fontSize: 26, lineHeight: 34, textAlign: 'center', marginTop: 12, letterSpacing: -0.3 },
  emptyHint: { maxWidth: 460 },
  setup: { marginTop: 10, borderRadius: 22, paddingHorizontal: 20, height: 44, justifyContent: 'center' },
  pressed: { opacity: 0.85 },
  composerDock: {},
  composer: { paddingHorizontal: layout.gutter - 4, paddingTop: 6, paddingBottom: 10, maxWidth: layout.pageWidth, width: '100%', alignSelf: 'center' },
  jump: { position: 'absolute', bottom: 12, alignSelf: 'center' },
  jumpButton: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
});
