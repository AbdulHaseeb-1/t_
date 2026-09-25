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
import SettingsChoose from '../src/app/settings/choose';
import SettingsHome from '../src/app/settings/index';
import SettingsLayout from '../src/app/settings/_layout';
import SettingsServer from '../src/app/settings/server';
import ReportsScreen from '../src/app/reports/index';
import SchedulesScreen from '../src/app/schedules/index';
import ScheduleEditor from '../src/app/schedules/edit';
import InboxScreen from '../src/app/inbox/index';
import InboxReportScreen from '../src/app/inbox/[id]';

const routes = {
  'reports/index': ReportsScreen,
  'schedules/index': SchedulesScreen,
  'schedules/edit': ScheduleEditor,
  'inbox/index': InboxScreen,
  'inbox/[id]': InboxReportScreen,
  _layout: RootLayout,
  index: ChatScreen,
  'settings/_layout': SettingsLayout,
  'settings/index': SettingsHome,
  'settings/server': SettingsServer,
  'settings/choose': SettingsChoose,
};

interface Pending {
  url: string;
  body: { question: string; context: { question: string; answer?: string; sql?: string }[] };
  /** Multipart parts for /query/chat/media, as [name, value]. */
  parts?: [string, unknown][];
  resolve: (status: number, json: unknown) => void;
  signal: AbortSignal;
}

let requests: Pending[] = [];
const jsonHeaders = { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null) };
/** Canned answers for the app's background reads (report gallery, inbox, schedules); tests override them. */
let canned: Record<string, unknown> = {};
/** Makes the next question fail as if the server were unreachable. */
let failNextAsk = false;
const WebFormData = globalThis.FormData;

/** Match React Native FormData: keep native file parts instead of stringifying them. */
class NativeFormData {
  _parts: [string, unknown][] = [];
  append(name: string, value: unknown) { this._parts.push([name, value]); }
  entries() { return this._parts[Symbol.iterator](); }
}

function answer(sql: string, text: string, rows: unknown[][] = [[500]]) {
  return {
    question: '',
    sql,
    answer: text,
    result: { columns: [{ name: 'Orders', type: 'int' }], rows, rowCount: rows.length, truncated: false, elapsedMs: 4 },
    cache: null,
    attempts: 1,
    timings: { totalMs: 1400, llmMs: 1300, dbMs: 100 },
    usage: {
      llmCalls: 2,
      promptTokens: 1800,
      cachedPromptTokens: 1024,
      completionTokens: 120,
      costUsd: 0.0001,
      calls: [
        { purpose: 'sql', model: 'openai:gpt-6-luna', promptTokens: 1500, cachedPromptTokens: 1024, completionTokens: 60, latencyMs: 900 },
        { purpose: 'answer', model: 'openai:gpt-6-luna', promptTokens: 300, cachedPromptTokens: 0, completionTokens: 60, latencyMs: 400 },
      ],
    },
    schema: { tables: [], full: true, tableCount: 66, chars: 21000, approxTokens: 6000 },
    context: { turns: 0, engine: 'duckdb' },
  };
}

beforeEach(async () => {
  globalThis.FormData = NativeFormData as unknown as typeof FormData;
  requests = [];
  await AsyncStorage.clear();
  // Most flows below are asserted with English labels; Urdu has its own tests.
  await AsyncStorage.setItem('settings.language', JSON.stringify('en'));
  canned = {
    'GET /templates': { timezone: 'Asia/Karachi', today: '2026-09-24', templates: [] },
    'GET /inbox': { unread: 0, reports: [] },
    'GET /schedules': { whatsapp: false, schedules: [] },
  };
  failNextAsk = false;
  jest.spyOn(globalThis, 'fetch').mockImplementation((url, init) => {
    const method = (init as RequestInit).method ?? 'GET';
    const path = String(url).replace(/^https?:\/\/[^/]+/, '').split('?')[0];
    const hit = Object.entries(canned).find(([k]) => {
      const [m, pat] = k.split(' ');
      return m === method && (pat === path || (pat.endsWith('*') && path.startsWith(pat.slice(0, -1))));
    });
    if (hit) return Promise.resolve({ ok: true, status: 200, headers: jsonHeaders, json: async () => hit[1] } as unknown as Response);
    if (failNextAsk && /^\/query\/(ask|chat)/.test(path)) {
      failNextAsk = false;
      return Promise.reject(new TypeError('Network request failed'));
    }
    const signal = (init as RequestInit).signal!;
    const raw = (init as RequestInit).body;
    const form = raw as unknown as { _parts?: [string, unknown][]; entries?: () => Iterable<[string, unknown]> };
    const parts = typeof raw === 'string' ? undefined : (form._parts ?? Array.from(form.entries!()));
    return new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')));
      requests.push({
        url: String(url),
        parts,
        body: parts ? Object.fromEntries(parts.filter(([, v]) => typeof v === 'string')) : raw ? JSON.parse(String(raw)) : undefined,
        signal,
        // The chat client also accepts a plain JSON answer (servers without streaming).
        resolve: (status, json) => resolve({ ok: status < 400, status, headers: jsonHeaders, json: async () => json } as unknown as Response),
      });
    });
  });
});

afterEach(() => {
  globalThis.FormData = WebFormData;
  jest.restoreAllMocks();
});

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
  expect(screen.getByLabelText(/^Thinking, /)).toBeTruthy();
  expect(screen.getByLabelText('Stop')).toBeTruthy();
  expect(screen.getByLabelText('Message').props.value).toBe('');

  await act(async () => requests[0].resolve(200, answer('SELECT COUNT(*) AS Orders FROM sales.Orders', 'There are **500** orders.')));
  expect(await screen.findByText('500')).toBeTruthy();
  expect(screen.queryByLabelText(/^Thinking, /)).toBeNull();

  // SQL is hidden by default: the panel offers the data table only.
  fireEvent.press(await screen.findByLabelText('Show data'));
  expect(screen.getAllByText('500').length).toBeGreaterThan(1);
  expect(screen.queryByText('SELECT COUNT(*) AS Orders FROM sales.Orders')).toBeNull();
});

it('shows the SQL behind answers when enabled in Settings', async () => {
  await AsyncStorage.setItem('settings.showSql', JSON.stringify(true));
  renderRouter(routes, { initialUrl: '/' });
  await screen.findByText('What would you like to know?');
  await ask('How many orders are there?');
  await act(async () => requests[0].resolve(200, answer('SELECT COUNT(*) AS Orders FROM sales.Orders', 'There are **500** orders.')));
  fireEvent.press(await screen.findByLabelText('Show query and data'));
  expect(screen.getByText('SELECT COUNT(*) AS Orders FROM sales.Orders')).toBeTruthy();
});

it('shows what each answer cost and where the time went', async () => {
  renderRouter(routes, { initialUrl: '/' });
  await screen.findByText('What would you like to know?');
  await ask('How many orders are there?');
  await act(async () => requests[0].resolve(200, answer('SELECT 1', 'There are **500** orders.')));
  // Per-answer line: time, tokens; tap for the breakdown.
  fireEvent.press(await screen.findByLabelText('Details: 1.4 s · 1.9K Tokens'));
  expect(await screen.findByText('Answer details')).toBeTruthy();
  expect(screen.getByText('Write query')).toBeTruthy();
  expect(screen.getByText('Write answer')).toBeTruthy();
  expect(screen.getByText('1K cached')).toBeTruthy();
  expect(screen.getByText('Whole schema: 66 tables (~6K tokens)')).toBeTruthy();
  expect(screen.getByText('Converted .mdf file (DuckDB)')).toBeTruthy();
  expect(screen.getByText('Fresh: written and run for this question')).toBeTruthy();
  // Model 1,300 ms vs database 100 ms
  expect(screen.getByText('1.3 s')).toBeTruthy();
  expect(screen.getByText('100 ms')).toBeTruthy();

  // Header pill: this conversation's tokens.
  fireEvent.press(screen.getByLabelText('Usage: 1.9K tokens'));
  expect(await screen.findByText('This conversation')).toBeTruthy();
  expect(screen.getByText('1 answer')).toBeTruthy();
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

  expect(requests[0].url).toMatch(/\/query\/chat\/media$/);
  const audio = requests[0].parts!.find(([k]) => k === 'audio')![1] as { name?: string; type?: string; bytes?: unknown };
  // expo/fetch (the native fetch) cannot encode React Native's { uri } parts: the file goes as bytes, named and typed.
  expect(audio).toMatchObject({ name: 'voice.m4a', type: 'audio/m4a' });
  expect(typeof audio.bytes).toBe('function');
  expect(requests[0].parts!.map(([k]) => k)).toEqual(['question', 'context', 'language', 'audio']);
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
  expect(requests[0].url).toMatch(/\/query\/chat\/media$/);
  expect(requests[0].parts!.map(([k]) => k)).toEqual(['question', 'context', 'language', 'image']);
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
  const chart = screen.getByTestId('chart-bars');
  // Headline: the total across categories; tapping a bar shows its value and share.
  expect(screen.getByText('510')).toBeTruthy();
  // Charts size themselves to their container: simulate the layout pass.
  expect(chart).toBeTruthy();
  fireEvent(screen.getByTestId('chart-plot'), 'layout', { nativeEvent: { layout: { width: 320, height: 0, x: 0, y: 0 } } });
  expect(await screen.findByLabelText(/PK 300, AE 120, GB 90/)).toBeTruthy();
});

it('reveals a completed JSON answer gradually before showing its result', async () => {
  renderRouter(routes, { initialUrl: '/' });
  await screen.findByText('What would you like to know?');
  await ask('Summarize sales');
  const reply = 'Sales increased over the period, with the strongest results near the end of the month.';
  await act(async () => requests[0].resolve(200, answer('SELECT 1', reply)));
  expect(screen.queryByText(reply)).toBeNull();
  expect(await screen.findByLabelText('Response in progress', {}, { timeout: 3000 })).toBeTruthy();
  expect(await screen.findByText(reply, {}, { timeout: 5000 })).toBeTruthy();
  expect(await screen.findByLabelText('Show data')).toBeTruthy();
  expect(screen.queryByLabelText('Response in progress')).toBeNull();
}, 10_000);

it('fills an editable prompt from the installed sales templates', async () => {
  canned['GET /templates'] = {
    timezone: 'Asia/Karachi', today: '2026-09-24',
    templates: [{ id: 'top-products', title: 'Top products', category: 'sales', icon: 'shopping-bag', params: [], alert: false, builtIn: true, hasSql: true }],
  };
  renderRouter(routes, { initialUrl: '/' });
  fireEvent.press(await screen.findByLabelText('Top products: Rank by net sales'));
  const input = screen.getByLabelText('Message');
  expect(input.props.value).toContain('net sales this month');
  fireEvent.changeText(input, 'List the top 5 products by net sales this month as a table.');
  expect(screen.getByLabelText('Message').props.value).toContain('top 5 products');
});

it('opens all requested list rows from the analyst result widget', async () => {
  renderRouter(routes, { initialUrl: '/' });
  await screen.findByText('What would you like to know?');
  await ask('Enlsit the top 3 products');
  const rows = [
    ['CALVIT-C SACHETS NATURAL', 1_143_693, 19_498],
    ['Product B', 825_000, 8_300],
    ['Product C', 706_500, 7_200],
  ];
  const columns = ['Product name', 'Net sales', 'Units sold'];
  const result = { columns: columns.map((name) => ({ name, type: 'x' })), rows, rowCount: rows.length, truncated: false, elapsedMs: 3 };
  await act(async () => requests[0].resolve(200, answerWith({
    answer: 'CALVIT-C leads.',
    result,
    results: [{ id: 'r1', title: 'Top products', sql: 'SELECT ...', result, display: { view: 'chart', chart: 'bar' } }],
  }, columns, rows)));
  await screen.findByText('CALVIT-C leads.');
  expect(screen.getByText('Top products')).toBeTruthy();
  expect(screen.getByText('CALVIT-C SACHETS NATURAL')).toBeTruthy();
  expect(screen.getByText('Product B')).toBeTruthy();
  expect(screen.getByText('Product C')).toBeTruthy();
  expect(screen.getByText('Net sales')).toBeTruthy();
  expect(screen.getByText('Units sold')).toBeTruthy();
  expect(screen.queryByTestId('chart-bars')).toBeNull();
});

it('pages through every returned table row beyond the first 50', async () => {
  renderRouter(routes, { initialUrl: '/' });
  await screen.findByText('What would you like to know?');
  await ask('List 120 products');
  const rows = Array.from({ length: 120 }, (_, i) => [`Product ${i + 1}`, 120 - i]);
  await act(async () => requests[0].resolve(200, answerWith({ answer: 'Here are the products.' }, ['Product', 'Units'], rows)));
  expect(await screen.findByText('Product 1')).toBeTruthy();
  expect(screen.queryByText('Product 26')).toBeNull();
  expect(screen.getByText('1–25 of 120')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Next'));
  expect(screen.getByText('Product 26')).toBeTruthy();
  expect(screen.getByText('26–50 of 120')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Next'));
  expect(screen.getByText('Product 51')).toBeTruthy();
  expect(screen.getByText('51–75 of 120')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Next'));
  expect(screen.getByText('Product 76')).toBeTruthy();
  expect(screen.getByText('76–100 of 120')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Next'));
  expect(screen.getByText('Product 120')).toBeTruthy();
  expect(screen.getByText('101–120 of 120')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Previous'));
  expect(screen.getByText('Product 76')).toBeTruthy();
});

it('draws monthly results as growth columns with the change vs the previous month', async () => {
  renderRouter(routes, { initialUrl: '/' });
  await screen.findByText('What would you like to know?');
  await ask('Sales by month');
  await act(async () =>
    requests[0].resolve(200, answerWith({ answer: 'August was best.' }, ['month_number', 'net_sales'], [[6, 100], [7, 120], [8, 150]])),
  );
  await screen.findByText('August was best.');
  expect(screen.getByTestId('chart-columns')).toBeTruthy();
  expect(screen.getByText('Aug')).toBeTruthy();
  expect(screen.getByLabelText('+25% vs Jul')).toBeTruthy();
  expect(screen.getByLabelText('+50% since Jun')).toBeTruthy();
});

it('shows one row of several figures as KPI tiles', async () => {
  renderRouter(routes, { initialUrl: '/' });
  await screen.findByText('What would you like to know?');
  await ask('Revenue and orders this year');
  await act(async () => requests[0].resolve(200, answerWith({ answer: 'Summary.' }, ['total_revenue', 'orders'], [[2_500_000, 812]])));
  await screen.findByText('Summary.');
  expect(screen.getByLabelText('Total revenue: 2,500,000')).toBeTruthy();
  expect(screen.getByText('2.5M')).toBeTruthy();
  expect(screen.getByLabelText('Orders: 812')).toBeTruthy();
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
    expect(await screen.findByLabelText('ڈیٹا دکھائیں', {}, { timeout: 3000 })).toBeTruthy();
  });

  it('shows errors in Urdu', async () => {
    failNextAsk = true;
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
    // Settings list -> Reply language page -> pick Roman Urdu (applies instantly).
    fireEvent.press(await screen.findByLabelText('جواب کی زبان, خودکار'));
    fireEvent.press(await screen.findByLabelText('Roman Urdu'));
    expect(await AsyncStorage.getItem('settings.replyLanguage')).toBe(JSON.stringify('ur-Latn'));
    fireEvent.press(screen.getByLabelText('واپس'));
    expect(await screen.findByLabelText('جواب کی زبان, Roman Urdu')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('سیٹنگز بند کریں'));
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
    fireEvent.press(await screen.findByLabelText('ایپ کی زبان, اردو'));
    fireEvent.press(await screen.findByLabelText('English'));
    // The page re-renders in English immediately.
    expect(await screen.findByText('App language')).toBeTruthy();
    expect(await AsyncStorage.getItem('settings.language')).toBe(JSON.stringify('en'));
  });
});


// ── Reports: templates, schedules, inbox ─────────────────────────────────

const TEMPLATES = [
  { id: 'orders-today', title: "Today's orders", titleUr: 'آج کے آرڈرز', category: 'sales', icon: 'sun', params: [], alert: false, builtIn: true, hasSql: true },
  {
    id: 'top-customers',
    title: 'Top customers',
    description: 'Customers ranked by net sales.',
    category: 'customers',
    params: [
      { name: 'from', label: 'From', type: 'date', default: 'month_start' },
      { name: 'to', label: 'To', type: 'date', default: 'today' },
      { name: 'limit', label: 'How many', type: 'number', default: 10, min: 1, max: 100 },
    ],
    alert: false,
    builtIn: true,
    hasSql: true,
  },
  { id: 'stock-shortage', title: 'Stock shortage', category: 'stock', params: [], alert: true, builtIn: true, hasSql: true },
];

function reportResponse(id: string, title: string, columns: string[], rows: unknown[][], text: string) {
  return {
    ...answer('SELECT 1', text, rows),
    question: title,
    result: { columns: columns.map((name) => ({ name, type: 'int' })), rows, rowCount: rows.length, truncated: false, elapsedMs: 3 },
    attempts: 0,
    usage: { llmCalls: 1, promptTokens: 300, cachedPromptTokens: 0, completionTokens: 40, costUsd: 0.00001, calls: [] },
    template: { id, title, category: 'sales', alert: false, params: {}, period: '24 Sep 2026' },
  };
}

describe('reports', () => {
  beforeEach(() => {
    canned['GET /templates'] = { timezone: 'Asia/Karachi', today: '2026-09-24', templates: TEMPLATES };
  });

  it('runs a report from the empty chat with one tap, as a chat turn Retry can repeat', async () => {
    renderRouter(routes, { initialUrl: '/' });
    const chip = await screen.findByTestId('report-chip-orders-today');
    expect(screen.getByTestId('report-chip-stock-shortage')).toBeTruthy();
    expect(screen.getByTestId('report-chip-all')).toBeTruthy();
    fireEvent.press(chip);
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].url).toMatch(/\/templates\/orders-today\/run$/);
    expect(requests[0].body).toEqual({ params: {}, language: 'en', answer: true });

    await act(async () => requests[0].resolve(200, reportResponse('orders-today', "Today's orders", ['orders', 'units'], [[54, 120]], 'There were **54** orders today.')));
    // The message and the new chat's title.
    expect(await screen.findAllByText("📊 Today's orders")).toHaveLength(2);
    expect(await screen.findByLabelText('Orders: 54', {}, { timeout: 3000 })).toBeTruthy(); // KPI tiles
    // A report answer offers Schedule, not "Save as report" (it already is one).
    expect(screen.getByLabelText('Schedule')).toBeTruthy();
    expect(screen.queryByLabelText('Save as report')).toBeNull();

    fireEvent.press(screen.getByLabelText('Ask again'));
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1].url).toMatch(/\/templates\/orders-today\/run$/);
  });

  it('asks for parameters with presets before running, from the gallery', async () => {
    renderRouter(routes, { initialUrl: '/reports' });
    expect(await screen.findByText('Customers')).toBeTruthy(); // category heading
    fireEvent.changeText(screen.getByLabelText('Search reports'), 'top');
    expect(screen.queryByTestId('report-stock-shortage')).toBeNull();
    fireEvent.press(screen.getByTestId('report-top-customers'));

    expect(await screen.findByTestId('report-sheet')).toBeTruthy();
    fireEvent.press(screen.getAllByLabelText('Last month')[0]); // "From" presets come first
    fireEvent.press(screen.getByLabelText('How many +'));
    fireEvent.changeText(screen.getByLabelText('To: Date (YYYY-MM-DD)'), '2026-08-31');
    fireEvent.press(screen.getByLabelText('Run report'));

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].body).toEqual({ params: { from: 'prev_month_start', to: '2026-08-31', limit: 11 }, language: 'en', answer: true });
    expect(await screen.findAllByText('📊 Top customers · Last month – 2026-08-31 – How many: 11')).toHaveLength(2);
  });

  it('saves an AI answer as a one-tap report', async () => {
    renderRouter(routes, { initialUrl: '/' });
    await screen.findByText('What would you like to know?');
    await ask('How many orders are there?');
    await act(async () => requests[0].resolve(200, answer('SELECT COUNT(*) AS Orders FROM sales.Orders', 'There are **500** orders.')));
    fireEvent.press(await screen.findByLabelText('Save as report'));
    expect(screen.getByLabelText('Report name').props.value).toBe('How many orders are there?');
    fireEvent.changeText(screen.getByLabelText('Report name'), 'Order count');
    fireEvent.press(screen.getByLabelText('Save'));
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1].url).toMatch(/\/templates$/);
    expect(requests[1].body).toEqual({ title: 'Order count', question: 'How many orders are there?', sql: 'SELECT COUNT(*) AS Orders FROM sales.Orders' });
    await act(async () => requests[1].resolve(201, { ...TEMPLATES[0], id: 'order-count-x1', title: 'Order count', builtIn: false }));
    expect(await screen.findByLabelText('Saved to Reports')).toBeTruthy();
  });

  it('schedules a report weekly to the app and WhatsApp', async () => {
    canned['GET /schedules'] = { whatsapp: true, schedules: [] };
    renderRouter(routes, { initialUrl: '/reports' });
    fireEvent.press(await screen.findByTestId('report-top-customers'));
    fireEvent.press(await screen.findByLabelText('Schedule'));

    // Editor opens with the report picked and named after it.
    expect(await screen.findByDisplayValue('Top customers')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Weekly'));
    fireEvent.press(screen.getByLabelText('Thu'));
    fireEvent.press(screen.getByLabelText('08:00'));
    fireEvent.changeText(screen.getByLabelText('WhatsApp numbers'), '+92 300 111 2222');
    fireEvent.press(screen.getByLabelText('Save'));

    await waitFor(() => expect(requests.some((r) => r.url.endsWith('/schedules'))).toBe(true));
    const saved = requests.find((r) => r.url.endsWith('/schedules'))!;
    expect(saved.body).toEqual({
      name: 'Top customers',
      target: { templateId: 'top-customers', params: { from: 'month_start', to: 'today', limit: 10 } },
      frequency: { type: 'weekly', time: '08:00', weekdays: [1, 4] },
      language: 'en',
      deliver: { app: true, whatsapp: ['923001112222'] },
      enabled: true,
    });
  });

  it('shows unread reports in the header and inbox, opens one and marks it read', async () => {
    canned['GET /inbox'] = {
      unread: 1,
      reports: [{ id: 'r1', title: 'Stock shortage', createdAt: '2026-09-24T04:00:05Z', read: false, status: 'ok', rows: 2, summary: '**2** products are short.', deliveries: [] }],
    };
    canned['GET /inbox/r1'] = {
      id: 'r1',
      title: 'Stock shortage',
      createdAt: '2026-09-24T04:00:05Z',
      read: false,
      status: 'ok',
      rows: 2,
      summary: '**2** products are short.',
      deliveries: [{ channel: 'whatsapp', to: '923001112222', status: 'sent' }],
      response: reportResponse('stock-shortage', 'Stock shortage', ['product', 'in_stock'], [['REX 10MG', 0], ['CECOS SYP', 3]], '**2** products are short.'),
    };
    canned['POST /inbox/r1/read'] = null;
    renderRouter(routes, { initialUrl: '/' });
    fireEvent.press(await screen.findByLabelText('Inbox, 1 unread'));
    fireEvent.press(await screen.findByLabelText(/^• Stock shortage/));
    expect(await screen.findByText('WhatsApp 923001112222')).toBeTruthy();
    expect(screen.getAllByText(/products are short/).length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Run report')).toBeTruthy();
    await waitFor(() => expect((globalThis.fetch as jest.Mock).mock.calls.some(([u, i]) => String(u).endsWith('/inbox/r1/read') && (i as RequestInit).method === 'POST')).toBe(true));
  });
});
