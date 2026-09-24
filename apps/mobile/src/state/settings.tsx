import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { I18nContext, STRINGS, type UiLanguage } from '../i18n';
import type { ReplyLanguage, ServerConfig } from '../lib/api';
import { preloadFeedback, setFeedbackEnabled } from '../lib/feedback';
import { secrets, storage } from '../lib/storage';

const URL_KEY = 'settings.apiUrl';
const API_KEY = 'settings.apiKey';
const LANG_KEY = 'settings.language';
const REPLY_KEY = 'settings.replyLanguage';
const SOUNDS_KEY = 'settings.sounds';

/**
 * Release builds ship with no server: the address is set in the app on first run.
 * Dev builds default to the local server.
 */
export const DEFAULT_API_URL = process.env.EXPO_PUBLIC_API_URL ?? (__DEV__ ? 'http://localhost:3000' : '');
const REPLY_LANGUAGES: ReplyLanguage[] = ['auto', 'ur', 'ur-Latn', 'en'];
/** Urdu first: the product's primary audience. */
export const DEFAULT_LANGUAGE: UiLanguage = 'ur';

interface SettingsValue {
  ready: boolean;
  server: ServerConfig;
  language: UiLanguage;
  /** Language of answers: auto follows each question; ur-Latn = Roman Urdu ("Ap k 20 customers hain"). */
  replyLanguage: ReplyLanguage;
  sounds: boolean;
  save(next: ServerConfig): Promise<void>;
  setLanguage(lang: UiLanguage): void;
  setReplyLanguage(lang: ReplyLanguage): void;
  setSounds(on: boolean): void;
}

const SettingsContext = createContext<SettingsValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [server, setServer] = useState<ServerConfig>({ baseUrl: DEFAULT_API_URL });
  const [language, setLang] = useState<UiLanguage>(DEFAULT_LANGUAGE);
  const [replyLanguage, setReply] = useState<ReplyLanguage>('auto');
  const [sounds, setSoundsState] = useState(true);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    void Promise.all([
      storage.get<string>(URL_KEY),
      secrets.get(API_KEY),
      storage.get<UiLanguage>(LANG_KEY),
      storage.get<ReplyLanguage>(REPLY_KEY),
      storage.get<boolean>(SOUNDS_KEY),
    ]).then(([url, key, lang, reply, snd]) => {
      if (!alive) return;
      setServer({ baseUrl: url || DEFAULT_API_URL, apiKey: key || undefined });
      if (lang === 'ur' || lang === 'en') setLang(lang);
      if (reply && REPLY_LANGUAGES.includes(reply)) setReply(reply);
      if (snd === false) setSoundsState(false);
      setFeedbackEnabled(snd !== false);
      if (snd !== false) preloadFeedback();
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

  const setLanguage = useCallback((lang: UiLanguage) => {
    setLang(lang);
    void storage.set(LANG_KEY, lang);
  }, []);

  const setReplyLanguage = useCallback((lang: ReplyLanguage) => {
    setReply(lang);
    void storage.set(REPLY_KEY, lang);
  }, []);

  const setSounds = useCallback((on: boolean) => {
    setSoundsState(on);
    setFeedbackEnabled(on);
    void storage.set(SOUNDS_KEY, on);
  }, []);

  const value = useMemo(
    () => ({ ready, server, language, replyLanguage, sounds, save, setLanguage, setReplyLanguage, setSounds }),
    [ready, server, language, replyLanguage, sounds, save, setLanguage, setReplyLanguage, setSounds],
  );
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsValue {
  const v = useContext(SettingsContext);
  if (!v) throw new Error('useSettings must be used inside SettingsProvider');
  return v;
}

/** Interface strings and direction for the chosen language. Switching needs no restart. */
export function I18nProvider({ children }: { children: ReactNode }) {
  const { language } = useSettings();
  const value = useMemo(() => ({ lang: language, t: STRINGS[language], rtl: language === 'ur' }), [language]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
