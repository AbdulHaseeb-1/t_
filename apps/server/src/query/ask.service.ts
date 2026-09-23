import { createHash } from 'node:crypto';
import { HttpException, Injectable, Logger } from '@nestjs/common';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { AppConfig } from '../config/app-config.js';
import { SqlExecutionError, UnsafeSqlError } from '../common/errors.js';
import { DatabaseService } from '../database/database.service.js';
import type { QueryResult } from '../database/database.types.js';
import { SchemaCatalogService } from '../database/schema/schema-catalog.service.js';
import type { SchemaContext } from '../database/schema/schema.types.js';
import { LlmService } from '../llm/llm.service.js';
import { type Tier, UsageMeter, type UsageSummary } from '../llm/llm.types.js';
import { ExamplesService } from './examples.service.js';
import {
  answerMessages,
  cannotAnswerReason,
  EMPTY_RESULT_RECHECK,
  extractSql,
  sqlMessages,
} from './prompts.js';
import { normalizeQuestion, QueryCacheService } from './query-cache.service.js';
import type { AskInput } from './query.dto.js';
import { resultFingerprint } from './result-compare.js';
import { toPromptTable } from './result-format.js';

export interface AskResponse {
  question: string;
  sql: string | null;
  answer: string | null;
  result: QueryResult | null;
  /** Where the response came from: 'answer' (no LLM, no DB), 'sql' (no LLM), or none. */
  cache: 'answer' | 'sql' | null;
  /** SQL generation rounds (1 = first try succeeded). */
  attempts: number;
  /** How the final SQL was reached, for diagnostics and evaluation. */
  trace: {
    candidates: number;
    /** Candidates in the voting round, and how many agreed with the winner (only when voting). */
    votes?: number;
    agreement?: number;
    repairs: number;
    emptyRecheck: boolean;
    escalated: boolean;
    examples: number;
  };
  schema: { tables: string[]; full: boolean };
  timings: { totalMs: number; llmMs: number; dbMs: number };
  usage: UsageSummary;
}

interface Timings {
  llmMs: number;
  dbMs: number;
}

interface Attempt {
  text: string;
  sql: string;
  result?: QueryResult;
  error?: string;
  refusal?: string;
}

type Trace = AskResponse['trace'];

/** `CustomerCount` / `total_revenue` -> `Customer count` / `Total revenue`. */
export function humanizeColumn(name: string): string {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[_\s]+/g, ' ')
    .trim()
    .toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Result';
}

export function formatScalar(v: unknown): string {
  if (v === null || v === undefined) return 'no value';
  if (typeof v === 'number') return v.toLocaleString('en-US', { maximumFractionDigits: 4 });
  return String(v);
}

function isSqlFailure(err: unknown): err is HttpException {
  return err instanceof UnsafeSqlError || err instanceof SqlExecutionError;
}

/**
 * Question -> SQL -> data (+ answer), optimized for accuracy per dollar:
 *   answer cache -> SQL cache -> few-shot + value-hinted schema prompt
 *   -> N candidates (voted by result when N > 1) -> guarded execution
 *   -> bounded repair (last try on the smart tier) -> empty-result recheck
 *   -> answer phrasing (skipped for scalars).
 */
@Injectable()
export class AskService {
  private readonly logger = new Logger(AskService.name);

  constructor(
    private readonly config: AppConfig,
    private readonly db: DatabaseService,
    private readonly catalog: SchemaCatalogService,
    private readonly llm: LlmService,
    private readonly cache: QueryCacheService,
    private readonly examples: ExamplesService,
  ) {}

  async ask(input: AskInput): Promise<AskResponse> {
    const started = performance.now();
    const meter = new UsageMeter();
    const timings: Timings = { llmMs: 0, dbMs: 0 };
    const maxRows = Math.min(input.maxRows ?? this.config.get('DB_MAX_ROWS'), this.config.get('DB_MAX_ROWS'));

    const schemaHash = await this.catalog.hash();
    // A follow-up means something different in each conversation: key on the context too.
    const contextKey = input.context.length
      ? `:${createHash('sha1').update(JSON.stringify(input.context)).digest('hex').slice(0, 12)}`
      : '';
    const qKey = `${schemaHash}:${normalizeQuestion(input.question)}${contextKey}`;
    const answerKey = `${qKey}:${maxRows}:${input.answer}`;
    const trace: Trace = { candidates: 0, repairs: 0, emptyRecheck: false, escalated: false, examples: 0 };

    if (!input.noCache) {
      const hit = this.cache.getAnswer<AskResponse>(answerKey);
      if (hit) {
        return {
          ...hit,
          cache: 'answer',
          timings: { totalMs: this.ms(started), llmMs: 0, dbMs: 0 },
          usage: meter.summary(),
        };
      }
    }

    const ctx = await this.catalog.contextFor(input.question);
    const done = (r: Pick<AskResponse, 'sql' | 'answer' | 'result' | 'cache' | 'attempts'>) =>
      this.finish(input, answerKey, started, timings, meter, trace, ctx, r);

    // SQL cache: live data, zero tokens.
    const cachedSql = input.noCache ? undefined : this.cache.getSql(qKey);
    if (cachedSql) {
      try {
        const result = await this.timed(timings, 'dbMs', () => this.db.readOnlyQuery(cachedSql, maxRows));
        const answer = input.answer
          ? await this.phrase(input.question, cachedSql, result, meter, timings)
          : null;
        return done({ sql: cachedSql, answer, result, cache: 'sql', attempts: 0 });
      } catch (err) {
        this.logger.warn(`Cached SQL failed, regenerating: ${(err as Error).message}`);
      }
    }

    const snapshot = await this.catalog.snapshot();
    const shots = this.examples.retrieve(input.question);
    trace.examples = shots.length;
    const messages = sqlMessages(snapshot.database, ctx, input.question, maxRows, shots, input.context);
    const cacheKey = `sql:${schemaHash}`;

    let maxAttempts = 1 + this.config.get('ASK_MAX_REPAIRS');
    let attempts = 0;
    let forceSmart = false;
    let chosen: Attempt | undefined;

    while (attempts < maxAttempts) {
      attempts++;
      const isLast = attempts === maxAttempts;
      const tier: Tier = forceSmart || (isLast && attempts > 1) ? 'smart' : input.tier;
      if (tier === 'smart' && input.tier !== 'smart') trace.escalated = true;
      // Voting only on the first round; repairs are targeted single calls.
      const n = attempts === 1 ? this.config.get('ASK_SQL_CANDIDATES') : 1;

      const round = await this.round(messages, tier, n, maxRows, cacheKey, meter, timings);
      trace.candidates += round.tried;
      if (round.winner) {
        chosen = round.winner;
        if (n > 1) {
          trace.votes = n;
          trace.agreement = round.agreement;
        }
        break;
      }
      if (round.refusal) {
        if (tier !== 'smart') {
          // Cheap models refuse too eagerly; one smart-tier look is cheaper than a wrong "no".
          forceSmart = true;
          maxAttempts = Math.max(maxAttempts, attempts + 1);
          continue;
        }
        return done({
          sql: null,
          answer: `I can't answer that from this database: ${round.refusal}`,
          result: null,
          cache: null,
          attempts,
        });
      }
      const failed = round.failure!;
      if (isLast) throw new SqlExecutionError(failed.error!, failed.sql);
      trace.repairs++;
      messages.push({ role: 'assistant', content: failed.text } satisfies ChatCompletionMessageParam, {
        role: 'user',
        content: `That query failed: ${failed.error}\nReturn a corrected query in a single \`\`\`sql block.`,
      });
    }
    if (!chosen?.result) throw new SqlExecutionError('No query produced a result', chosen?.sql ?? '');

    // Zero rows from a filtered or joined query usually means a wrong literal or join path.
    if (
      chosen.result.rowCount === 0 &&
      this.config.get('ASK_EMPTY_RESULT_RECHECK') &&
      /\b(WHERE|JOIN|HAVING)\b/i.test(chosen.sql)
    ) {
      trace.emptyRecheck = true;
      attempts++;
      messages.push(
        { role: 'assistant', content: chosen.text },
        { role: 'user', content: EMPTY_RESULT_RECHECK },
      );
      // Needs actual reasoning about the data model: use the smart tier.
      trace.escalated ||= input.tier !== 'smart';
      const recheck = await this.round(messages, 'smart', 1, maxRows, cacheKey, meter, timings);
      trace.candidates += recheck.tried;
      if (recheck.winner?.result && recheck.winner.sql.trim() !== chosen.sql.trim()) chosen = recheck.winner;
    }

    this.cache.setSql(qKey, chosen.sql);
    const answer = input.answer
      ? await this.phrase(input.question, chosen.sql, chosen.result!, meter, timings)
      : null;
    return done({ sql: chosen.sql, answer, result: chosen.result!, cache: null, attempts });
  }

  /**
   * Generates n candidates in parallel and executes the distinct ones in
   * parallel. With n > 1 the result shared by most candidates wins.
   */
  private async round(
    messages: ChatCompletionMessageParam[],
    tier: Tier,
    n: number,
    maxRows: number,
    cacheKey: string,
    meter: UsageMeter,
    timings: Timings,
  ): Promise<{ winner?: Attempt; agreement?: number; refusal?: string; failure?: Attempt; tried: number }> {
    const texts = await this.timed(timings, 'llmMs', () =>
      Promise.all(
        Array.from({ length: n }, () =>
          this.llm
            .chat({ tier, messages, temperature: n > 1 ? 0.7 : 0, maxTokens: 800, cacheKey }, meter)
            .then((r) => r.message.content ?? ''),
        ),
      ),
    );
    const attempts: Attempt[] = texts.map((text) => {
      const sql = extractSql(text);
      return { text, sql, refusal: cannotAnswerReason(sql) };
    });

    const runnable = attempts.filter((a) => !a.refusal);
    if (runnable.length === 0) return { refusal: attempts[0].refusal, tried: n };

    // Execute each distinct SQL once.
    const bySql = new Map<string, Attempt[]>();
    for (const a of runnable) bySql.set(a.sql, [...(bySql.get(a.sql) ?? []), a]);
    await this.timed(timings, 'dbMs', () =>
      Promise.all(
        [...bySql.entries()].map(async ([sql, group]) => {
          try {
            const result = await this.db.readOnlyQuery(sql, maxRows);
            for (const a of group) a.result = result;
          } catch (err) {
            if (!isSqlFailure(err)) throw err;
            for (const a of group) a.error = err.message;
          }
        }),
      ),
    );

    const ok = runnable.filter((a) => a.result);
    if (ok.length === 0) return { failure: runnable[0], tried: n };
    if (ok.length === 1 || n === 1) return { winner: ok[0], agreement: 1, tried: n };

    // Majority vote on result fingerprints; ties go to the earliest candidate.
    const votes = new Map<string, Attempt[]>();
    for (const a of ok) {
      const fp = resultFingerprint(a.result!);
      votes.set(fp, [...(votes.get(fp) ?? []), a]);
    }
    const best = [...votes.values()].sort((a, b) => b.length - a.length)[0];
    return { winner: best[0], agreement: best.length, tried: n };
  }

  private async phrase(
    question: string,
    sql: string,
    result: QueryResult,
    meter: UsageMeter,
    timings: Timings,
  ): Promise<string> {
    if (result.rowCount === 0) return 'The query returned no rows.';
    // A single value needs no language model.
    if (result.rowCount === 1 && result.columns.length === 1) {
      return `${humanizeColumn(result.columns[0].name)}: **${formatScalar(result.rows[0][0])}**`;
    }
    const table = toPromptTable(result, this.config.get('ASK_ANSWER_MAX_ROWS'));
    const res = await this.timed(timings, 'llmMs', () =>
      this.llm.chat(
        { tier: 'fast', messages: answerMessages(question, sql, table), temperature: 0.2, maxTokens: 700 },
        meter,
      ),
    );
    return res.message.content?.trim() ?? '';
  }

  private finish(
    input: AskInput,
    answerKey: string,
    started: number,
    timings: Timings,
    meter: UsageMeter,
    trace: Trace,
    ctx: SchemaContext,
    r: Pick<AskResponse, 'sql' | 'answer' | 'result' | 'cache' | 'attempts'>,
  ): AskResponse {
    const response: AskResponse = {
      question: input.question,
      ...r,
      trace,
      schema: { tables: ctx.full ? [] : ctx.tables, full: ctx.full },
      timings: {
        totalMs: this.ms(started),
        llmMs: Math.round(timings.llmMs),
        dbMs: Math.round(timings.dbMs),
      },
      usage: meter.summary(),
    };
    this.cache.setAnswer(answerKey, response);
    return response;
  }

  private async timed<T>(t: Timings, key: keyof Timings, fn: () => Promise<T>): Promise<T> {
    const s = performance.now();
    try {
      return await fn();
    } finally {
      t[key] += performance.now() - s;
    }
  }

  private ms(started: number): number {
    return Math.round(performance.now() - started);
  }
}
