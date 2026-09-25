/** Shapes returned by the server's /bench/api (see apps/server/src/bench and src/eval). */

export type Provider = 'openai' | 'openrouter';
export type Effort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface BenchConfig {
  engine: 'mssql' | 'duckdb';
  database: string;
  providers: Record<Provider, boolean>;
  current: {
    provider: string;
    openai: { fast: string; smart: string };
    openrouter: { fast: string; smart: string };
    reasoningEffort: Effort | null;
  };
  features: { valueHints: boolean; emptyRecheck: boolean; candidates: number };
  efforts: Effort[];
  maxCaseRuns: number;
}

export interface ModelInfo {
  id: string;
  provider: Provider;
  name: string;
  available: boolean;
  priceStatus: 'free' | 'paid' | 'unknown';
  promptPerM?: number;
  completionPerM?: number;
  cachedPerM?: number;
  contextLength?: number;
  reasoning?: boolean;
  current?: 'fast' | 'smart';
}

export interface ModelCatalog {
  models: ModelInfo[];
  errors: string[];
  loadedAt: string;
}

export interface DatasetInfo {
  file: string;
  name: string;
  database: string;
  description?: string;
  cases: number;
  tags: Record<string, number>;
  difficulties: Record<string, number>;
  languages: Record<string, number>;
  compatible: boolean;
  error?: string;
}

export interface DatasetCase {
  id: string;
  question: string;
  tags: string[];
  difficulty: string;
  language?: string;
  expect: 'result' | 'refusal';
  note?: string;
}

export interface ModelSpec {
  provider: Provider;
  model: string;
  reasoningEffort?: Effort;
  label?: string;
}

export interface Features {
  valueHints?: boolean;
  emptyRecheck?: boolean;
  candidates?: number;
  fewShot?: boolean;
}

export interface StartRun {
  dataset: string;
  models: ModelSpec[];
  repeats: number;
  concurrency: number;
  caseIds?: string[];
  filter?: string;
  answers?: boolean;
  features?: Features;
}

export type Verdict = 'correct' | 'wrong' | 'error';
export type Category =
  | 'correct'
  | 'wrong_rows'
  | 'wrong_columns'
  | 'wrong_values'
  | 'wrong_order'
  | 'false_refusal'
  | 'missed_refusal'
  | 'sql_error'
  | 'unsafe_sql'
  | 'llm_error'
  | 'other_error';

export interface Preview {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
}

export interface Usage {
  llmCalls: number;
  promptTokens: number;
  cachedPromptTokens: number;
  completionTokens: number;
  costUsd?: number;
  costComplete: boolean;
  models: string[];
}

export interface CaseResult {
  variant: string;
  repeat: number;
  id: string;
  question: string;
  tags: string[];
  difficulty: string;
  expect: 'result' | 'refusal';
  verdict: Verdict;
  category: Category;
  detail?: string;
  goldSql?: string;
  sql: string | null;
  answer: string | null;
  attempts: number;
  trace?: { candidates: number; repairs: number; emptyRecheck: boolean; escalated: boolean; votes?: number; agreement?: number };
  latencyMs: number;
  llmMs: number;
  dbMs: number;
  usage?: Usage;
  gold?: Preview;
  predicted?: Preview;
}

export interface Rate {
  correct: number;
  total: number;
  accuracy: number;
}

export interface VariantSummary {
  variant: string;
  overrides: Record<string, string>;
  cases: number;
  repeats: number;
  accuracy: number;
  infraErrors: number;
  accuracyStdDev: number;
  passAtK: number;
  passAllK: number;
  stability: number;
  firstTryAccuracy: number;
  byTag: Record<string, Rate>;
  byDifficulty: Record<string, Rate>;
  categories: Partial<Record<Category, number>>;
  latency: { meanMs: number; p50Ms: number; p95Ms: number; maxMs: number };
  cost: { totalUsd: number; perQuestionUsd: number; perCorrectUsd: number };
  tokens: { prompt: number; cachedPrompt: number; completion: number; llmCalls: number };
}

export type RunStatus = 'gold' | 'running' | 'done' | 'failed' | 'cancelled';

export interface RunView {
  id: string;
  status: RunStatus;
  dataset: string;
  datasetName: string;
  startedAt: string;
  finishedAt?: string;
  error?: string;
  request?: StartRun;
  engine?: string;
  variants: string[];
  progress: { total: number; done: Record<string, number> };
  summaries: VariantSummary[];
  flips: { id: string; question: string; from: string; to: string; change: 'fixed' | 'broken' }[];
  info?: { durationS: number; models: string[]; cases: number; repeats: number; source?: string };
  resultCount: number;
  results: CaseResult[];
}

export interface RunListEntry {
  id: string;
  status: RunStatus;
  dataset: string;
  startedAt: string;
  durationS?: number;
  cases: number;
  repeats: number;
  engine?: string;
  source?: string;
  variants: { variant: string; accuracy: number; perQuestionUsd: number; p50Ms: number }[];
}

export interface CompareResult {
  variant: string;
  provider: Provider;
  model: string;
  sql: string | null;
  answer: string | null;
  result: { columns: { name: string; type: string }[]; rows: unknown[][]; rowCount: number; truncated: boolean; elapsedMs: number } | null;
  timings?: { totalMs: number; llmMs: number; dbMs: number };
  usage?: Usage;
  trace?: CaseResult['trace'];
  error?: string;
}

export interface CompareResponse {
  question: string;
  results: CompareResult[];
  agreement: (boolean | null)[][];
  consensus: number[];
}


