import type { AskResponse, CallUsage, ChatStage, ChatTurn, ParamValues, QueryResult, ShownResult } from '../lib/api';

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
  /** `pending` until the answer is complete; text may already be streaming in. */
  status: 'pending' | 'done' | 'error' | 'stopped';
  text?: string;
  /** What the assistant is doing while no text has arrived yet. */
  progress?: { stage: ChatStage; label?: string };
  sql?: string | null;
  result?: QueryResult | null;
  /** Results to show under the text, each with how the assistant chose to show it (chat answers). */
  results?: ShownResult[];
  error?: string;
  /** The error is fixed in Settings (server address or API key). */
  fixInSettings?: boolean;
  meta?: { totalMs: number; costUsd?: number; cached: boolean };
  /** Everything the details sheet shows: time split, tokens, cache, context. */
  details?: AnswerDetails;
  language?: 'en' | 'ur' | 'ur-Latn';
  /** What was read from an attached photo. */
  imageNote?: string;
  /** Set when this answer is a report template run (Retry re-runs the report). */
  report?: ReportRef;
}

export interface ReportRef {
  id: string;
  params: ParamValues;
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
      report?: ReportRef;
    }
  | { type: 'retry'; chatId: string; assistantId: string }
  | { type: 'progress'; chatId: string; assistantId: string; stage: ChatStage; label?: string }
  | { type: 'delta'; chatId: string; assistantId: string; text: string }
  | { type: 'reset'; chatId: string; assistantId: string }
  | { type: 'answer'; chatId: string; assistantId: string; response: AskResponse }
  | { type: 'fail'; chatId: string; assistantId: string; error: string; stopped?: boolean; fixInSettings?: boolean };

/** The server returns at most 1000 rows by default; retain them for table paging. */
export const STORED_ROWS = 1000;
/** Enough of an earlier answer for follow-ups to resolve ("and last month?"). */
const CONTEXT_ANSWER_CHARS = 1500;
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
        // A request cannot survive an app restart. Untouched chats keep their identity (and are not re-saved).
        const pending = c.messages.some((m) => m.role === 'assistant' && m.status === 'pending');
        chats[c.id] = pending
          ? {
              ...c,
              messages: c.messages.map((m) =>
                m.role === 'assistant' && m.status === 'pending' ? { ...m, status: 'stopped', error: 'Interrupted.' } : m,
              ),
            }
          : c;
      }
      const order = [...action.chats].sort((a, b) => b.updatedAt - a.updatedAt).map((c) => c.id);
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
          { id: action.assistantId, role: 'assistant', question: action.question, status: 'pending', ...(action.report && { report: action.report }) },
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
          [chat.id]: updateMessage(chat, action.assistantId, (m) => ({ id: m.id, role: m.role, question: m.question, status: 'pending', report: m.report })),
        },
      };
    }
    case 'progress':
    case 'delta':
    case 'reset': {
      const chat = state.chats[action.chatId];
      if (!chat) return state;
      const patch = (m: AssistantMessage): AssistantMessage => {
        if (m.status !== 'pending') return m; // a late event after Stop
        if (action.type === 'progress') return { ...m, progress: { stage: action.stage, label: action.label } };
        if (action.type === 'delta') return { ...m, text: (m.text ?? '') + action.text };
        return { ...m, text: '' };
      };
      return { ...state, chats: { ...state.chats, [chat.id]: updateMessage(chat, action.assistantId, patch) } };
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
        progress: undefined,
        sql: r.sql,
        // Chat answers carry their rows in `results`; `result` (the first of them) would store the same rows twice.
        result: r.result && !r.results?.length ? { ...r.result, rows: r.result.rows.slice(0, STORED_ROWS) } : null,
        results: r.results?.map((x) => ({ ...x, result: { ...x.result, rows: x.result.rows.slice(0, STORED_ROWS) } })),
        error: undefined,
        fixInSettings: undefined,
        meta: { totalMs: r.timings.totalMs, costUsd: r.usage.costUsd, cached: r.cache !== null },
        details: detailsFrom(r),
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
            fixInSettings: action.fixInSettings || undefined,
          })),
        },
      };
    }
  }
}

/** Earlier answered turns, oldest first, for follow-up questions: the answer text and the SQL behind it. */
export function contextFor(chat: Chat | undefined, beforeId?: string, limit = 6): ChatTurn[] {
  if (!chat) return [];
  const turns: ChatTurn[] = [];
  for (const m of chat.messages) {
    if (m.id === beforeId) break;
    if (m.role !== 'assistant' || m.status !== 'done' || !m.question) continue;
    turns.push({
      question: m.question,
      ...(m.text ? { answer: m.text.slice(0, CONTEXT_ANSWER_CHARS) } : {}),
      ...(m.sql ? { sql: m.sql } : {}),
    });
  }
  return turns.slice(-limit);
}

export interface AnswerDetails {
  timings: AskResponse['timings'];
  cache: AskResponse['cache'];
  attempts: number;
  tokens: { prompt: number; cached: number; completion: number };
  costUsd?: number;
  costComplete?: boolean;
  calls: CallUsage[];
  schema?: AskResponse['schema'];
  context?: AskResponse['context'];
  speech?: AskResponse['speech'];
}

/** Compact, persisted copy of the response's diagnostics (no table names: they can be long). */
export function detailsFrom(r: AskResponse): AnswerDetails {
  const u = r.usage;
  return {
    timings: r.timings,
    cache: r.cache,
    attempts: r.attempts,
    tokens: { prompt: u.promptTokens ?? 0, cached: u.cachedPromptTokens ?? 0, completion: u.completionTokens ?? 0 },
    costUsd: u.costUsd,
    costComplete: u.costComplete,
    calls: u.calls ?? [],
    schema: r.schema ? { ...r.schema, tables: [] } : undefined,
    context: r.context,
    speech: r.speech,
  };
}

/** Totals for a conversation (the header's usage indicator). */
export function usageTotals(chat: Chat | undefined) {
  let prompt = 0;
  let cached = 0;
  let completion = 0;
  let costUsd = 0;
  let answers = 0;
  let totalMs = 0;
  let modelMs = 0;
  let dbMs = 0;
  for (const m of chat?.messages ?? []) {
    if (m.role !== 'assistant' || !m.details) continue;
    answers++;
    prompt += m.details.tokens.prompt;
    cached += m.details.tokens.cached;
    completion += m.details.tokens.completion;
    costUsd += m.details.costUsd ?? 0;
    totalMs += m.details.timings.totalMs;
    modelMs += m.details.timings.llmMs;
    dbMs += m.details.timings.dbMs;
  }
  return { prompt, cached, completion, tokens: prompt + completion, costUsd, answers, totalMs, modelMs, dbMs };
}
