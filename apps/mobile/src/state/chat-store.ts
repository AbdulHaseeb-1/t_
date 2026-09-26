import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AssistantMessage, Chat } from './chat-reducer';

/** One stored value per conversation, so one oversized or damaged chat cannot take the others with it. */
export const CHAT_PREFIX = 'chat.v2:';
/** The previous format: every conversation in one value. Moved to per-chat keys on first load. */
export const LEGACY_KEY = 'chats.v1';
/** Rows kept per result on disk. Tables page 25 at a time; the panel says when a full result must be asked again. */
export const PERSISTED_ROWS = 250;
/**
 * Android reads a stored value through a window of about 2 MB and fails on anything larger.
 * A chat is kept under this many characters (at most 3 bytes each) by saving fewer rows.
 */
export const MAX_CHAT_CHARS = 600_000;

export const chatKey = (id: string) => `${CHAT_PREFIX}${id}`;

function withRows(m: AssistantMessage, max: number): AssistantMessage {
  const trim = <T extends { rows: unknown[][] }>(r: T): T => (r.rows.length > max ? { ...r, rows: r.rows.slice(0, max) } : r);
  return {
    ...m,
    ...(m.result && { result: trim(m.result) }),
    ...(m.results && { results: m.results.map((x) => ({ ...x, result: trim(x.result) })) }),
  };
}

/** The chat as stored: results trimmed to fit the size budget (row counts are kept, so the UI can say what was dropped). */
export function serializeChat(chat: Chat): string {
  let text = '';
  for (const rows of [PERSISTED_ROWS, 50, 0]) {
    text = JSON.stringify({ ...chat, messages: chat.messages.map((m) => (m.role === 'assistant' ? withRows(m, rows) : m)) });
    if (text.length <= MAX_CHAT_CHARS) break;
  }
  return text;
}

function asChat(value: unknown): Chat | null {
  const chat = value as Chat | null;
  return chat && typeof chat.id === 'string' && Array.isArray(chat.messages) ? chat : null;
}

function parseChat(raw: string | null | undefined): Chat | null {
  if (!raw) return null;
  try {
    return asChat(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * Chat persistence that never destroys what it cannot read. A failed read leaves
 * the stored value alone instead of saving an empty history over it, and only
 * conversations that changed since the last save are written.
 */
export class ChatStore {
  /** The chat object last written (or read) per id: unchanged objects are not rewritten. */
  private readonly saved = new Map<string, Chat>();
  /** False when the stored keys could not even be listed: writing then could clobber history. */
  private writable = true;
  private queue: Promise<void> = Promise.resolve();

  async load(): Promise<Chat[]> {
    let keys: readonly string[];
    try {
      keys = await AsyncStorage.getAllKeys();
    } catch {
      this.writable = false;
      return [];
    }
    const chats = new Map<string, Chat>();
    for (const [, raw] of await readEach(keys.filter((k) => k.startsWith(CHAT_PREFIX)))) {
      const chat = parseChat(raw);
      if (!chat) continue;
      chats.set(chat.id, chat);
      this.saved.set(chat.id, chat);
    }
    if (keys.includes(LEGACY_KEY)) await this.migrate(chats);
    return [...chats.values()];
  }

  /** Writes the conversations that changed and removes deleted ones. Saves run one after another. */
  save(chats: Record<string, Chat>): Promise<void> {
    this.queue = this.queue.then(() => this.write(chats)).catch(() => undefined);
    return this.queue;
  }

  private async write(chats: Record<string, Chat>): Promise<void> {
    if (!this.writable) return;
    for (const chat of Object.values(chats)) {
      if (this.saved.get(chat.id) === chat) continue;
      try {
        await AsyncStorage.setItem(chatKey(chat.id), serializeChat(chat));
        this.saved.set(chat.id, chat);
      } catch {
        // Storage full or unavailable: the chat stays in memory and is retried on its next change.
      }
    }
    const removed = [...this.saved.keys()].filter((id) => !chats[id]);
    if (!removed.length) return;
    try {
      await AsyncStorage.multiRemove(removed.map(chatKey));
      for (const id of removed) this.saved.delete(id);
    } catch {
      // retried on the next save
    }
  }

  /** Moves conversations from the one-value format. The old value is removed only once every chat is stored. */
  private async migrate(into: Map<string, Chat>): Promise<void> {
    let raw: string | null;
    try {
      raw = await AsyncStorage.getItem(LEGACY_KEY);
    } catch {
      return; // unreadable (e.g. too large to load): left exactly as it is
    }
    let legacy: unknown;
    try {
      legacy = raw ? JSON.parse(raw) : [];
    } catch {
      return;
    }
    if (!Array.isArray(legacy)) return;
    const fresh = legacy.map(asChat).filter((c): c is Chat => !!c && !into.has(c.id));
    for (const chat of fresh) into.set(chat.id, chat);
    try {
      for (const chat of fresh) {
        await AsyncStorage.setItem(chatKey(chat.id), serializeChat(chat));
        this.saved.set(chat.id, chat);
      }
      await AsyncStorage.removeItem(LEGACY_KEY);
    } catch {
      // The old value stays until a later launch finishes the move; chats already moved are skipped then.
    }
  }
}

/**
 * Reads several keys. One batched read is fast, but a single oversized value
 * fails the whole batch; then each key is read alone, so only that one is lost.
 */
async function readEach(keys: string[]): Promise<[string, string | null][]> {
  if (!keys.length) return [];
  try {
    return (await AsyncStorage.multiGet(keys)) as [string, string | null][];
  } catch {
    const out: [string, string | null][] = [];
    for (const key of keys) {
      try {
        out.push([key, await AsyncStorage.getItem(key)]);
      } catch {
        // unreadable: skipped, and never written over (it is not in `saved`, so nothing removes it either)
      }
    }
    return out;
  }
}
