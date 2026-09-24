import { createContext, useContext } from 'react';
import { type TextStyle } from 'react-native';
import { fonts } from './theme';

export type UiLanguage = 'ur' | 'en';

const en = {
  appNewChat: 'New chat',
  greeting: 'What would you like to know?',
  greetingHint: 'Ask about your database by typing, speaking, or sharing a photo.',
  placeholder: 'Ask about your data',
  send: 'Send',
  stop: 'Stop',
  record: 'Record voice message',
  recording: 'Recording',
  cancelRecording: 'Cancel recording',
  sendRecording: 'Send voice message',
  attach: 'Add photo',
  removeImage: 'Remove photo',
  choosePhoto: 'Photo library',
  takePhoto: 'Camera',
  micDenied: 'Microphone access is off. Turn it on in system settings to send voice messages.',
  photoFailed: "That photo couldn't be opened. Try another one.",
  voiceMessage: 'Voice message',
  photo: 'Photo',
  openConversations: 'Open conversations',
  closeConversations: 'Close conversations',
  startNewChat: 'Start new chat',
  recents: 'Recents',
  noChats: 'Your conversations will appear here.',
  deleteChat: 'Delete this chat?',
  cancel: 'Cancel',
  delete: 'Delete',
  settings: 'Settings',
  today: 'Today',
  yesterday: 'Yesterday',
  daysAgo: (n: number) => `${n} days ago`,
  working: 'Working on it',
  retry: 'Retry',
  askAgain: 'Ask again',
  copy: 'Copy answer',
  copied: 'Copied',
  stopped: 'Stopped.',
  interrupted: 'Interrupted.',
  query: 'Query',
  showQuery: 'Show query and data',
  hideQuery: 'Hide query and data',
  rows: (n: string) => `${n} rows`,
  row: '1 row',
  showingRows: (shown: number, total: string) => `Showing ${shown} of ${total} rows.`,
  chart: 'Chart',
  heard: 'Heard',
  readFromImage: 'From the photo',
  settingsTitle: 'Settings',
  save: 'Save',
  closeSettings: 'Close settings',
  language: 'Language',
  serverAddress: 'Server address',
  serverHint: "On a phone, use your computer's network address, not localhost.",
  apiKey: 'API key (if the server requires one)',
  optional: 'Optional',
  keychain: 'Stored in the device keychain.',
  testConnection: 'Test connection',
  connOk: (mode: string) => `Connected. Database is up; model routing: ${mode}.`,
  connKey: 'Connected, but the API key was rejected.',
  connDb: (e: string) => `Connected, but the database is unreachable: ${e}`,
  connLlm: 'Connected, but the server has no language model key configured.',
  errNetwork: (url: string) => `Can't reach the server at ${url}. Check the address in Settings.`,
  errNoServer: 'No server is connected yet. Add your server address in Settings.',
  openSettings: 'Open settings',
  setupTitle: 'Connect your server',
  setupBody: 'Enter the address of the server that is connected to your database, for example http://192.168.1.20:3000.',
  setupAction: 'Set server address',
  replyLanguage: 'Reply language',
  replyAuto: 'Auto',
  replyAutoHint: 'Auto replies in the language you ask in. Roman Urdu replies like "Ap k 20 customers hain."',
  romanUrdu: 'Roman Urdu',
  sounds: 'Sounds and vibration',
  soundsHint: 'Plays a short tone when recording starts, is sent or discarded, and when an answer arrives.',
  connectedTo: (host: string) => `Server: ${host}`,
  errTimeout: 'The server took too long to answer. Try a narrower question.',
  errAuth: 'The server rejected the API key. Check it in Settings.',
  errRate: 'Too many requests right now. Wait a moment and try again.',
  errServer: 'The server returned an error.',
};

type Strings = typeof en;

const ur: Strings = {
  appNewChat: 'نئی گفتگو',
  greeting: 'آپ کیا جاننا چاہتے ہیں؟',
  greetingHint: 'اپنے ڈیٹا بیس کے بارے میں لکھ کر، بول کر یا تصویر بھیج کر پوچھیں۔',
  placeholder: 'اپنے ڈیٹا کے بارے میں پوچھیں',
  send: 'بھیجیں',
  stop: 'روکیں',
  record: 'آواز کا پیغام ریکارڈ کریں',
  recording: 'ریکارڈنگ',
  cancelRecording: 'ریکارڈنگ منسوخ کریں',
  sendRecording: 'آواز کا پیغام بھیجیں',
  attach: 'تصویر شامل کریں',
  removeImage: 'تصویر ہٹائیں',
  choosePhoto: 'تصاویر',
  takePhoto: 'کیمرہ',
  micDenied: 'مائیکروفون کی اجازت بند ہے۔ آواز کے پیغامات کے لیے سسٹم سیٹنگز میں اسے آن کریں۔',
  photoFailed: 'یہ تصویر نہیں کھل سکی۔ کوئی اور تصویر آزمائیں۔',
  voiceMessage: 'آواز کا پیغام',
  photo: 'تصویر',
  openConversations: 'گفتگوئیں کھولیں',
  closeConversations: 'گفتگوئیں بند کریں',
  startNewChat: 'نئی گفتگو شروع کریں',
  recents: 'حالیہ',
  noChats: 'آپ کی گفتگوئیں یہاں نظر آئیں گی۔',
  deleteChat: 'یہ گفتگو حذف کریں؟',
  cancel: 'منسوخ',
  delete: 'حذف کریں',
  settings: 'سیٹنگز',
  today: 'آج',
  yesterday: 'کل',
  daysAgo: (n: number) => `${n} دن پہلے`,
  working: 'جواب تیار ہو رہا ہے',
  retry: 'دوبارہ کوشش کریں',
  askAgain: 'دوبارہ پوچھیں',
  copy: 'جواب کاپی کریں',
  copied: 'کاپی ہو گیا',
  stopped: 'روک دیا گیا۔',
  interrupted: 'درمیان میں رک گیا۔',
  query: 'کوئری',
  showQuery: 'کوئری اور ڈیٹا دکھائیں',
  hideQuery: 'کوئری اور ڈیٹا چھپائیں',
  rows: (n: string) => `${n} قطاریں`,
  row: '1 قطار',
  showingRows: (shown: number, total: string) => `${total} میں سے ${shown} قطاریں دکھائی جا رہی ہیں۔`,
  chart: 'چارٹ',
  heard: 'سنا گیا',
  readFromImage: 'تصویر سے',
  settingsTitle: 'سیٹنگز',
  save: 'محفوظ کریں',
  closeSettings: 'سیٹنگز بند کریں',
  language: 'زبان',
  serverAddress: 'سرور کا پتہ',
  serverHint: 'فون پر localhost کے بجائے اپنے کمپیوٹر کا نیٹ ورک ایڈریس استعمال کریں۔',
  apiKey: 'API کلید (اگر سرور کو درکار ہو)',
  optional: 'اختیاری',
  keychain: 'ڈیوائس کی محفوظ کی چین میں رکھی جاتی ہے۔',
  testConnection: 'کنکشن جانچیں',
  connOk: (mode: string) => `کنکشن ٹھیک ہے۔ ڈیٹا بیس چل رہا ہے؛ ماڈل روٹنگ: ${mode}۔`,
  connKey: 'کنکشن ہو گیا، مگر API کلید قبول نہیں ہوئی۔',
  connDb: (e: string) => `کنکشن ہو گیا، مگر ڈیٹا بیس تک رسائی نہیں: ${e}`,
  connLlm: 'کنکشن ہو گیا، مگر سرور پر لینگویج ماڈل کی کلید موجود نہیں۔',
  errNetwork: (url: string) => `سرور ${url} تک رسائی نہیں ہو سکی۔ سیٹنگز میں پتہ چیک کریں۔`,
  errNoServer: 'ابھی کوئی سرور منسلک نہیں۔ سیٹنگز میں اپنے سرور کا پتہ درج کریں۔',
  openSettings: 'سیٹنگز کھولیں',
  setupTitle: 'اپنا سرور منسلک کریں',
  setupBody: 'اس سرور کا پتہ درج کریں جو آپ کے ڈیٹا بیس سے جڑا ہے، مثلاً http://192.168.1.20:3000',
  setupAction: 'سرور کا پتہ درج کریں',
  replyLanguage: 'جواب کی زبان',
  replyAuto: 'خودکار',
  replyAutoHint: 'خودکار: جس زبان میں سوال ہو اسی میں جواب۔ رومن اردو میں جواب یوں آئے گا: "Ap k 20 customers hain."',
  romanUrdu: 'Roman Urdu',
  sounds: 'آواز اور وائبریشن',
  soundsHint: 'ریکارڈنگ شروع، بھیجنے یا منسوخ کرنے اور جواب آنے پر ہلکی سی آواز۔',
  connectedTo: (host: string) => `سرور: ${host}`,
  errTimeout: 'سرور نے جواب دینے میں بہت دیر لگائی۔ سوال کو محدود کر کے دوبارہ پوچھیں۔',
  errAuth: 'سرور نے API کلید قبول نہیں کی۔ سیٹنگز میں چیک کریں۔',
  errRate: 'اس وقت بہت زیادہ درخواستیں ہیں۔ تھوڑی دیر بعد دوبارہ کوشش کریں۔',
  errServer: 'سرور میں خرابی پیش آئی۔',
};

export const STRINGS: Record<UiLanguage, Strings> = { en, ur };

export interface I18n {
  lang: UiLanguage;
  t: Strings;
  rtl: boolean;
}

export const I18nContext = createContext<I18n>({ lang: 'ur', t: ur, rtl: true });

export function useI18n(): I18n {
  return useContext(I18nContext);
}

const ARABIC_SCRIPT = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;

/** True when text is mostly Urdu script (so it must render right-to-left in Nastaliq). */
export function isUrduText(text: string): boolean {
  let letters = 0;
  let urdu = 0;
  for (const ch of text) {
    if (!/\p{L}/u.test(ch)) continue;
    letters++;
    if (ARABIC_SCRIPT.test(ch)) urdu++;
  }
  return letters > 0 && urdu / letters >= 0.3;
}

/**
 * Per-text typography: Urdu gets Nastaliq, right alignment and the extra line
 * height Nastaliq's diagonal stacking needs; everything else keeps its style.
 */
export function scriptStyle(text: string, base: TextStyle, weight: 'regular' | 'bold' = 'regular'): TextStyle[] {
  if (!isUrduText(text)) return [base];
  const size = (base.fontSize ?? 16) + 1;
  return [
    base,
    {
      fontFamily: weight === 'bold' ? fonts.urduBold : fonts.urdu,
      fontSize: size,
      lineHeight: Math.round(size * 2.1),
      writingDirection: 'rtl',
      textAlign: 'right',
    },
  ];
}

/** Row direction that follows the UI language. */
export function row(rtl: boolean) {
  return { flexDirection: rtl ? ('row-reverse' as const) : ('row' as const) };
}
