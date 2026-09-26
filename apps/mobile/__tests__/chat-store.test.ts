import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Chat } from '../src/state/chat-reducer';

// A plain in-memory store whose methods each test can make fail, restored after every test.
jest.mock('@react-native-async-storage/async-storage', () => {
  const data = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      data,
      getItem: async (k: string) => data.get(k) ?? null,
      setItem: async (k: string, v: string) => void data.set(k, v),
      removeItem: async (k: string) => void data.delete(k),
      getAllKeys: async () => [...data.keys()],
      multiGet: async (keys: string[]) => keys.map((k) => [k, data.get(k) ?? null]),
      multiRemove: async (keys: string[]) => keys.forEach((k) => data.delete(k)),
      clear: async () => data.clear(),
    },
  };
});

type Api = Record<'getItem' | 'setItem' | 'getAllKeys' | 'multiGet', (...args: never[]) => Promise<unknown>>;
const api = AsyncStorage as unknown as Api;
const original = { ...api };
/** Makes one storage method fail for the keys `when` picks (all by default). */
function failing(method: keyof Api, when: (key?: string) => boolean = () => true) {
  const real = original[method] as (...args: unknown[]) => Promise<unknown>;
  (api as Record<string, unknown>)[method] = (...args: unknown[]) =>
    when(typeof args[0] === 'string' ? args[0] : undefined) ? Promise.reject(new Error('Row too big to fit into CursorWindow')) : real(...args);
}
function counting(method: keyof Api): string[] {
  const keys: string[] = [];
  const real = original[method] as (...args: unknown[]) => Promise<unknown>;
  (api as Record<string, unknown>)[method] = (...args: unknown[]) => {
    keys.push(String(args[0]));
    return real(...args);
  };
  return keys;
}
import { CHAT_PREFIX, ChatStore, chatKey, LEGACY_KEY, MAX_CHAT_CHARS, PERSISTED_ROWS, serializeChat } from '../src/state/chat-store';

const chat = (id: string, rows = 3, updatedAt = 1): Chat => ({
  id,
  title: `Chat ${id}`,
  createdAt: 1,
  updatedAt,
  messages: [
    { id: `${id}-u`, role: 'user', text: 'List orders' },
    {
      id: `${id}-a`,
      role: 'assistant',
      question: 'List orders',
      status: 'done',
      text: 'Here they are.',
      results: [
        {
          id: 'r1',
          title: 'Orders',
          sql: 'SELECT 1',
          display: { view: 'table' },
          result: { columns: [{ name: 'n', type: 'int' }], rows: Array.from({ length: rows }, (_, i) => [i, 'x'.repeat(40)]), rowCount: rows, truncated: false, elapsedMs: 1 },
        },
      ],
    },
  ],
});

const byId = (chats: Chat[]) => Object.fromEntries(chats.map((c) => [c.id, c]));

afterEach(async () => {
  Object.assign(api, original);
  await AsyncStorage.clear();
});

describe('ChatStore', () => {
  it('stores one value per chat and reads them back', async () => {
    const a = chat('a');
    const b = chat('b');
    await new ChatStore().save(byId([a, b]));
    expect((await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(CHAT_PREFIX)).sort()).toEqual([chatKey('a'), chatKey('b')]);
    const loaded = await new ChatStore().load();
    expect(loaded.map((c) => c.id).sort()).toEqual(['a', 'b']);
    expect(loaded.find((c) => c.id === 'a')).toEqual(a);
  });

  it('rewrites only the chats that changed, and removes deleted ones', async () => {
    const store = new ChatStore();
    const a = chat('a');
    const b = chat('b');
    await store.save(byId([a, b]));
    const written = counting('setItem');
    const a2 = { ...a, title: 'Renamed' };
    await store.save(byId([a2, b]));
    expect(written).toEqual([chatKey('a')]);
    await store.save(byId([a2]));
    expect(await AsyncStorage.getItem(chatKey('b'))).toBeNull();
  });

  it('never saves over history it could not read', async () => {
    await new ChatStore().save(byId([chat('a')]));
    failing('getAllKeys');
    const store = new ChatStore();
    expect(await store.load()).toEqual([]);
    Object.assign(api, original);
    await store.save({}); // what the app would save after starting empty
    await store.save(byId([chat('new')]));
    expect(await AsyncStorage.getItem(chatKey('a'))).not.toBeNull();
    expect(await AsyncStorage.getItem(chatKey('new'))).toBeNull();
  });

  it('loses only the chat that cannot be read (e.g. a value too large for the Android read window)', async () => {
    await new ChatStore().save(byId([chat('a'), chat('b')]));
    failing('multiGet');
    failing('getItem', (key) => key === chatKey('a'));
    const store = new ChatStore();
    const loaded = await store.load();
    expect(loaded.map((c) => c.id)).toEqual(['b']);
    Object.assign(api, original);
    await store.save(byId(loaded));
    expect(await AsyncStorage.getItem(chatKey('a'))).not.toBeNull(); // kept for a later recovery, not deleted
  });

  it('moves the old one-value history to per-chat keys, then removes it', async () => {
    await AsyncStorage.setItem(LEGACY_KEY, JSON.stringify([chat('a', 3, 2), chat('b', 3, 1)]));
    const loaded = await new ChatStore().load();
    expect(loaded.map((c) => c.id).sort()).toEqual(['a', 'b']);
    expect(await AsyncStorage.getItem(LEGACY_KEY)).toBeNull();
    expect(await AsyncStorage.getItem(chatKey('b'))).not.toBeNull();
  });

  it('leaves an unreadable old history in place', async () => {
    await AsyncStorage.setItem(LEGACY_KEY, JSON.stringify([chat('a')]));
    failing('getItem', (key) => key === LEGACY_KEY);
    const store = new ChatStore();
    expect(await store.load()).toEqual([]);
    Object.assign(api, original);
    await store.save(byId([chat('new')]));
    expect(await AsyncStorage.getItem(LEGACY_KEY)).not.toBeNull();
    expect(await AsyncStorage.getItem(chatKey('new'))).not.toBeNull();
  });
});

describe('serializeChat', () => {
  it(`keeps at most ${PERSISTED_ROWS} rows per result, with the true row count`, () => {
    const stored = JSON.parse(serializeChat(chat('a', 1000))) as Chat;
    const result = (stored.messages[1] as Extract<Chat['messages'][number], { role: 'assistant' }>).results![0].result;
    expect(result.rows).toHaveLength(PERSISTED_ROWS);
    expect(result.rowCount).toBe(1000);
  });

  it('drops rows until a chat fits the size budget', () => {
    const big: Chat = { ...chat('a'), messages: Array.from({ length: 80 }, (_, i) => chat(`m${i}`, 1000).messages).flat() };
    const text = serializeChat(big);
    expect(text.length).toBeLessThanOrEqual(MAX_CHAT_CHARS);
    expect((JSON.parse(text) as Chat).messages).toHaveLength(160);
  });
});
