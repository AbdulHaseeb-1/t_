import { createHash } from 'node:crypto';
import { BadGatewayException, HttpException, Injectable, Logger } from '@nestjs/common';
import {
  Agent,
  type AgentInputItem,
  AgentsError,
  assistant,
  type NonStreamRunOptions,
  type RunErrorHandlers,
  Runner,
  setTracingDisabled,
  user,
} from '@openai/agents';
import { AppConfig } from '../../config/app-config.js';
import { DatabaseService } from '../../database/database.service.js';
import type { QueryResult } from '../../database/database.types.js';
import { SchemaCatalogService } from '../../database/schema/schema-catalog.service.js';
import { LlmService } from '../../llm/llm.service.js';
import { UsageMeter, type UsageSummary } from '../../llm/llm.types.js';
import { todayIn } from '../../reports/template.js';
import { detectLanguage, type Lang, PHRASES } from '../language.js';
import { normalizeQuestion, QueryCacheService } from '../query-cache.service.js';
import type { ChatInput, ChatTurn } from '../query.dto.js';
import { TranslatorService } from '../translator.service.js';
import { analystInstructions, analystQuestion, STEP_BUDGET_REACHED } from './analyst.prompts.js';
import { type AgentStep, AnalystRun, type Display, type Emit, type ShownResult } from './analyst.run.js';
import { analystTools } from './analyst.tools.js';

export interface ChatResponse {
  question: string;
  /** Language the answer is written in. */
  language: Lang;
  /** English form used to find tables, when the question was not in English and the schema is large. */
  translatedQuestion?: string;
  answer: string;
  /** The first displayed result (older clients read only these). */
  sql: string | null;
  result: QueryResult | null;
  display: Display | null;
  /** Every result shown under the answer, each with how to present it. */
  results: ShownResult[];
  /** Every tool call, in order. */
  steps: AgentStep[];
  cache: 'answer' | null;
  /** Model turns (1 = answered without tools). */
  attempts: number;
  schema: { tables: string[]; full: boolean; tableCount: number; chars: number; approxTokens: number };
  context: { turns: number; engine: 'mssql' | 'duckdb' };
  timings: { totalMs: number; llmMs: number; dbMs: number; mediaMs?: number };
  usage: UsageSummary;
}

export interface ChatOptions {
  /** Streams progress and answer text as it is written. */
  emit?: Emit;
  signal?: AbortSignal;
  /** English form of the question when known (read from an image). */
  englishQuestion?: string;
  /** Model turns for this run (default AGENT_MAX_STEPS). */
  maxTurns?: number;
}

type AnalystAgent = Agent<AnalystRun, 'text'>;

/** An earlier turn as the model sees it: the answer, then the query behind it for follow-ups. */
function turnReply(t: ChatTurn): string {
  const answer = t.answer?.trim().slice(0, 1500) || '(answered)';
  return t.sql ? `${answer}\n\n(Query behind this answer, for reference:\n${t.sql})` : answer;
}

/**
 * The conversational data assistant, built on the OpenAI Agents SDK: it decides
 * whether a message needs data at all, explores the schema, writes and checks
 * SQL through tools, chooses how each result is shown (number, table, chart),
 * and streams its answer. One-shot SQL for reports and the eval harness stays
 * in AskService.
 */
@Injectable()
export class AnalystService {
  private readonly logger = new Logger(AnalystService.name);
  private readonly runner: Runner;
  private readonly tools;

  constructor(
    private readonly config: AppConfig,
    private readonly db: DatabaseService,
    private readonly catalog: SchemaCatalogService,
    private readonly llm: LlmService,
    private readonly cache: QueryCacheService,
    private readonly translator: TranslatorService,
  ) {
    const tracing = config.get('AGENT_TRACING');
    // Traces would copy questions and results to the OpenAI dashboard: opt-in only.
    if (!tracing) setTracingDisabled(true);
    this.runner = new Runner({ tracingDisabled: !tracing, traceIncludeSensitiveData: false, workflowName: 'Data chat' });
    this.tools = analystTools({ config, db, catalog });
  }

  async chat(input: ChatInput, opts: ChatOptions = {}): Promise<ChatResponse> {
    const started = performance.now();
    const meter = new UsageMeter();
    const emit: Emit = opts.emit ?? (() => undefined);
    const lang: Lang = input.language !== 'auto' ? input.language : detectLanguage(input.question);
    const history = input.context.slice(-this.config.get('AGENT_HISTORY_TURNS'));
    const schemaHash = await this.catalog.hash();

    const historyKey = history.length
      ? `:${createHash('sha1').update(JSON.stringify(history)).digest('hex').slice(0, 12)}`
      : '';
    const key = `chat:${schemaHash}:${input.tier}:${lang}:${normalizeQuestion(opts.englishQuestion ?? input.question)}${historyKey}`;
    if (!input.noCache) {
      const hit = this.cache.getAnswer<ChatResponse>(key);
      if (hit) {
        emit({ type: 'delta', text: hit.answer });
        return { ...hit, cache: 'answer', timings: { totalMs: this.ms(started), llmMs: 0, dbMs: 0 }, usage: meter.summary() };
      }
    }
    emit({ type: 'status', stage: 'thinking' });

    // Keyword retrieval needs English words; translate only when the schema is too big to send whole.
    // A follow-up ("and last month?") names no tables itself: the previous turn's question and SQL do.
    const previous = history.at(-1);
    const retrieval = (q: string) => (previous ? [q, previous.question, previous.sql ?? ''].join('\n') : q);
    let ctx = await this.catalog.contextFor(retrieval(opts.englishQuestion ?? input.question));
    let english = opts.englishQuestion;
    if (!ctx.full && !english && lang !== 'en' && this.config.get('ASK_TRANSLATE_NON_ENGLISH')) {
      english = await this.translator.toEnglish(input.question, lang, meter);
      ctx = await this.catalog.contextFor(retrieval(english));
    }
    const snapshot = await this.catalog.snapshot();
    const timezone = this.config.get('REPORT_TIMEZONE');

    const agent: AnalystAgent = new Agent<AnalystRun, 'text'>({
      name: 'Data assistant',
      instructions: analystInstructions({
        dialect: this.db.dialect,
        database: snapshot.database,
        schema: ctx.text,
        maxRows: this.config.get('DB_MAX_ROWS'),
        fullSchema: ctx.full,
      }),
      model: this.llm.agentModel(
        {
          tier: input.tier,
          reasoningEffort: this.config.get('AGENT_REASONING_EFFORT'),
          cacheKey: `chat:${schemaHash}`,
          purpose: 'agent',
        },
        meter,
      ),
      modelSettings: { parallelToolCalls: true },
      tools: this.tools,
    });

    const items: AgentInputItem[] = history.flatMap((t) => [user(t.question), assistant(turnReply(t))]);
    items.push(
      user(
        analystQuestion(input.question, {
          today: todayIn(timezone),
          weekday: new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: timezone }).format(new Date()),
          timezone,
          lang,
          englishQuestion: english,
        }),
      ),
    );

    const run = new AnalystRun(emit, this.config.get('AGENT_MAX_QUERIES'));
    const errorHandlers: RunErrorHandlers<AnalystRun, AnalystAgent> = {
      // Out of steps: one more model turn without tools turns the evidence gathered into an answer.
      maxTurns: async ({ runData }) => {
        run.degraded = true;
        const final = await this.runner.run(
          agent.clone({ modelSettings: { ...agent.modelSettings, toolChoice: 'none' } }),
          [...runData.history, user(STEP_BUDGET_REACHED)],
          { context: run, maxTurns: 1, signal: opts.signal, reasoningItemIdPolicy: 'omit' },
        );
        return { finalOutput: String(final.finalOutput ?? ''), includeInHistory: false };
      },
    };
    const runOptions: NonStreamRunOptions<AnalystRun, AnalystAgent> = {
      context: run,
      maxTurns: opts.maxTurns ?? this.config.get('AGENT_MAX_STEPS'),
      signal: opts.signal,
      reasoningItemIdPolicy: 'omit',
      toolNotFoundBehavior: 'return_error_to_model',
      errorHandlers,
    };

    let answer: string;
    let turns: number;
    try {
      if (opts.emit) {
        ({ answer, turns } = await this.streamRun(agent, items, runOptions, emit));
      } else {
        const result = await this.runner.run(agent, items, runOptions);
        answer = String(result.finalOutput ?? '').trim();
        turns = result.rawResponses.length;
      }
    } catch (err) {
      throw this.toHttpError(err);
    }

    const results = run.shown();
    if (!answer) {
      run.degraded = true;
      answer = results.length ? PHRASES[lang].found : PHRASES[lang].noAnswer;
      emit({ type: 'delta', text: answer });
    }
    const primary = results[0];
    const llmMs = meter.calls.reduce((ms, c) => ms + c.latencyMs, 0);
    const response: ChatResponse = {
      question: input.question,
      language: lang,
      ...(english && english !== input.question ? { translatedQuestion: english } : {}),
      answer,
      sql: primary?.sql ?? null,
      result: primary?.result ?? null,
      display: primary?.display ?? null,
      results,
      steps: run.steps,
      cache: null,
      attempts: turns,
      schema: {
        tables: ctx.full ? [] : ctx.tables,
        full: ctx.full,
        tableCount: ctx.tables.length,
        chars: ctx.text.length,
        approxTokens: Math.round(ctx.text.length / 3.5),
      },
      context: { turns: history.length, engine: this.db.dialect === 'duckdb' ? 'duckdb' : 'mssql' },
      timings: { totalMs: this.ms(started), llmMs: Math.round(llmMs), dbMs: Math.round(run.dbMs) },
      usage: meter.summary(),
    };
    // A stopgap answer must not be replayed to a retry once the cause (outage, budget) has passed.
    if (!run.degraded) this.cache.setAnswer(key, response);
    return response;
  }

  /**
   * Streams answer text as the model writes it. Text written in a turn that
   * ends in tool calls was a preamble, not the answer: the client is told to
   * drop it. Whatever was streamed is reconciled with the final answer.
   */
  private async streamRun(
    agent: AnalystAgent,
    items: AgentInputItem[],
    options: NonStreamRunOptions<AnalystRun, AnalystAgent>,
    emit: Emit,
  ): Promise<{ answer: string; turns: number }> {
    const stream = await this.runner.run(agent, items, { ...options, stream: true });
    let streamed = '';
    let turns = 0;
    for await (const event of stream) {
      if (event.type === 'raw_model_stream_event') {
        if (event.data.type === 'response_started') {
          // A new model turn after tool results: the model is thinking again.
          if (turns++ > 0 && !streamed) emit({ type: 'status', stage: 'thinking' });
        } else if (event.data.type === 'output_text_delta' && event.data.delta) {
          streamed += event.data.delta;
          emit({ type: 'delta', text: event.data.delta });
        }
      } else if (event.type === 'run_item_stream_event' && event.name === 'tool_called' && streamed) {
        streamed = '';
        emit({ type: 'reset' });
      }
    }
    await stream.completed;
    if (stream.error) throw stream.error;
    const answer = String(stream.finalOutput ?? '').trim();
    if (answer !== streamed.trim()) {
      // e.g. the step-budget answer, which is not streamed.
      if (streamed) emit({ type: 'reset' });
      if (answer) emit({ type: 'delta', text: answer });
    }
    return { answer, turns: Math.max(turns, stream.rawResponses.length) };
  }

  private toHttpError(err: unknown): unknown {
    if (err instanceof HttpException) return err;
    if (err instanceof AgentsError) {
      this.logger.warn(`Agent run failed: ${err.message}`);
      return new BadGatewayException({ message: `The model could not complete the answer: ${err.message}`, code: 'AGENT_FAILED' });
    }
    return err;
  }

  private ms(started: number): number {
    return Math.round(performance.now() - started);
  }
}
