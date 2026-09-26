/** Typed client for the db-intelligence server. Pure fetch plus FormData: runs in the app and Jest. */
import { File } from 'expo-file-system';
import { Platform } from 'react-native';

export interface ResultColumn {
  name: string;
  type: string;
}

export interface QueryResult {
  columns: ResultColumn[];
  rows: unknown[][];
  rowCount: number;
  truncated: boolean;
  elapsedMs: number;
}

export interface AskResponse {
  question: string;
  /** Language the answer is written in: en, ur (Urdu script) or ur-Latn (Roman Urdu). */
  language?: 'en' | 'ur' | 'ur-Latn';
  /** Voice messages: what the server heard. */
  transcript?: string;
  /** Image questions: the question read from the photo (English for SQL, `display` in the user's language). */
  image?: { question: string; display?: string; extracted: string };
  sql: string | null;
  answer: string | null;
  result: QueryResult | null;
  cache: 'answer' | 'sql' | null;
  attempts: number;
  timings: { totalMs: number; llmMs: number; dbMs: number; mediaMs?: number };
  usage: Usage;
  /** Schema context the model saw (older servers omit the size fields). */
  schema?: { tables: string[]; full: boolean; tableCount?: number; chars?: number; approxTokens?: number };
  context?: { turns: number; engine: 'mssql' | 'duckdb' };
  trace?: { repairs: number; escalated: boolean; emptyRecheck: boolean };
  /** Voice messages: which speech-to-text model heard it. */
  speech?: { provider: string; model: string };
  /** Chat answers: every result to show under the text, each with how to show it. */
  results?: ShownResult[];
  /** Chat answers: every tool call the assistant made. */
  steps?: AgentStep[];
}

/** How the assistant wants a result shown, from what was asked ("as a table", "trend"...). */
export type ResultView = 'number' | 'table' | 'chart';
export type ChartKind = 'line' | 'column' | 'bar' | 'donut';

export interface Display {
  view: ResultView;
  chart?: ChartKind;
}

export interface ShownResult {
  id: string;
  title: string;
  sql: string;
  result: QueryResult;
  display: Display;
}

export interface AgentStep {
  tool: string;
  label: string;
  ok: boolean;
  rowCount?: number;
  elapsedMs?: number;
  error?: string;
}

/** What the assistant is doing before the answer text starts. */
export type ChatStage = 'thinking' | 'listening' | 'reading' | 'schema' | 'query';

/** An earlier chat turn: what was asked, what was answered, and the SQL behind it (if any). */
export interface ChatTurn {
  question: string;
  answer?: string;
  sql?: string;
}

export interface ChatHandlers {
  status?(stage: ChatStage, label?: string): void;
  step?(step: AgentStep): void;
  /** More answer text. */
  delta?(text: string): void;
  /** The text so far was a preamble, not the answer: drop it. */
  reset?(): void;
}

export interface CallUsage {
  purpose: string;
  model: string;
  promptTokens: number;
  cachedPromptTokens: number;
  completionTokens: number;
  latencyMs: number;
  costUsd?: number;
}

export interface Usage {
  llmCalls: number;
  promptTokens?: number;
  cachedPromptTokens?: number;
  completionTokens?: number;
  costUsd?: number;
  costComplete?: boolean;
  models?: string[];
  calls?: CallUsage[];
}

/** Answer language: auto follows the question; ur-Latn is Roman Urdu. */
export type ReplyLanguage = 'auto' | 'ur' | 'ur-Latn' | 'en';

export interface ServerConfig {
  baseUrl: string;
  apiKey?: string;
}

export type ApiErrorKind = 'unconfigured' | 'network' | 'timeout' | 'auth' | 'rate_limit' | 'query' | 'unavailable' | 'server' | 'aborted';

export class ApiError extends Error {
  constructor(
    readonly kind: ApiErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const REQUEST_TIMEOUT_MS = 90_000;

export function normalizeBaseUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

function messageFor(status: number, body: { message?: unknown; code?: string } | null): ApiError {
  const detail = typeof body?.message === 'string' ? body.message : Array.isArray(body?.message) ? body.message.join('; ') : '';
  if (status === 401) return new ApiError('auth', 'The server rejected the API key. Check it in Settings.', status);
  if (status === 429) return new ApiError('rate_limit', 'Too many requests right now. Wait a moment and try again.', status);
  if (status === 422) return new ApiError('query', detail || 'The database could not run the generated query.', status);
  if (status === 503 || status === 502) {
    return new ApiError('unavailable', detail || 'The language model is unavailable. Try again shortly.', status);
  }
  if (status === 400) return new ApiError('query', detail || 'The request was not accepted.', status);
  return new ApiError('server', detail || `The server returned an error (${status}).`, status);
}

/**
 * A request can fail before it leaves the phone (e.g. a body the fetch implementation
 * cannot encode); the user sees "can't reach the server", the developer sees why.
 */
function logSendFailure(path: string, err: unknown): void {
  if (typeof __DEV__ !== 'undefined' && __DEV__) console.warn(`Request to ${path} failed before a response:`, err);
}

async function request<T>(
  cfg: ServerConfig,
  path: string,
  init: RequestInit & { timeoutMs?: number },
  signal?: AbortSignal,
): Promise<T> {
  if (!cfg.baseUrl.trim()) throw new ApiError('unconfigured', 'No server address is set. Add it in Settings.');
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, init.timeoutMs ?? REQUEST_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);

  let res: Response;
  try {
    res = await fetch(`${normalizeBaseUrl(cfg.baseUrl)}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        // FormData sets its own multipart boundary.
        ...(init.body && typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
        ...(cfg.apiKey ? { 'x-api-key': cfg.apiKey } : {}),
      },
      signal: controller.signal,
    });
  } catch (err) {
    if (signal?.aborted) throw new ApiError('aborted', 'Stopped.');
    if (timedOut) throw new ApiError('timeout', 'The server took too long to answer. Try a narrower question.');
    logSendFailure(path, err);
    throw new ApiError('network', `Can't reach the server at ${normalizeBaseUrl(cfg.baseUrl)}. Check the address in Settings.`);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }

  const body = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) throw messageFor(res.status, body as { message?: unknown } | null);
  return body as T;
}

export interface MediaFile {
  uri: string;
  name: string;
  type: string;
}

// ── Chat: the assistant, streamed as Server-Sent Events ─────────────────────

/** A quiet stream this long means the connection is gone (the server pings every 15 s). */
const STREAM_IDLE_MS = 60_000;

type StreamEvent =
  | { type: 'status'; stage: ChatStage; label?: string }
  | { type: 'step'; step: AgentStep }
  | { type: 'delta'; text: string }
  | { type: 'reset' }
  | { type: 'done'; response: AskResponse }
  | { type: 'error'; status: number; message: string };

/** UTF-8 across chunk boundaries (Urdu is multi-byte), for runtimes without TextDecoder. */
export function utf8Decoder(): (bytes: Uint8Array) => string {
  if (typeof TextDecoder !== 'undefined') {
    const d = new TextDecoder();
    return (bytes) => d.decode(bytes, { stream: true });
  }
  let pending: number[] = [];
  return (bytes) => {
    const all = pending.length ? [...pending, ...bytes] : Array.from(bytes);
    let out = '';
    let i = 0;
    while (i < all.length) {
      const b = all[i];
      const len = b < 0x80 ? 1 : b >= 0xf0 ? 4 : b >= 0xe0 ? 3 : b >= 0xc0 ? 2 : 1;
      if (i + len > all.length) break; // the rest of this character is in the next chunk
      let cp = len === 1 ? b : b & (0xff >> (len + 1));
      for (let k = 1; k < len; k++) cp = (cp << 6) | (all[i + k] & 0x3f);
      out += String.fromCodePoint(cp);
      i += len;
    }
    pending = all.slice(i);
    return out;
  };
}

/** Splits an SSE text stream into the JSON payloads of its events (comments are keepalives). */
export function sseParser(onEvent: (data: string) => void): (chunk: string) => void {
  let buffer = '';
  return (chunk) => {
    buffer += chunk.replace(/\r\n?/g, '\n');
    let end = buffer.indexOf('\n\n');
    while (end >= 0) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const data = block
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(l.startsWith('data: ') ? 6 : 5))
        .join('\n');
      if (data) onEvent(data);
      end = buffer.indexOf('\n\n');
    }
  };
}

/**
 * POSTs to a chat endpoint and follows its event stream until `done`. A server
 * that answers with plain JSON (older versions) is accepted too, and runtimes
 * without response streaming get the same events once the body is complete.
 */
async function streamChat(
  cfg: ServerConfig,
  path: string,
  body: string | FormData,
  on: ChatHandlers,
  signal?: AbortSignal,
): Promise<AskResponse> {
  if (!cfg.baseUrl.trim()) throw new ApiError('unconfigured', 'No server address is set. Add it in Settings.');
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, STREAM_IDLE_MS);
  };
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);
  const failed = () =>
    signal?.aborted
      ? new ApiError('aborted', 'Stopped.')
      : timedOut
        ? new ApiError('timeout', 'The server took too long to answer. Try a narrower question.')
        : new ApiError('network', `Can't reach the server at ${normalizeBaseUrl(cfg.baseUrl)}. Check the address in Settings.`);

  try {
    arm();
    let res: Response;
    try {
      res = await fetch(`${normalizeBaseUrl(cfg.baseUrl)}${path}`, {
        method: 'POST',
        body,
        headers: {
          Accept: 'text/event-stream',
          ...(typeof body === 'string' ? { 'Content-Type': 'application/json' } : {}),
          ...(cfg.apiKey ? { 'x-api-key': cfg.apiKey } : {}),
        },
        signal: controller.signal,
      });
    } catch (err) {
      if (!signal?.aborted && !timedOut) logSendFailure(path, err);
      throw failed();
    }
    if (!res.ok) throw messageFor(res.status, (await res.json().catch(() => null)) as { message?: unknown } | null);
    if (!/event-stream/i.test(res.headers.get('content-type') ?? '')) return (await res.json()) as AskResponse;

    let done: AskResponse | undefined;
    let error: ApiError | undefined;
    const handle = (data: string) => {
      arm();
      let e: StreamEvent;
      try {
        e = JSON.parse(data) as StreamEvent;
      } catch {
        return;
      }
      if (e.type === 'status') on.status?.(e.stage, e.label);
      else if (e.type === 'step') on.step?.(e.step);
      else if (e.type === 'delta') on.delta?.(e.text);
      else if (e.type === 'reset') on.reset?.();
      else if (e.type === 'done') done = e.response;
      else if (e.type === 'error') error ??= messageFor(e.status, { message: e.message });
    };
    const parse = sseParser(handle);
    try {
      const reader = res.body?.getReader?.();
      if (reader) {
        const decode = utf8Decoder();
        for (;;) {
          const { value, done: end } = await reader.read();
          if (end) break;
          if (value) parse(decode(value));
          if (done || error) break;
        }
        void reader.cancel().catch(() => undefined);
      } else {
        parse(await res.text());
      }
    } catch {
      throw failed();
    }
    if (error) throw error;
    if (!done) throw signal?.aborted || timedOut ? failed() : new ApiError('server', 'The answer was cut off. Try again.');
    return done;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * The assistant: talks, queries when needed, and streams its answer. `fresh`
 * skips the server's short answer cache (asking again should really ask again).
 */
export function chat(
  cfg: ServerConfig,
  question: string,
  context: ChatTurn[],
  on: ChatHandlers,
  signal?: AbortSignal,
  language: ReplyLanguage = 'auto',
  fresh = false,
): Promise<AskResponse> {
  return streamChat(cfg, '/query/chat', JSON.stringify({ question, context, language, ...(fresh && { noCache: true }) }), on, signal);
}

/** `chat` for voice and/or photo messages. */
export async function chatMedia(
  cfg: ServerConfig,
  input: { question: string; context: ChatTurn[]; audio?: MediaFile; image?: MediaFile; language?: ReplyLanguage; fresh?: boolean },
  on: ChatHandlers,
  signal?: AbortSignal,
): Promise<AskResponse> {
  return streamChat(cfg, '/query/chat/media', await mediaForm(input), on, signal);
}

/**
 * On iOS and Android the global fetch is expo/fetch (unless EXPO_PUBLIC_USE_RN_FETCH is
 * set). Its multipart encoder rejects React Native's `{ uri, name, type }` file parts
 * ("Unsupported FormDataPart implementation") before anything is sent, so every voice
 * and photo question failed as "can't reach the server". It accepts parts that hand
 * over their bytes: the file is read through expo-file-system, with an explicit name
 * and type (the server checks the type; the platform's guess for .m4a differs).
 */
const expoFetchUploads = Platform.OS !== 'web' && !['1', 'true'].includes(process.env.EXPO_PUBLIC_USE_RN_FETCH ?? '');

function nativeFilePart(file: MediaFile): Blob {
  if (!expoFetchUploads) return file as unknown as Blob; // React Native's fetch streams `{ uri }` parts itself
  const source = new File(file.uri);
  return { name: file.name, type: file.type, bytes: () => source.bytes() } as unknown as Blob;
}

async function mediaForm(input: { question: string; context: ChatTurn[]; audio?: MediaFile; image?: MediaFile; language?: ReplyLanguage; fresh?: boolean }) {
  const form = new FormData();
  form.append('question', input.question);
  form.append('context', JSON.stringify(input.context));
  form.append('language', input.language ?? 'auto');
  if (input.fresh) form.append('noCache', 'true');
  for (const [field, file] of [['audio', input.audio], ['image', input.image]] as const) {
    if (!file) continue;
    if (Platform.OS === 'web') {
      const blob = await (await fetch(file.uri)).blob();
      form.append(field, new Blob([blob], { type: file.type }), file.name);
    } else {
      form.append(field, nativeFilePart(file));
    }
  }
  return form;
}

export interface Health {
  status: 'ok' | 'degraded';
  db: { ok: boolean; error?: string };
  llm: { configured: boolean; mode: string };
}

export function health(cfg: ServerConfig): Promise<Health> {
  return request<Health>(cfg, '/health', { method: 'GET', timeoutMs: 8_000 });
}

/** Reachability, database and LLM status, plus whether the API key is accepted. */
export async function checkConnection(cfg: ServerConfig): Promise<Health & { authorized: boolean }> {
  const h = await health(cfg);
  try {
    await request(cfg, '/llm', { method: 'GET', timeoutMs: 8_000 });
    return { ...h, authorized: true };
  } catch (err) {
    if (err instanceof ApiError && err.kind === 'auth') return { ...h, authorized: false };
    throw err;
  }
}

// ── Reports: templates, schedules, inbox ─────────────────────────────────

export type ReportCategory = 'sales' | 'stock' | 'customers' | 'finance' | 'team' | 'custom';

export interface TemplateParam {
  name: string;
  label: string;
  labelUr?: string;
  type: 'date' | 'number';
  default: string | number;
  min?: number;
  max?: number;
}

export interface ReportTemplate {
  id: string;
  title: string;
  titleUr?: string;
  description?: string;
  descriptionUr?: string;
  prompt?: string;
  category: ReportCategory;
  icon?: string;
  params: TemplateParam[];
  alert: boolean;
  builtIn: boolean;
  hasSql?: boolean;
  question?: string;
}

export type ParamValues = Record<string, string | number>;

export interface ReportResponse extends AskResponse {
  template: { id: string; title: string; titleUr?: string; category: ReportCategory; alert: boolean; params: ParamValues; period: string };
}

export function listTemplates(cfg: ServerConfig, signal?: AbortSignal) {
  return request<{ timezone: string; today: string; templates: ReportTemplate[] }>(cfg, '/templates', { method: 'GET', timeoutMs: 15_000 }, signal);
}

export function runTemplate(cfg: ServerConfig, id: string, params: ParamValues, language: 'en' | 'ur' | 'ur-Latn', signal?: AbortSignal) {
  return request<ReportResponse>(cfg, `/templates/${encodeURIComponent(id)}/run`, { method: 'POST', body: JSON.stringify({ params, language, answer: true }) }, signal);
}

export function saveTemplate(cfg: ServerConfig, input: { title: string; question: string; sql?: string }) {
  return request<ReportTemplate>(cfg, '/templates', { method: 'POST', body: JSON.stringify(input), timeoutMs: 30_000 });
}

export function deleteTemplate(cfg: ServerConfig, id: string) {
  return request<void>(cfg, `/templates/${encodeURIComponent(id)}`, { method: 'DELETE', timeoutMs: 15_000 });
}

export type Frequency =
  | { type: 'daily'; time: string }
  | { type: 'weekly'; time: string; weekdays: number[] }
  | { type: 'monthly'; time: string; day: number | 'last' }
  | { type: 'cron'; expr: string };

export interface ScheduleInput {
  name: string;
  target: { templateId: string; params?: ParamValues } | { question: string };
  frequency: Frequency;
  language: 'en' | 'ur' | 'ur-Latn';
  deliver: { app: boolean; whatsapp: string[] };
  onlyIfRows?: boolean;
  enabled: boolean;
}

export interface Schedule extends ScheduleInput {
  id: string;
  timezone: string;
  description?: string;
  nextRunAt?: string;
  lastRunAt?: string;
  lastStatus?: 'ok' | 'skipped' | 'failed' | 'missed';
  lastError?: string;
  lastReportId?: string;
}

export function listSchedules(cfg: ServerConfig) {
  return request<{ whatsapp: boolean; schedules: Schedule[] }>(cfg, '/schedules', { method: 'GET', timeoutMs: 15_000 });
}

export function saveSchedule(cfg: ServerConfig, input: ScheduleInput, id?: string) {
  return request<Schedule>(cfg, id ? `/schedules/${encodeURIComponent(id)}` : '/schedules', { method: id ? 'PUT' : 'POST', body: JSON.stringify(input), timeoutMs: 20_000 });
}

export function deleteSchedule(cfg: ServerConfig, id: string) {
  return request<void>(cfg, `/schedules/${encodeURIComponent(id)}`, { method: 'DELETE', timeoutMs: 15_000 });
}

export function runSchedule(cfg: ServerConfig, id: string) {
  return request<InboxReport | { skipped: true; reason: string }>(cfg, `/schedules/${encodeURIComponent(id)}/run`, { method: 'POST' });
}

export interface InboxEntry {
  id: string;
  scheduleId?: string;
  title: string;
  createdAt: string;
  read: boolean;
  status: 'ok' | 'failed';
  rows: number;
  summary: string | null;
  error?: string;
  deliveries: { channel: 'app' | 'whatsapp'; to?: string; status: 'sent' | 'failed'; error?: string }[];
}

export interface InboxReport extends InboxEntry {
  response?: ReportResponse;
}

export function listInbox(cfg: ServerConfig, since?: string, signal?: AbortSignal) {
  const q = since ? `?since=${encodeURIComponent(since)}` : '';
  return request<{ unread: number; reports: InboxEntry[] }>(cfg, `/inbox${q}`, { method: 'GET', timeoutMs: 15_000 }, signal);
}

export function getInboxReport(cfg: ServerConfig, id: string) {
  return request<InboxReport>(cfg, `/inbox/${encodeURIComponent(id)}`, { method: 'GET', timeoutMs: 15_000 });
}

export function markInboxRead(cfg: ServerConfig, id?: string) {
  return request<void>(cfg, id ? `/inbox/${encodeURIComponent(id)}/read` : '/inbox/read', { method: 'POST', timeoutMs: 15_000 });
}

export function registerDevice(cfg: ServerConfig, token: string, platform: 'android' | 'ios' | 'web') {
  return request<void>(cfg, '/devices', { method: 'POST', body: JSON.stringify({ token, platform }), timeoutMs: 15_000 });
}
