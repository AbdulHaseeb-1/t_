import type { AskResponse, QueryResult, Turn } from '../lib/api';

export interface UserMessage {
  id: string;
  role: 'user';
  /** Typed text, or the transcript once a voice message has been heard. */
  text: string;
  audio?: { durationMs: number };
  /** Small JPEG data URI: persists across restarts without storing the full photo. */
  image?: { thumb?: string };
}

export interface AssistantMessage {
  id: string;
  role: 'assistant';
  /** The question this message answers (used for retry and follow-up context). */
  question: string;
  status: 'pending' | 'done' | 'error' | 'stopped';
  text?: string;
  sql?: string | null;
  result?: QueryResult | null;
  error?: string;
  meta?: { totalMs: number; costUsd?: number; cached: boolean };
  language?: 'en' | 'ur' | 'ur-Latn';
  /** What was read from an attached photo. */
  imageNote?: string;
}

export type Message = UserMessage | AssistantMessage;

export interface Chat {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
}

export interface ChatState {
  hydrated: boolean;
  chats: Record<string, Chat>;
  /** Most recently updated first. */
  order: string[];
  /** null = a new, not-yet-saved conversation. */
  activeId: string | null;
}

export type ChatAction =
  | { type: 'hydrate'; chats: Chat[] }
  | { type: 'new' }
  | { type: 'select'; id: string }
  | { type: 'delete'; id: string }
  | {
      type: 'ask';
      chatId: string;
      userId: string;
      assistantId: string;
      question: string;
      now: number;
      media?: Pick<UserMessage, 'audio' | 'image'>;
    }
  | { type: 'retry'; chatId: string; assistantId: string }
  | { type: 'answer'; chatId: string; assistantId: string; response: AskResponse }
  | { type: 'fail'; chatId: string; assistantId: string; error: string; stopped?: boolean };

/** Stored results keep enough rows to render the preview; the full result is always re-askable. */
export const STORED_ROWS = 100;
const TITLE_CHARS = 60;

export const initialState: ChatState = { hydrated: false, chats: {}, order: [], activeId: null };

/** Empty for voice/photo-only questions until the server says what was asked. */
function titleFrom(question: string): string {
  const t = question.replace(/\s+/g, ' ').trim();
  return t.length > TITLE_CHARS ? `${t.slice(0, TITLE_CHARS - 1)}…` : t;
}

function touch(state: ChatState, chat: Chat): ChatState {
  return {
    ...state,
    chats: { ...state.chats, [chat.id]: chat },
    order: [chat.id, ...state.order.filter((id) => id !== chat.id)],
  };
}

/** Replaces one message by id; every other message keeps its identity (cheap memoized re-renders). */
function updateMessage(chat: Chat, id: string, patch: (m: AssistantMessage) => AssistantMessage): Chat {
  return {
    ...chat,
    messages: chat.messages.map((m) => (m.id === id && m.role === 'assistant' ? patch(m) : m)),
  };
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'hydrate': {
      const chats: Record<string, Chat> = {};
      for (const c of action.chats) {
        // A request cannot survive an app restart.
        chats[c.id] = {
          ...c,
          messages: c.messages.map((m) =>
            m.role === 'assistant' && m.status === 'pending' ? { ...m, status: 'stopped', error: 'Interrupted.' } : m,
          ),
        };
      }
      const order = action.chats.sort((a, b) => b.updatedAt - a.updatedAt).map((c) => c.id);
      return { ...state, hydrated: true, chats, order };
    }
    case 'new':
      return { ...state, activeId: null };
    case 'select':
      return state.chats[action.id] ? { ...state, activeId: action.id } : state;
    case 'delete': {
      const { [action.id]: _removed, ...chats } = state.chats;
      return {
        ...state,
        chats,
        order: state.order.filter((id) => id !== action.id),
        activeId: state.activeId === action.id ? null : state.activeId,
      };
    }
    case 'ask': {
      const existing = state.chats[action.chatId];
      const chat: Chat = existing ?? {
        id: action.chatId,
        title: titleFrom(action.question),
        createdAt: action.now,
        updatedAt: action.now,
        messages: [],
      };
      const next: Chat = {
        ...chat,
        updatedAt: action.now,
        messages: [
          ...chat.messages,
          { id: action.userId, role: 'user', text: action.question, ...action.media },
          { id: action.assistantId, role: 'assistant', question: action.question, status: 'pending' },
        ],
      };
      return { ...touch(state, next), activeId: action.chatId };
    }
    case 'retry': {
      const chat = state.chats[action.chatId];
      if (!chat) return state;
      return {
        ...state,
        chats: {
          ...state.chats,
          [chat.id]: updateMessage(chat, action.assistantId, (m) => ({ id: m.id, role: m.role, question: m.question, status: 'pending' })),
        },
      };
    }
    case 'answer': {
      const chat = state.chats[action.chatId];
      if (!chat) return state;
      const r = action.response;
      // What the question really was: typed text, what was heard, or what was read from a photo.
      const heard = r.transcript?.trim();
      const idx = chat.messages.findIndex((m) => m.id === action.assistantId);
      const asked = chat.messages[idx - 1];
      let next = updateMessage(chat, action.assistantId, (m) => ({
        ...m,
        question: heard || m.question || r.image?.display || r.image?.question || '',
        status: 'done',
        text: r.answer ?? '',
        sql: r.sql,
        result: r.result ? { ...r.result, rows: r.result.rows.slice(0, STORED_ROWS) } : null,
        error: undefined,
        meta: { totalMs: r.timings.totalMs, costUsd: r.usage.costUsd, cached: r.cache !== null },
        language: r.language,
        imageNote: r.image?.extracted || undefined,
      }));
      if (heard && asked?.role === 'user' && !asked.text) {
        next = { ...next, messages: next.messages.map((m) => (m === asked ? { ...asked, text: heard } : m)) };
      }
      if (!next.title) next = { ...next, title: titleFrom(heard || r.image?.display || r.image?.question || '') };
      return { ...state, chats: { ...state.chats, [chat.id]: next } };
    }
    case 'fail': {
      const chat = state.chats[action.chatId];
      if (!chat) return state;
      return {
        ...state,
        chats: {
          ...state.chats,
          [chat.id]: updateMessage(chat, action.assistantId, (m) => ({
            ...m,
            status: action.stopped ? 'stopped' : 'error',
            error: action.error,
          })),
        },
      };
    }
  }
}

/** Earlier answered turns, oldest first, for follow-up questions. */
export function contextFor(chat: Chat | undefined, beforeId?: string, limit = 4): Turn[] {
  if (!chat) return [];
  const turns: Turn[] = [];
  for (const m of chat.messages) {
    if (m.id === beforeId) break;
    if (m.role === 'assistant' && m.status === 'done' && m.sql) turns.push({ question: m.question, sql: m.sql });
  }
  return turns.slice(-limit);
}
