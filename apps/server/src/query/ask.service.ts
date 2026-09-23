import { Injectable, Logger } from '@nestjs/common';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { AppConfig } from '../config/app-config.js';
import { SqlExecutionError, UnsafeSqlError } from '../common/errors.js';
import { DatabaseService } from '../database/database.service.js';
import type { QueryResult } from '../database/database.types.js';
import { SchemaCatalogService } from '../database/schema/schema-catalog.service.js';
import { LlmService } from '../llm/llm.service.js';
import { type Tier, UsageMeter, type UsageSummary } from '../llm/llm.types.js';
import { answerMessages, cannotAnswerReason, extractSql, sqlMessages } from './prompts.js';
import { normalizeQuestion, QueryCacheService } from './query-cache.service.js';
import type { AskInput } from './query.dto.js';
import { toPromptTable } from './result-format.js';

export interface AskResponse {
  question: string;
  sql: string | null;
  answer: string | null;
  result: QueryResult | null;
  /** Where the response came from: 'answer' (no LLM, no DB), 'sql' (no LLM), or none. */
  cache: 'answer' | 'sql' | null;
  attempts: number;
  schema: { tables: string[]; full: boolean };
  timings: { totalMs: number; llmMs: number; dbMs: number };
  usage: UsageSummary;
}

/**
 * Fast path for a question:
 *   answer cache -> SQL cache -> 1 cheap LLM call for SQL -> guarded execution
 *   -> bounded self-repair (escalating to the smart tier on the last try)
 *   -> 1 cheap LLM call to phrase the answer (skipped for scalar results).
 * Typical cost: 2 small-model calls; repeat questions: 0.
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
  ) {}

  async ask(input: AskInput): Promise<AskResponse> {
    const started = performance.now();
    const meter = new UsageMeter();
    const timings = { llmMs: 0, dbMs: 0 };
    const maxRows = Math.min(input.maxRows ?? this.config.get('DB_MAX_ROWS'), this.config.get('DB_MAX_ROWS'));

    const schemaHash = await this.catalog.hash();
    const qKey = `${schemaHash}:${normalizeQuestion(input.question)}`;
    const answerKey = `${qKey}:${maxRows}:${input.answer}`;

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
    let cache: AskResponse['cache'] = null;
    let sql: string | null = null;
    let result: QueryResult | null = null;
    let attempts = 0;

    // SQL cache: live data, zero tokens.
    const cachedSql = input.noCache ? undefined : this.cache.getSql(qKey);
    if (cachedSql) {
      try {
        result = await this.timed(timings, 'dbMs', () => this.db.readOnlyQuery(cachedSql, maxRows));
        sql = cachedSql;
        cache = 'sql';
      } catch (err) {
        this.logger.warn(`Cached SQL failed, regenerating: ${(err as Error).message}`);
      }
    }

    if (!result) {
      const snapshot = await this.catalog.snapshot();
      const messages = sqlMessages(snapshot.database, ctx, input.question, maxRows);
      let maxAttempts = 1 + this.config.get('ASK_MAX_REPAIRS');
      let forceSmart = false;

      while (attempts < maxAttempts) {
        attempts++;
        const isLast = attempts === maxAttempts;
        const tier: Tier = forceSmart || (isLast && attempts > 1) ? 'smart' : input.tier;
        const res = await this.timed(timings, 'llmMs', () =>
          this.llm.chat(
            { tier, messages, temperature: 0, maxTokens: 800, cacheKey: `sql:${schemaHash}` },
            meter,
          ),
        );
        const text = res.message.content ?? '';
        sql = extractSql(text);

        const reason = cannotAnswerReason(sql);
        if (reason && tier !== 'smart') {
          // Cheap models refuse too eagerly; one smart-tier look is cheaper than a wrong "no".
          forceSmart = true;
          maxAttempts = Math.max(maxAttempts, attempts + 1);
          continue;
        }
        if (reason) {
          return this.finish(input, answerKey, started, timings, meter, {
            sql: null,
            answer: `I can't answer that from this database: ${reason}`,
            result: null,
            cache: null,
            attempts,
            ctx,
          });
        }

        try {
          const candidate = sql;
          result = await this.timed(timings, 'dbMs', () => this.db.readOnlyQuery(candidate, maxRows));
          this.cache.setSql(qKey, sql);
          break;
        } catch (err) {
          if (!(err instanceof UnsafeSqlError || err instanceof SqlExecutionError) || isLast) throw err;
          const detail = err.message;
          this.logger.debug(`Attempt ${attempts} failed: ${detail}`);
          messages.push({ role: 'assistant', content: text } satisfies ChatCompletionMessageParam, {
            role: 'user',
            content: `That query failed: ${detail}\nReturn a corrected query in a single \`\`\`sql block.`,
          });
        }
      }
    }

    let answer: string | null = null;
    if (input.answer && result && sql) {
      answer = await this.timed(timings, 'llmMs', () => this.phrase(input.question, sql!, result!, meter));
    }

    return this.finish(input, answerKey, started, timings, meter, {
      sql,
      answer,
      result,
      cache,
      attempts,
      ctx,
    });
  }

  private async phrase(
    question: string,
    sql: string,
    result: QueryResult,
    meter: UsageMeter,
  ): Promise<string> {
    if (result.rowCount === 0) return 'The query returned no rows.';
    // A single value needs no language model.
    if (result.rowCount === 1 && result.columns.length === 1) {
      return `**${result.columns[0].name}**: ${String(result.rows[0][0])}`;
    }
    const table = toPromptTable(result, this.config.get('ASK_ANSWER_MAX_ROWS'));
    const res = await this.llm.chat(
      { tier: 'fast', messages: answerMessages(question, sql, table), temperature: 0.2, maxTokens: 700 },
      meter,
    );
    return res.message.content?.trim() ?? '';
  }

  private finish(
    input: AskInput,
    answerKey: string,
    started: number,
    timings: { llmMs: number; dbMs: number },
    meter: UsageMeter,
    r: Pick<AskResponse, 'sql' | 'answer' | 'result' | 'cache' | 'attempts'> & {
      ctx: { tables: string[]; full: boolean };
    },
  ): AskResponse {
    const response: AskResponse = {
      question: input.question,
      sql: r.sql,
      answer: r.answer,
      result: r.result,
      cache: r.cache,
      attempts: r.attempts,
      schema: { tables: r.ctx.full ? [] : r.ctx.tables, full: r.ctx.full },
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

  private async timed<T>(
    t: { llmMs: number; dbMs: number },
    key: 'llmMs' | 'dbMs',
    fn: () => Promise<T>,
  ): Promise<T> {
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
