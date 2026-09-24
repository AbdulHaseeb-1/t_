import type {
  BenchConfig,
  CompareResponse,
  DatasetCase,
  DatasetInfo,
  Features,
  ModelCatalog,
  ModelSpec,
  RunListEntry,
  RunView,
  StartRun,
} from './types';

const BASE = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/api`;
const KEY_STORAGE = 'bench.apiKey';

export function getApiKey(): string {
  try {
    return localStorage.getItem(KEY_STORAGE) ?? '';
  } catch {
    return '';
  }
}

export function setApiKey(key: string): void {
  try {
    if (key) localStorage.setItem(KEY_STORAGE, key);
    else localStorage.removeItem(KEY_STORAGE);
  } catch {
    // Private mode: the key lasts for this page only.
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const key = getApiKey();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(key ? { 'x-api-key': key } : {}),
      ...init.headers,
    },
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const body = text ? (JSON.parse(text) as unknown) : undefined;
  if (!res.ok) {
    const b = body as { message?: string | string[]; issues?: { path: string; message: string }[] } | undefined;
    const issues = b?.issues?.map((i) => `${i.path}: ${i.message}`).join('; ');
    const message = issues || (Array.isArray(b?.message) ? b.message.join('; ') : b?.message) || res.statusText;
    throw new ApiError(res.status, message);
  }
  return body as T;
}

export const api = {
  config: () => call<BenchConfig>('/config'),
  models: (refresh = false) => call<ModelCatalog>(`/models${refresh ? '?refresh=1' : ''}`),
  datasets: () => call<DatasetInfo[]>('/datasets'),
  dataset: (file: string) => call<{ name: string; cases: DatasetCase[] }>(`/datasets/${encodeURIComponent(file)}`),
  runs: () => call<RunListEntry[]>('/runs'),
  run: (id: string, since = 0) => call<RunView>(`/runs/${encodeURIComponent(id)}${since ? `?since=${since}` : ''}`),
  start: (body: StartRun) => call<RunView>('/runs', { method: 'POST', body: JSON.stringify(body) }),
  cancel: (id: string) => call<RunView>(`/runs/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
  remove: (id: string) => call<void>(`/runs/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  compare: (question: string, models: ModelSpec[], features: Features = {}) =>
    call<CompareResponse>('/compare', { method: 'POST', body: JSON.stringify({ question, models, features }) }),
};
