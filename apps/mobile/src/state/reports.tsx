import { router } from 'expo-router';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { ApiError, listTemplates, type ReportTemplate } from '../lib/api';
import { checkInbox, onReportTapped, registerBackgroundCheck, registerPush, setupNotifications } from '../lib/notifications';
import { loadServerConfig, useSettings } from './settings';

interface ReportsValue {
  templates: ReportTemplate[];
  /** Server's "today" (its report time zone), for date presets. */
  today?: string;
  loading: boolean;
  error?: string;
  reload(): void;
  unread: number;
  refreshInbox(): Promise<void>;
}

const Ctx = createContext<ReportsValue | null>(null);
const POLL_MS = 60_000;

/** Report templates for the gallery, and the inbox badge (polled while the app is open). */
export function ReportsProvider({ children }: { children: ReactNode }) {
  const { server, ready } = useSettings();
  // Everything loaded for one server (and reload attempt): "loading" is simply "not loaded for this key yet".
  const [loaded, setLoaded] = useState<{ key: string; templates: ReportTemplate[]; today?: string; error?: string }>({ key: '', templates: [] });
  const [unread, setUnread] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const key = `${server.baseUrl}|${server.apiKey ?? ''}|${attempt}`;
  const serverRef = useRef(server);
  useLayoutEffect(() => {
    serverRef.current = server;
  }, [server]);

  useEffect(() => {
    void setupNotifications(loadServerConfig).then(registerBackgroundCheck).catch(() => undefined);
    return onReportTapped((id) => router.push(`/inbox/${id}`));
  }, []);

  useEffect(() => {
    if (!ready || !server.baseUrl) return;
    let live = true;
    listTemplates(server).then(
      (r) => live && setLoaded({ key, templates: r.templates, today: r.today }),
      (e: unknown) =>
        live &&
        // An older server has no /templates: that is "no reports", not an error.
        setLoaded({ key, templates: [], error: e instanceof ApiError && e.status === 404 ? undefined : (e as Error).message }),
    );
    void registerPush(server);
    return () => {
      live = false;
    };
  }, [ready, server, key]);

  const refreshInbox = useCallback(async () => {
    const cfg = serverRef.current;
    if (!cfg.baseUrl) return;
    try {
      const { unread: n } = await checkInbox(cfg, true);
      setUnread(n);
    } catch {
      // Offline or an older server: keep the last count.
    }
  }, []);

  useEffect(() => {
    if (!ready || !server.baseUrl) return;
    void refreshInbox();
    let timer: ReturnType<typeof setInterval> | undefined = setInterval(() => void refreshInbox(), POLL_MS);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        void refreshInbox();
        timer ??= setInterval(() => void refreshInbox(), POLL_MS);
      } else if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
    });
    return () => {
      if (timer) clearInterval(timer);
      sub.remove();
    };
  }, [ready, server, refreshInbox]);

  const current = loaded.key === key;
  const value = useMemo(
    () => ({
      templates: loaded.templates,
      today: loaded.today,
      loading: !!server.baseUrl && !current,
      error: current ? loaded.error : undefined,
      reload: () => setAttempt((a) => a + 1),
      unread,
      refreshInbox,
    }),
    [loaded, current, server.baseUrl, unread, refreshInbox],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useReports(): ReportsValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useReports must be used inside ReportsProvider');
  return v;
}
