import AsyncStorage from '@react-native-async-storage/async-storage';

const scheduled: Record<string, unknown>[] = [];
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => undefined),
  scheduleNotificationAsync: jest.fn(async (req: Record<string, unknown>) => {
    scheduled.push(req);
    return 'id';
  }),
  getPermissionsAsync: jest.fn(async () => ({ granted: false, canAskAgain: true })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  AndroidImportance: { HIGH: 4 },
}));
const tasks: Record<string, () => Promise<unknown>> = {};
jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn((name: string, fn: () => Promise<unknown>) => (tasks[name] = fn)),
  isTaskRegisteredAsync: jest.fn(async () => false),
}));
jest.mock('expo-background-task', () => ({
  getStatusAsync: jest.fn(async () => 2),
  registerTaskAsync: jest.fn(async () => undefined),
  BackgroundTaskStatus: { Restricted: 1, Available: 2 },
  BackgroundTaskResult: { Success: 1, Failed: 2 },
}));

import * as BackgroundTask from 'expo-background-task';
import { checkInbox, ensureNotificationPermission, INBOX_TASK, registerBackgroundCheck, setupNotifications } from '../src/lib/notifications';

const cfg = { baseUrl: 'http://server:3000' };
let inbox: { unread: number; reports: Record<string, unknown>[] } = { unread: 0, reports: [] };
const report = (id: string, createdAt: string, extra: Record<string, unknown> = {}) => ({ id, title: 'Stock shortage', createdAt, read: false, status: 'ok', rows: 3, summary: '**3** products are short.', deliveries: [], ...extra });

beforeEach(async () => {
  scheduled.length = 0;
  await AsyncStorage.clear();
  jest.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    const since = new URL(String(url)).searchParams.get('since');
    const reports = inbox.reports.filter((r) => !since || String(r.createdAt) > since);
    return { ok: true, status: 200, json: async () => ({ unread: inbox.unread, reports }) } as Response;
  });
});
afterEach(() => jest.restoreAllMocks());

it('does not replay old reports on the first check, then notifies once per new report', async () => {
  inbox = { unread: 1, reports: [report('old', '2026-09-20T04:00:00Z')] };
  expect((await checkInbox(cfg, true)).fresh).toEqual([]);
  expect(scheduled).toHaveLength(0);

  const future = new Date(Date.now() + 60_000).toISOString();
  inbox = { unread: 2, reports: [report('new', future), report('old', '2026-09-20T04:00:00Z')] };
  const r = await checkInbox(cfg, true);
  expect(r).toMatchObject({ unread: 2, fresh: [expect.objectContaining({ id: 'new' })] });
  expect(scheduled).toEqual([
    { content: expect.objectContaining({ title: '📊 Stock shortage', body: '3 products are short.', data: { reportId: 'new' } }), trigger: null },
  ]);

  // Already seen: no second notification.
  await checkInbox(cfg, true);
  expect(scheduled).toHaveLength(1);
});

it('marks failed reports and stays quiet when a push token handles delivery', async () => {
  await checkInbox(cfg, true); // first check: records "now"
  const future = new Date(Date.now() + 60_000).toISOString();
  inbox = { unread: 1, reports: [report('bad', future, { status: 'failed', error: 'Database unreachable' })] };
  await checkInbox(cfg, true);
  expect(scheduled[0]).toMatchObject({ content: { title: '⚠️ Stock shortage', body: 'Database unreachable' } });

  await AsyncStorage.setItem('inbox.pushToken', JSON.stringify('ExponentPushToken[x]'));
  inbox = { unread: 2, reports: [report('later', new Date(Date.now() + 120_000).toISOString())] };
  await checkInbox(cfg, true);
  expect(scheduled).toHaveLength(1);
});

it('registers the background check, which reads the saved server', async () => {
  await setupNotifications(async () => cfg);
  await registerBackgroundCheck();
  expect(BackgroundTask.registerTaskAsync).toHaveBeenCalledWith(INBOX_TASK, { minimumInterval: 15 });
  expect(await tasks[INBOX_TASK]()).toBe(1);
  expect(await ensureNotificationPermission()).toBe(true);
});
