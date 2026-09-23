import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import * as theme from '../src/theme';

jest.mock('../src/theme', () => {
  const actual = jest.requireActual('../src/theme');
  return { ...actual, usePalette: jest.fn(actual.usePalette) };
});

import RootLayout from '../src/app/_layout';
import ChatScreen from '../src/app/index';
import SettingsScreen from '../src/app/settings';

const routes = { _layout: RootLayout, index: ChatScreen, settings: SettingsScreen };

interface Pending {
  body: { question: string; context: { question: string; sql: string }[] };
  resolve: (status: number, json: unknown) => void;
  signal: AbortSignal;
}

let requests: Pending[] = [];

function answer(sql: string, text: string, rows: unknown[][] = [[500]]) {
  return {
    question: '',
    sql,
    answer: text,
    result: { columns: [{ name: 'Orders', type: 'int' }], rows, rowCount: rows.length, truncated: false, elapsedMs: 4 },
    cache: null,
    attempts: 1,
    timings: { totalMs: 1400, llmMs: 1300, dbMs: 100 },
    usage: { llmCalls: 1, costUsd: 0.0001 },
  };
}

beforeEach(async () => {
  requests = [];
  await AsyncStorage.clear();
  jest.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
    const signal = (init as RequestInit).signal!;
    return new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')));
      requests.push({
        body: JSON.parse(String((init as RequestInit).body)),
        signal,
        resolve: (status, json) => resolve({ ok: status < 400, status, json: async () => json } as Response),
      });
    });
  });
});

afterEach(() => jest.restoreAllMocks());

async function ask(text: string) {
  fireEvent.changeText(screen.getByLabelText('Message'), text);
  fireEvent.press(screen.getByLabelText('Send'));
  await waitFor(() => expect(requests.length).toBeGreaterThan(0));
}

it('asks, shows progress, renders the answer and the evidence', async () => {
  renderRouter(routes, { initialUrl: '/' });
  expect(await screen.findByText('What would you like to know?')).toBeTruthy();
  expect(screen.getByLabelText('Send')).toBeDisabled();

  await ask('How many orders are there?');
  // Once as the message, once as the new chat's title.
  expect(screen.getAllByText('How many orders are there?')).toHaveLength(2);
  expect(screen.getByLabelText('Working on it')).toBeTruthy();
  expect(screen.getByLabelText('Stop')).toBeTruthy();
  expect(screen.getByLabelText('Message').props.value).toBe('');

  await act(async () => requests[0].resolve(200, answer('SELECT COUNT(*) AS Orders FROM sales.Orders', 'There are **500** orders.')));
  expect(await screen.findByText('500')).toBeTruthy();
  expect(screen.queryByLabelText('Working on it')).toBeNull();

  fireEvent.press(screen.getByLabelText('Show query and data'));
  expect(screen.getByText('SELECT COUNT(*) AS Orders FROM sales.Orders')).toBeTruthy();
  expect(screen.getAllByText('500').length).toBeGreaterThan(1);
});

it('sends earlier turns so follow-up questions resolve', async () => {
  renderRouter(routes, { initialUrl: '/' });
  await screen.findByText('What would you like to know?');
  await ask('Revenue by country in 2025');
  await act(async () => requests[0].resolve(200, answer('SELECT 2025', 'Done.')));
  await screen.findByText('Done.');

  await ask('and for 2024?');
  expect(requests[1].body).toMatchObject({
    question: 'and for 2024?',
    context: [{ question: 'Revenue by country in 2025', sql: 'SELECT 2025' }],
  });
});

it('stops an in-flight request and can retry it', async () => {
  renderRouter(routes, { initialUrl: '/' });
  await screen.findByText('What would you like to know?');
  await ask('Slow question');
  fireEvent.press(screen.getByLabelText('Stop'));
  expect(await screen.findByText('Stopped.')).toBeTruthy();
  expect(requests[0].signal.aborted).toBe(true);

  fireEvent.press(screen.getByLabelText('Retry'));
  await waitFor(() => expect(requests).toHaveLength(2));
  await act(async () => requests[1].resolve(200, answer('SELECT 1', 'Recovered.')));
  expect(await screen.findByText('Recovered.')).toBeTruthy();
});

it('explains server errors in plain language', async () => {
  renderRouter(routes, { initialUrl: '/' });
  await screen.findByText('What would you like to know?');
  await ask('Anything');
  await act(async () => requests[0].resolve(503, { message: 'All LLM providers failed: 429 Rate limit reached' }));
  expect(await screen.findByText('All LLM providers failed: 429 Rate limit reached')).toBeTruthy();
  expect(screen.getByLabelText('Retry')).toBeTruthy();
});

it('keeps conversations in the drawer, switches and deletes them, and persists', async () => {
  renderRouter(routes, { initialUrl: '/' });
  await screen.findByText('What would you like to know?');
  await ask('First conversation');
  await act(async () => requests[0].resolve(200, answer('SELECT 1', 'One.')));
  await screen.findByText('One.');

  fireEvent.press(screen.getByLabelText('New chat'));
  expect(await screen.findByText('What would you like to know?')).toBeTruthy();
  await ask('Second conversation');
  await act(async () => requests[1].resolve(200, answer('SELECT 2', 'Two.')));
  await screen.findByText('Two.');

  fireEvent.press(screen.getByLabelText('Open conversations'));
  fireEvent.press(await screen.findByLabelText('Open First conversation'));
  expect(await screen.findByText('One.')).toBeTruthy();

  // Survives an app restart (after the debounced save lands).
  await waitFor(async () => expect(await AsyncStorage.getItem('chats.v1')).toContain('Second conversation'));
  screen.unmount();
  renderRouter(routes, { initialUrl: '/' });
  fireEvent.press(await screen.findByLabelText('Open conversations'));
  expect(await screen.findByLabelText('Open Second conversation')).toBeTruthy();

  fireEvent(screen.getByLabelText('Open Second conversation'), 'longPress');
  fireEvent.press(screen.getByLabelText('Confirm delete'));
  await waitFor(() => expect(screen.queryByLabelText('Open Second conversation')).toBeNull());
  expect(screen.getByLabelText('Open First conversation')).toBeTruthy();
});

it('typing re-renders only the composer, never the conversation', async () => {
  renderRouter(routes, { initialUrl: '/' });
  await screen.findByText('What would you like to know?');
  await ask('Warm up');
  await act(async () => requests[0].resolve(200, answer('SELECT 1', 'A **rich** answer.')));
  await screen.findByText('rich');

  const usePalette = theme.usePalette as jest.Mock;
  usePalette.mockClear();
  for (const t of ['H', 'He', 'Hel', 'Hell', 'Hello']) fireEvent.changeText(screen.getByLabelText('Message'), t);
  // One palette read per keystroke = the Composer alone re-rendered.
  expect(usePalette).toHaveBeenCalledTimes(5);
});
