import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { cue } from '../src/lib/feedback';
import * as theme from '../src/theme';

// Native recorder and picker are replaced at the app's own seams (useVoice, media).
jest.mock('../src/lib/useVoice', () => {
  const React = require('react');
  return {
    useVoice: (onFinished: (f: unknown) => void) => {
      const [state, setState] = React.useState('idle');
      return {
        state,
        durationMs: state === 'recording' ? 4200 : 0,
        levels: Array(36).fill(0.2),
        start: async () => setState('recording'),
        cancel: async () => setState('idle'),
        finish: async () => {
          setState('idle');
          onFinished({ uri: 'file:///voice.m4a', name: 'voice.m4a', type: 'audio/m4a', durationMs: 4200 });
        },
        dismissDenied: () => setState('idle'),
      };
    },
  };
});
jest.mock('../src/lib/feedback', () => ({
  cue: jest.fn(),
  preloadFeedback: jest.fn(),
  setFeedbackEnabled: jest.fn(),
  START_CUE_MS: 0,
}));
jest.mock('../src/lib/media', () => ({
  pickImage: async () => ({ uri: 'file:///photo.jpg', name: 'photo.jpg', type: 'image/jpeg', thumb: 'data:image/jpeg;base64,AAAA' }),
}));

jest.mock('../src/theme', () => {
  const actual = jest.requireActual('../src/theme');
  return { ...actual, usePalette: jest.fn(actual.usePalette) };
});

import RootLayout from '../src/app/_layout';
import ChatScreen from '../src/app/index';
import SettingsScreen from '../src/app/settings';

const routes = { _layout: RootLayout, index: ChatScreen, settings: SettingsScreen };

interface Pending {
  url: string;
  body: { question: string; context: { question: string; sql: string }[] };
  /** Multipart parts for /query/ask/media, as [name, value]. */
  parts?: [string, unknown][];
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
  // Most flows below are asserted with English labels; Urdu has its own tests.
  await AsyncStorage.setItem('settings.language', JSON.stringify('en'));
  jest.spyOn(globalThis, 'fetch').mockImplementation((url, init) => {
    const signal = (init as RequestInit).signal!;
    const raw = (init as RequestInit).body;
    const form = raw as unknown as { _parts?: [string, unknown][]; entries?: () => Iterable<[string, unknown]> };
    const parts = typeof raw === 'string' ? undefined : (form._parts ?? Array.from(form.entries!()));
    return new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')));
      requests.push({
        url: String(url),
        parts,
        body: parts ? Object.fromEntries(parts.filter(([, v]) => typeof v === 'string')) : JSON.parse(String(raw)),
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
  // Empty composer offers the microphone; Send appears once there is text.
  expect(screen.getByLabelText('Record voice message')).toBeTruthy();
  expect(screen.queryByLabelText('Send')).toBeNull();

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
  // Two palette reads per keystroke: the Composer and its attach button - nothing in the conversation.
  expect(usePalette).toHaveBeenCalledTimes(10);
});

/** Nearest ancestor's flattened style that sets a writing direction (spans inherit from their paragraph). */
function paragraphStyle(el: { props: { style?: unknown }; parent: unknown }): Record<string, unknown> {
  for (let n: any = el; n; n = n.parent) {
    const style = Object.assign({}, ...[n.props?.style].flat(Infinity).filter(Boolean));
    if (style.writingDirection) return style;
  }
  return {};
}

function answerWith(extra: Record<string, unknown>, columns: string[] = ['Orders'], rows: unknown[][] = [[500]]) {
  return {
    ...answer('SELECT 1', 'ok', rows),
    result: { columns: columns.map((name) => ({ name, type: 'x' })), rows, rowCount: rows.length, truncated: false, elapsedMs: 3 },
    ...extra,
  };
}

it('sends a voice message and shows what was heard', async () => {
  renderRouter(routes, { initialUrl: '/' });
  await screen.findByText('What would you like to know?');
  fireEvent.press(screen.getByLabelText('Record voice message'));
  // Live row: timer + waveform, labelled for screen readers.
  expect(await screen.findByLabelText('Recording')).toBeTruthy();
  expect(screen.getByText('0:04')).toBeTruthy();
  expect(screen.getByLabelText('Cancel recording')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Send voice message'));
  await waitFor(() => expect(requests).toHaveLength(1));

  expect(requests[0].url).toMatch(/\/query\/ask\/media$/);
  const audio = requests[0].parts!.find(([k]) => k === 'audio')![1];
  // Native builds stream the file by URI (Jest's FormData may stringify the descriptor).
  expect(typeof audio === 'string' ? audio : JSON.stringify(audio)).toMatch(/voice\.m4a|object/);
  expect(requests[0].parts!.map(([k]) => k)).toEqual(['question', 'context', 'answer', 'language', 'audio']);
  expect(screen.getByLabelText('Voice message 0:04')).toBeTruthy();

  await act(async () =>
    requests[0].resolve(200, answerWith({ transcript: 'ہمارے کتنے آرڈر ہیں؟', language: 'ur', answer: 'ہمارے کل 500 آرڈر ہیں۔' })),
  );
  // Heard text fills the bubble and becomes the chat title; the answer renders right-to-left in Nastaliq.
  expect(await screen.findAllByText('ہمارے کتنے آرڈر ہیں؟')).toHaveLength(2);
  const urduAnswer = await screen.findByText('ہمارے کل 500 آرڈر ہیں۔');
  expect(paragraphStyle(urduAnswer)).toMatchObject({ fontFamily: 'NotoNastaliqUrdu_400Regular', writingDirection: 'rtl', textAlign: 'right' });
});

it('sends a photo with a question and shows what was read', async () => {
  renderRouter(routes, { initialUrl: '/' });
  await screen.findByText('What would you like to know?');
  fireEvent.press(screen.getByLabelText('Add photo'));
  fireEvent.press(await screen.findByLabelText('Photo library'));
  expect(await screen.findByLabelText('Remove photo')).toBeTruthy();

  fireEvent.changeText(screen.getByLabelText('Message'), 'How many of these did we sell?');
  fireEvent.press(screen.getByLabelText('Send'));
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0].body.question).toBe('How many of these did we sell?');
  expect(requests[0].parts!.map(([k]) => k)).toEqual(['question', 'context', 'answer', 'language', 'image']);
  expect(screen.queryByLabelText('Remove photo')).toBeNull();

  await act(async () =>
    requests[0].resolve(200, answerWith({ answer: 'We sold 12.', image: { question: 'Units sold of Gizmo', extracted: 'Gizmo box, SKU 17' } })),
  );
  expect(await screen.findByText('From the photo: Gizmo box, SKU 17')).toBeTruthy();
});

it('draws grouped results as a chart', async () => {
  renderRouter(routes, { initialUrl: '/' });
  await screen.findByText('What would you like to know?');
  await ask('Revenue by country');
  await act(async () =>
    requests[0].resolve(200, answerWith({ answer: 'PK leads.' }, ['Country', 'Revenue'], [['PK', 300], ['AE', 120], ['GB', 90]])),
  );
  await screen.findByText('PK leads.');
  // Charts size themselves to their container: simulate the layout pass.
  fireEvent(screen.getByTestId('chart'), 'layout', { nativeEvent: { layout: { width: 320, height: 0, x: 0, y: 0 } } });
  expect(await screen.findByLabelText('Bar chart')).toBeTruthy();
});

describe('in Urdu (the default)', () => {
  beforeEach(async () => {
    await AsyncStorage.removeItem('settings.language');
  });

  it('shows an Urdu, right-to-left interface out of the box', async () => {
    renderRouter(routes, { initialUrl: '/' });
    const greeting = await screen.findByText('آپ کیا جاننا چاہتے ہیں؟');
    expect(Object.assign({}, ...[greeting.props.style].flat(Infinity).filter(Boolean))).toMatchObject({ fontFamily: 'NotoNastaliqUrdu_400Regular' });
    expect(screen.getByLabelText('آواز کا پیغام ریکارڈ کریں')).toBeTruthy();
    // Header mirrors: the menu sits on the right.
    const bar = screen.getByTestId('header');
    expect(Object.assign({}, ...[bar.props.style].flat(Infinity).filter(Boolean)).flexDirection).toBe('row-reverse');
  });

  it('asks in Urdu and answers in Urdu', async () => {
    renderRouter(routes, { initialUrl: '/' });
    await screen.findByText('آپ کیا جاننا چاہتے ہیں؟');
    fireEvent.changeText(screen.getByLabelText('Message'), 'پاکستان میں کتنے گاہک ہیں؟');
    fireEvent.press(screen.getByLabelText('بھیجیں'));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].body.question).toBe('پاکستان میں کتنے گاہک ہیں؟');
    await act(async () => requests[0].resolve(200, answerWith({ answer: 'پاکستان میں **115** گاہک ہیں۔', language: 'ur' })));
    expect(await screen.findByText('115')).toBeTruthy();
    expect(screen.getByLabelText('کوئری اور ڈیٹا دکھائیں')).toBeTruthy();
  });

  it('shows errors in Urdu', async () => {
    (globalThis.fetch as jest.Mock).mockImplementationOnce(() => Promise.reject(new TypeError('Network request failed')));
    renderRouter(routes, { initialUrl: '/' });
    await screen.findByText('آپ کیا جاننا چاہتے ہیں؟');
    fireEvent.changeText(screen.getByLabelText('Message'), 'کتنے آرڈر ہیں؟');
    fireEvent.press(screen.getByLabelText('بھیجیں'));
    expect(await screen.findByText(/سرور http:\/\/localhost:3000 تک رسائی نہیں ہو سکی/)).toBeTruthy();
    // A wrong address is fixed in Settings, so the error offers a shortcut there.
    fireEvent.press(screen.getByLabelText('سیٹنگز کھولیں'));
    expect(await screen.findByText('سرور کا پتہ')).toBeTruthy();
  });

  it('replies in Roman Urdu when chosen in Settings', async () => {
    renderRouter(routes, { initialUrl: '/settings' });
    fireEvent.press(await screen.findByLabelText('Roman Urdu'));
    expect(await AsyncStorage.getItem('settings.replyLanguage')).toBe(JSON.stringify('ur-Latn'));
    fireEvent.press(screen.getByLabelText('Save settings'));
    await screen.findByText('آپ کیا جاننا چاہتے ہیں؟');
    fireEvent.changeText(screen.getByLabelText('Message'), 'hamare kitne customers hain?');
    fireEvent.press(screen.getByLabelText('بھیجیں'));
    await waitFor(() => expect(requests.length).toBe(1));
    expect(requests[0].body).toMatchObject({ question: 'hamare kitne customers hain?', language: 'ur-Latn' });
    await act(async () => requests[0].resolve(200, answerWith({ answer: 'Ap k **1,050** customers hain.', language: 'ur-Latn' })));
    expect(await screen.findByText('1,050')).toBeTruthy();
    expect(cue).toHaveBeenCalledWith('answer');
  });

  it('switches to English instantly from Settings', async () => {
    renderRouter(routes, { initialUrl: '/' });
    await screen.findByText('آپ کیا جاننا چاہتے ہیں؟');
    fireEvent.press(screen.getByLabelText('گفتگوئیں کھولیں'));
    fireEvent.press(await screen.findByLabelText('سیٹنگز'));
    // The first "English" is the interface language; the reply-language group has its own.
    fireEvent.press((await screen.findAllByLabelText('English'))[0]);
    expect(await screen.findByText('Language')).toBeTruthy();
    expect(await AsyncStorage.getItem('settings.language')).toBe(JSON.stringify('en'));
  });
});
