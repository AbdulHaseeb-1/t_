/** Typed client for the db-intelligence server. Pure fetch plus FormData: runs in the app and Jest. */
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

export interface Turn {
  question: string;
  sql: string;
}

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

const ASK_TIMEOUT_MS = 90_000;

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
  }, init.timeoutMs ?? ASK_TIMEOUT_MS);
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
  } catch {
    if (signal?.aborted) throw new ApiError('aborted', 'Stopped.');
    if (timedOut) throw new ApiError('timeout', 'The server took too long to answer. Try a narrower question.');
    throw new ApiError('network', `Can't reach the server at ${normalizeBaseUrl(cfg.baseUrl)}. Check the address in Settings.`);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }

  const body = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) throw messageFor(res.status, body as { message?: unknown } | null);
  return body as T;
}

export function ask(
  cfg: ServerConfig,
  question: string,
  context: Turn[],
  signal?: AbortSignal,
  language: ReplyLanguage = 'auto',
): Promise<AskResponse> {
  return request<AskResponse>(
    cfg,
    '/query/ask',
    { method: 'POST', body: JSON.stringify({ question, context: context.slice(-4), answer: true, language }) },
    signal,
  );
}

export interface MediaFile {
  uri: string;
  name: string;
  type: string;
}

/**
 * Voice and/or image question. Native platforms stream the file from its URI;
 * the web build reads it into a Blob first.
 */
export async function askMedia(
  cfg: ServerConfig,
  input: { question: string; context: Turn[]; audio?: MediaFile; image?: MediaFile; language?: ReplyLanguage },
  signal?: AbortSignal,
): Promise<AskResponse> {
  const form = new FormData();
  form.append('question', input.question);
  form.append('context', JSON.stringify(input.context.slice(-4)));
  form.append('answer', 'true');
  form.append('language', input.language ?? 'auto');
  for (const [field, file] of [['audio', input.audio], ['image', input.image]] as const) {
    if (!file) continue;
    if (Platform.OS === 'web') {
      const blob = await (await fetch(file.uri)).blob();
      form.append(field, new Blob([blob], { type: file.type }), file.name);
    } else {
      form.append(field, file as unknown as Blob);
    }
  }
  return request<AskResponse>(cfg, '/query/ask/media', { method: 'POST', body: form, timeoutMs: 120_000 }, signal);
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
