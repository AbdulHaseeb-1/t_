/** Typed client for the db-intelligence server. Pure fetch: runs in the app, Jest and Node. */

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
  sql: string | null;
  answer: string | null;
  result: QueryResult | null;
  cache: 'answer' | 'sql' | null;
  attempts: number;
  timings: { totalMs: number; llmMs: number; dbMs: number };
  usage: { llmCalls: number; costUsd?: number };
}

export interface Turn {
  question: string;
  sql: string;
}

export interface ServerConfig {
  baseUrl: string;
  apiKey?: string;
}

export type ApiErrorKind = 'network' | 'timeout' | 'auth' | 'rate_limit' | 'query' | 'unavailable' | 'server' | 'aborted';

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
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
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

export function ask(cfg: ServerConfig, question: string, context: Turn[], signal?: AbortSignal): Promise<AskResponse> {
  return request<AskResponse>(
    cfg,
    '/query/ask',
    { method: 'POST', body: JSON.stringify({ question, context: context.slice(-4), answer: true }) },
    signal,
  );
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
