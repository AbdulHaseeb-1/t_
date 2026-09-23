import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ServerConfig } from '../lib/api';
import { secrets, storage } from '../lib/storage';

const URL_KEY = 'settings.apiUrl';
const API_KEY = 'settings.apiKey';

export const DEFAULT_API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

interface SettingsValue {
  ready: boolean;
  server: ServerConfig;
  save(next: ServerConfig): Promise<void>;
}

const SettingsContext = createContext<SettingsValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [server, setServer] = useState<ServerConfig>({ baseUrl: DEFAULT_API_URL });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    void Promise.all([storage.get<string>(URL_KEY), secrets.get(API_KEY)]).then(([url, key]) => {
      if (!alive) return;
      setServer({ baseUrl: url || DEFAULT_API_URL, apiKey: key || undefined });
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const save = useCallback(async (next: ServerConfig) => {
    setServer(next);
    await Promise.all([storage.set(URL_KEY, next.baseUrl), secrets.set(API_KEY, next.apiKey ?? '')]);
  }, []);

  const value = useMemo(() => ({ ready, server, save }), [ready, server, save]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsValue {
  const v = useContext(SettingsContext);
  if (!v) throw new Error('useSettings must be used inside SettingsProvider');
  return v;
}
