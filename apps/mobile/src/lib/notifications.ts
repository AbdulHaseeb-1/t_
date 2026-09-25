import { isRunningInExpoGo } from 'expo';
import Constants from 'expo-constants';
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { type InboxEntry, listInbox, registerDevice, type ServerConfig } from './api';
import { storage } from './storage';

/**
 * Report notifications without any push setup: the app checks the server's
 * inbox (when opened, every minute while open, and about every 15 minutes in
 * the background) and shows a local notification for each new report. Builds
 * with push credentials also register for instant remote push, and then the
 * local copy is skipped.
 */
export const INBOX_TASK = 'reports-inbox-check';
const SEEN_KEY = 'inbox.lastSeen';
const PUSH_KEY = 'inbox.pushToken';
const CHANNEL = 'reports';
const native = Platform.OS !== 'web';

type NotificationsModule = typeof import('expo-notifications');

/**
 * expo-notifications subscribes to push tokens as soon as it loads, and that throws in
 * Expo Go on Android (push was removed from Expo Go in SDK 53), taking every screen that
 * imports it down with it. So it is loaded lazily and never in Expo Go on Android: the
 * inbox badge still works there, system notifications need a development build.
 */
export const notificationsAvailable = native && !(Platform.OS === 'android' && isRunningInExpoGo());
let loaded: NotificationsModule | null | undefined;

function notifications(): NotificationsModule | null {
  if (loaded === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- loading it at all is the side effect to avoid
      loaded = notificationsAvailable ? (require('expo-notifications') as NotificationsModule) : null;
    } catch {
      loaded = null;
    }
  }
  return loaded;
}

let loadConfig: () => Promise<ServerConfig> = async () => ({ baseUrl: '' });

/** Configures how notifications look and where the background task finds the server. */
export async function setupNotifications(load: () => Promise<ServerConfig>): Promise<void> {
  loadConfig = load;
  const Notifications = notifications();
  if (!Notifications) return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL, { name: 'Reports', importance: Notifications.AndroidImportance.HIGH });
  }
}

/** Asks once (Android 13+ / iOS show a system prompt); true when notifications may be shown. */
export async function ensureNotificationPermission(): Promise<boolean> {
  const Notifications = notifications();
  if (!Notifications) return false;
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  return (await Notifications.requestPermissionsAsync()).granted;
}

/**
 * New reports since the last check. The first check only records "now", so
 * installing the app does not replay the whole inbox as notifications.
 */
export async function checkInbox(cfg: ServerConfig, notify: boolean): Promise<{ unread: number; fresh: InboxEntry[] }> {
  if (!cfg.baseUrl) return { unread: 0, fresh: [] };
  const since = await storage.get<string>(SEEN_KEY);
  const res = await listInbox(cfg, since ?? undefined);
  const fresh = since ? res.reports.filter((r) => r.createdAt > since) : [];
  const newest = res.reports.reduce((m, r) => (r.createdAt > m ? r.createdAt : m), since ?? new Date().toISOString());
  await storage.set(SEEN_KEY, newest);
  const pushed = !!(await storage.get<string>(PUSH_KEY));
  const Notifications = notify && !pushed ? notifications() : null;
  if (Notifications) {
    for (const r of fresh.slice(0, 5).reverse()) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: `${r.status === 'failed' ? '⚠️' : '📊'} ${r.title}`,
          body: (r.status === 'failed' ? r.error : r.summary)?.replace(/\*\*/g, '').slice(0, 180) ?? '',
          data: { reportId: r.id },
          ...(Platform.OS === 'android' ? { channelId: CHANNEL } : {}),
        },
        trigger: null,
      });
    }
  }
  return { unread: res.unread, fresh };
}

// Background task: defined at module load, as TaskManager requires.
if (native) {
  TaskManager.defineTask(INBOX_TASK, async () => {
    try {
      await checkInbox(await loadConfig(), true);
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

/** Registers the ~15-minute background check (Android WorkManager / iOS BGTaskScheduler). */
export async function registerBackgroundCheck(): Promise<void> {
  if (!native) return;
  const status = await BackgroundTask.getStatusAsync();
  if (status !== BackgroundTask.BackgroundTaskStatus.Available) return;
  if (!(await TaskManager.isTaskRegisteredAsync(INBOX_TASK))) {
    await BackgroundTask.registerTaskAsync(INBOX_TASK, { minimumInterval: 15 });
  }
}

/** Instant push, only in builds configured for it (EAS project id + FCM on Android). */
export async function registerPush(cfg: ServerConfig): Promise<boolean> {
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
  if (!projectId || !cfg.baseUrl) return false;
  const Notifications = notifications();
  if (!Notifications) return false;
  try {
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    await registerDevice(cfg, token, Platform.OS === 'ios' ? 'ios' : 'android');
    await storage.set(PUSH_KEY, token);
    return true;
  } catch {
    return false;
  }
}

/** Calls back with the report id when the user taps a report notification. */
export function onReportTapped(cb: (reportId: string) => void): () => void {
  const Notifications = notifications();
  if (!Notifications) return () => undefined;
  const sub = Notifications.addNotificationResponseReceivedListener((r) => {
    const id = (r.notification.request.content.data as { reportId?: string } | undefined)?.reportId;
    if (id) cb(id);
  });
  return () => sub.remove();
}
