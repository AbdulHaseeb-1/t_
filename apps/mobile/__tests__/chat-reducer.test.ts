import type { AskResponse } from '../src/lib/api';
import { type Chat, chatReducer, type ChatState, contextFor, initialState, STORED_ROWS } from '../src/state/chat-reducer';

const response = (sql: string, rows = 1): AskResponse => ({
  question: 'q',
  sql,
  answer: 'The answer',
  result: { columns: [{ name: 'n', type: 'int' }], rows: Array.from({ length: rows }, (_, i) => [i]), rowCount: rows, truncated: false, elapsedMs: 3 },
  cache: null,
  attempts: 1,
  timings: { totalMs: 1200, llmMs: 1100, dbMs: 100 },
  usage: { llmCalls: 2, costUsd: 0.0001 },
});

function askOnce(state: ChatState, chatId: string, n: number, question = `question ${n}`): ChatState {
  return chatReducer(state, { type: 'ask', chatId, userId: `u${n}`, assistantId: `a${n}`, question, now: n });
}

describe('chatReducer', () => {
  const hydrated = chatReducer(initialState, { type: 'hydrate', chats: [] });

  it('creates a chat on the first question and titles it', () => {
    const s = askOnce(hydrated, 'c1', 1, 'What was revenue by country for the whole of 2025 compared with the year before that?');
    expect(s.activeId).toBe('c1');
    expect(s.chats.c1.title.length).toBeLessThanOrEqual(60);
    expect(s.chats.c1.title.endsWith('…')).toBe(true);
    expect(s.chats.c1.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('keeps unchanged messages identical so memoized rows skip rendering', () => {
    let s = askOnce(hydrated, 'c1', 1);
    s = chatReducer(s, { type: 'answer', chatId: 'c1', assistantId: 'a1', response: response('SELECT 1') });
    s = askOnce(s, 'c1', 2);
    const before = s.chats.c1.messages;
    s = chatReducer(s, { type: 'answer', chatId: 'c1', assistantId: 'a2', response: response('SELECT 2') });
    const after = s.chats.c1.messages;
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    expect(after[3]).not.toBe(before[3]);
  });

  it('caps stored rows', () => {
    let s = askOnce(hydrated, 'c1', 1);
    s = chatReducer(s, { type: 'answer', chatId: 'c1', assistantId: 'a1', response: response('SELECT 1', 500) });
    const m = s.chats.c1.messages[1];
    expect(m.role === 'assistant' && m.result?.rows.length).toBe(STORED_ROWS);
    expect(m.role === 'assistant' && m.result?.rowCount).toBe(500);
  });

  it('handles failure, stop and retry', () => {
    let s = askOnce(hydrated, 'c1', 1);
    s = chatReducer(s, { type: 'fail', chatId: 'c1', assistantId: 'a1', error: 'boom' });
    expect(s.chats.c1.messages[1]).toMatchObject({ status: 'error', error: 'boom' });
    s = chatReducer(s, { type: 'retry', chatId: 'c1', assistantId: 'a1' });
    expect(s.chats.c1.messages[1]).toEqual({ id: 'a1', role: 'assistant', question: 'question 1', status: 'pending' });
    s = chatReducer(s, { type: 'fail', chatId: 'c1', assistantId: 'a1', error: 'Stopped.', stopped: true });
    expect(s.chats.c1.messages[1]).toMatchObject({ status: 'stopped' });
  });

  it('orders by recency, deletes, and resets the active chat', () => {
    let s = askOnce(hydrated, 'c1', 1);
    s = chatReducer(s, { type: 'new' });
    s = askOnce(s, 'c2', 2);
    expect(s.order).toEqual(['c2', 'c1']);
    s = askOnce(chatReducer(s, { type: 'select', id: 'c1' }), 'c1', 3);
    expect(s.order).toEqual(['c1', 'c2']);
    s = chatReducer(s, { type: 'delete', id: 'c1' });
    expect(s).toMatchObject({ order: ['c2'], activeId: null });
    expect(s.chats.c1).toBeUndefined();
  });

  it('marks requests interrupted by an app restart', () => {
    const chat: Chat = {
      id: 'c1',
      title: 't',
      createdAt: 1,
      updatedAt: 1,
      messages: [{ id: 'a1', role: 'assistant', question: 'q', status: 'pending' }],
    };
    const s = chatReducer(initialState, { type: 'hydrate', chats: [chat] });
    expect(s.hydrated).toBe(true);
    expect(s.chats.c1.messages[0]).toMatchObject({ status: 'stopped', error: 'Interrupted.' });
  });
});

describe('contextFor', () => {
  it('returns answered turns before a message, oldest first, capped', () => {
    let s = chatReducer(initialState, { type: 'hydrate', chats: [] });
    for (let i = 1; i <= 6; i++) {
      s = askOnce(s, 'c1', i);
      if (i !== 3) s = chatReducer(s, { type: 'answer', chatId: 'c1', assistantId: `a${i}`, response: response(`SELECT ${i}`) });
    }
    expect(contextFor(s.chats.c1).map((t) => t.sql)).toEqual(['SELECT 2', 'SELECT 4', 'SELECT 5', 'SELECT 6']);
    expect(contextFor(s.chats.c1, 'a4').map((t) => t.sql)).toEqual(['SELECT 1', 'SELECT 2']);
  });
});
