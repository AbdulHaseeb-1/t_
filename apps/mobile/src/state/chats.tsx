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
} from 'react';
import { useI18n } from '../i18n';
import { ApiError, ask, askMedia, type MediaFile } from '../lib/api';
import { describeError, needsSettings } from '../lib/errors';
import { cue } from '../lib/feedback';
import { newId } from '../lib/id';
import { storage } from '../lib/storage';
import { type Chat, type ChatAction, chatReducer, type ChatState, contextFor, initialState } from './chat-reducer';
import { useSettings } from './settings';

const STORAGE_KEY = 'chats.v1';
const SAVE_DEBOUNCE_MS = 400;

export interface Outgoing {
  text: string;
  audio?: MediaFile & { durationMs: number };
  image?: MediaFile & { thumb?: string };
}

interface ChatActions {
  send(input: Outgoing | string): void;
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
  const { t } = useI18n();
  const tRef = useRef(t);
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
  }, [state, server, replyLanguage, t]);

  useEffect(() => {
    void storage.get<Chat[]>(STORAGE_KEY).then((chats) => dispatch({ type: 'hydrate', chats: chats ?? [] }));
  }, []);

  // Debounced persistence: typing and streaming state changes never block on storage.
  useEffect(() => {
    if (!state.hydrated) return;
    const t = setTimeout(() => void storage.set(STORAGE_KEY, state.order.map((id) => state.chats[id])), SAVE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [state.chats, state.order, state.hydrated]);

  const run = useCallback((chatId: string, assistantId: string, question: string, dispatchFn: Dispatch<ChatAction>) => {
    const controller = new AbortController();
    inflight.current.set(assistantId, { chatId, controller });
    const context = contextFor(stateRef.current.chats[chatId], assistantId);
    const files = media.current.get(assistantId);
    const request =
      files?.audio || files?.image
        ? askMedia(
            serverRef.current,
            { question, context, audio: files.audio, image: files.image, language: replyRef.current },
            controller.signal,
          )
        : ask(serverRef.current, question, context, controller.signal, replyRef.current);
    request
      .then((response) => {
        cue('answer');
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
        if (out.audio || out.image) media.current.set(assistantId, { audio: out.audio, image: out.image });
        // Follow-up context = turns that already exist, so read it before dispatching.
        run(chatId, assistantId, q, dispatch);
        dispatch({
          type: 'ask',
          chatId,
          userId: newId(),
          assistantId,
          question: q,
          now: Date.now(),
          media: {
            ...(out.audio && { audio: { durationMs: out.audio.durationMs } }),
            ...(out.image && { image: { thumb: out.image.thumb } }),
          },
        });
      },
      retry(assistantId) {
        const chatId = stateRef.current.activeId;
        const msg = chatId ? stateRef.current.chats[chatId]?.messages.find((m) => m.id === assistantId) : undefined;
        if (!chatId || !msg || msg.role !== 'assistant' || inflight.current.has(assistantId)) return;
        dispatch({ type: 'retry', chatId, assistantId });
        run(chatId, assistantId, msg.question, dispatch);
      },
      stop() {
        for (const { controller } of inflight.current.values()) controller.abort();
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
