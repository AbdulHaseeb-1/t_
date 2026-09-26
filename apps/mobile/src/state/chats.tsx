import {
  createContext,
  type Dispatch,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { useI18n } from '../i18n';
import { ApiError, chat, chatMedia, type ChatHandlers, type MediaFile, type ParamValues, runTemplate } from '../lib/api';
import { describeError, needsSettings } from '../lib/errors';
import { markFresh } from '../lib/fresh';
import { newId } from '../lib/id';
import { type Chat, type ChatAction, chatReducer, type ChatState, contextFor, initialState, type ReportRef } from './chat-reducer';
import { ChatStore } from './chat-store';
import { useSettings } from './settings';

const SAVE_DEBOUNCE_MS = 400;

export interface Outgoing {
  text: string;
  audio?: MediaFile & { durationMs: number };
  image?: MediaFile & { thumb?: string };
}

interface ChatActions {
  send(input: Outgoing | string): void;
  /** Runs a report template as a chat turn: `label` is what the user bubble shows. */
  runReport(id: string, params: ParamValues, label: string): void;
  retry(assistantId: string): void;
  stop(): void;
  newChat(): void;
  select(id: string): void;
  remove(id: string): void;
}

const StateContext = createContext<ChatState | null>(null);
const ActionsContext = createContext<ChatActions | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(chatReducer, initialState);
  const { server, replyLanguage } = useSettings();
  const { t, lang } = useI18n();
  const tRef = useRef(t);
  const langRef = useRef(lang);
  /** Voice/photo payloads by assistant message, so Retry can resend them this session. */
  const media = useRef(new Map<string, Pick<Outgoing, 'audio' | 'image'>>());
  const inflight = useRef(new Map<string, { chatId: string; controller: AbortController }>());
  // Event handlers read the latest committed state and settings through refs, so the
  // actions object stays stable and never re-renders its consumers.
  const stateRef = useRef(state);
  const serverRef = useRef(server);
  const replyRef = useRef(replyLanguage);
  useLayoutEffect(() => {
    stateRef.current = state;
    serverRef.current = server;
    replyRef.current = replyLanguage;
    tRef.current = t;
    langRef.current = lang;
  }, [state, server, replyLanguage, t, lang]);

  const [store] = useState(() => new ChatStore());
  useEffect(() => {
    void store.load().then((chats) => dispatch({ type: 'hydrate', chats }));
  }, [store]);

  // Debounced persistence: typing and streaming never block on storage, and only changed chats are written.
  useEffect(() => {
    if (!state.hydrated) return;
    const t = setTimeout(() => void store.save(state.chats), SAVE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [store, state.chats, state.hydrated]);

  const run = useCallback((chatId: string, assistantId: string, question: string, dispatchFn: Dispatch<ChatAction>, report?: ReportRef, fresh = false) => {
    const controller = new AbortController();
    inflight.current.set(assistantId, { chatId, controller });
    const context = contextFor(stateRef.current.chats[chatId], assistantId);
    const files = media.current.get(assistantId);
    // Reports answer in the reply language, or the app's language when replies follow the question.
    const reportLang = replyRef.current === 'auto' ? langRef.current : replyRef.current;
    // Progress and answer text stream into the message as the assistant works.
    const on: ChatHandlers = {
      status: (stage, label) => dispatchFn({ type: 'progress', chatId, assistantId, stage, label }),
      delta: (text) => dispatchFn({ type: 'delta', chatId, assistantId, text }),
      reset: () => dispatchFn({ type: 'reset', chatId, assistantId }),
    };
    const request = report
      ? runTemplate(serverRef.current, report.id, report.params, reportLang, controller.signal)
      : files?.audio || files?.image
        ? chatMedia(
            serverRef.current,
            { question, context, audio: files.audio, image: files.image, language: replyRef.current, fresh },
            on,
            controller.signal,
          )
        : chat(serverRef.current, question, context, on, controller.signal, replyRef.current, fresh);
    request
      .then((response) => {
        dispatchFn({ type: 'answer', chatId, assistantId, response });
      })
      .catch((err: unknown) => {
        const stopped = err instanceof ApiError && err.kind === 'aborted';
        const message = describeError(err, tRef.current, serverRef.current.baseUrl);
        dispatchFn({ type: 'fail', chatId, assistantId, error: message, stopped, fixInSettings: needsSettings(err) });
      })
      .finally(() => inflight.current.delete(assistantId));
  }, []);

  const actions = useMemo<ChatActions>(
    () => ({
      send(input) {
        const out: Outgoing = typeof input === 'string' ? { text: input } : input;
        const q = out.text.trim();
        if (!q && !out.audio && !out.image) return;
        const chatId = stateRef.current.activeId ?? newId();
        const assistantId = newId();
        const userId = newId();
        markFresh(userId, assistantId);
        if (out.audio || out.image) media.current.set(assistantId, { audio: out.audio, image: out.image });
        // Follow-up context = turns that already exist, so read it before dispatching.
        run(chatId, assistantId, q, dispatch);
        dispatch({
          type: 'ask',
          chatId,
          userId,
          assistantId,
          question: q,
          now: Date.now(),
          media: {
            ...(out.audio && { audio: { durationMs: out.audio.durationMs } }),
            ...(out.image && { image: { thumb: out.image.thumb } }),
          },
        });
      },
      runReport(id, params, label) {
        const chatId = stateRef.current.activeId ?? newId();
        const assistantId = newId();
        const userId = newId();
        const report = { id, params };
        markFresh(userId, assistantId);
        run(chatId, assistantId, label, dispatch, report);
        dispatch({ type: 'ask', chatId, userId, assistantId, question: label, now: Date.now(), report });
      },
      retry(assistantId) {
        const chatId = stateRef.current.activeId;
        const msg = chatId ? stateRef.current.chats[chatId]?.messages.find((m) => m.id === assistantId) : undefined;
        if (!chatId || !msg || msg.role !== 'assistant' || inflight.current.has(assistantId)) return;
        // A voice or photo question lives only in memory until the server says what was asked.
        if (!msg.report && !msg.question.trim() && !media.current.has(assistantId)) {
          dispatch({ type: 'fail', chatId, assistantId, error: tRef.current.errMediaGone });
          return;
        }
        dispatch({ type: 'retry', chatId, assistantId });
        // Asking again means a new answer, not the one the server just cached.
        run(chatId, assistantId, msg.question, dispatch, msg.report, true);
      },
      stop() {
        const active = stateRef.current.activeId;
        for (const { chatId, controller } of inflight.current.values()) if (chatId === active) controller.abort();
      },
      newChat: () => dispatch({ type: 'new' }),
      select: (id) => dispatch({ type: 'select', id }),
      remove(id) {
        for (const [msgId, f] of inflight.current) {
          if (f.chatId === id) {
            f.controller.abort();
            inflight.current.delete(msgId);
          }
        }
        dispatch({ type: 'delete', id });
      },
    }),
    [run],
  );

  return (
    <ActionsContext.Provider value={actions}>
      <StateContext.Provider value={state}>{children}</StateContext.Provider>
    </ActionsContext.Provider>
  );
}

export function useChatState(): ChatState {
  const v = useContext(StateContext);
  if (!v) throw new Error('useChatState must be used inside ChatProvider');
  return v;
}

/** Stable across renders: components that only act never re-render on state changes. */
export function useChatActions(): ChatActions {
  const v = useContext(ActionsContext);
  if (!v) throw new Error('useChatActions must be used inside ChatProvider');
  return v;
}

export function useActiveChat(): Chat | undefined {
  const s = useChatState();
  return s.activeId ? s.chats[s.activeId] : undefined;
}
