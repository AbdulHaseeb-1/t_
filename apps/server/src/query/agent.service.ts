import { Injectable, Logger } from '@nestjs/common';
import type {
  ChatCompletionMessageFunctionToolCall,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';
import { AppConfig } from '../config/app-config.js';
import { DatabaseService } from '../database/database.service.js';
import { renderTables } from '../database/schema/schema-renderer.js';
import { SchemaCatalogService } from '../database/schema/schema-catalog.service.js';
import { LlmService } from '../llm/llm.service.js';
import { UsageMeter, type UsageSummary } from '../llm/llm.types.js';
import { detectLanguage, LANGUAGE_NAME, type Lang } from './language.js';
import { agentSystem } from './prompts.js';
import { normalizeQuestion, QueryCacheService } from './query-cache.service.js';
import type { AnalyzeInput } from './query.dto.js';
import { toPromptTable } from './result-format.js';

const TOOLS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'run_sql',
      description: 'Run one read-only SELECT (in the database\'s SQL dialect) and get the result as TSV (sampled if large).',
      parameters: {
        type: 'object',
        properties: {
          sql: { type: 'string', description: 'A single SELECT or WITH ... SELECT statement.' },
          purpose: { type: 'string', description: 'What this query establishes, in a few words.' },
        },
        required: ['sql'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_schema',
      description: 'Find tables relevant to a topic. Returns full column details for the best matches.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'describe_tables',
      description: 'Get columns, keys and row counts for specific tables by schema.table name.',
      parameters: {
        type: 'object',
        properties: { tables: { type: 'array', items: { type: 'string' } } },
        required: ['tables'],
        additionalProperties: false,
      },
    },
  },
];

interface Step {
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
  rowCount?: number;
  elapsedMs?: number;
  error?: string;
}

export interface AnalyzeResponse {
  question: string;
  answer: string;
  steps: Step[];
  cached: boolean;
  timings: { totalMs: number };
  usage: UsageSummary;
}

/**
 * Multi-step analysis for questions one query cannot answer (comparisons,
 * drill-downs, "why" questions). Bounded by AGENT_MAX_STEPS; tool results are
 * compressed to TSV samples + stats to keep the context, and the bill, small.
 */
@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(
    private readonly config: AppConfig,
    private readonly db: DatabaseService,
    private readonly catalog: SchemaCatalogService,
    private readonly llm: LlmService,
    private readonly cache: QueryCacheService,
  ) {}

  async analyze(input: AnalyzeInput): Promise<AnalyzeResponse> {
    const started = performance.now();
    const meter = new UsageMeter();
    const schemaHash = await this.catalog.hash();
    const key = `agent:${schemaHash}:${input.tier}:${input.language}:${normalizeQuestion(input.question)}`;
    if (!input.noCache) {
      const hit = this.cache.getAnswer<AnalyzeResponse>(key);
      if (hit) return { ...hit, cached: true, timings: { totalMs: 0 }, usage: meter.summary() };
    }

    const lang: Lang = input.language !== 'auto' ? input.language : detectLanguage(input.question);
    const snapshot = await this.catalog.snapshot();
    const ctx = await this.catalog.contextFor(input.question);
    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: agentSystem(this.db.dialect) },
      {
        role: 'system',
        content: `Database: ${snapshot.database}\nSchema (schema.table ~rows | column type [PK] [->referenced column]):\n${ctx.text}`,
      },
      {
        role: 'user',
        content:
          lang === 'en'
            ? input.question
            : `${input.question}\n\nWrite the final answer in ${LANGUAGE_NAME[lang]}.`,
      },
    ];

    const maxSteps = input.maxSteps ?? this.config.get('AGENT_MAX_STEPS');
    const steps: Step[] = [];
    let answer = '';

    for (let turn = 0; turn < maxSteps; turn++) {
      const res = await this.llm.chat(
        {
          tier: input.tier,
          messages,
          tools: TOOLS,
          purpose: 'agent',
          temperature: 0,
          cacheKey: `agent:${schemaHash}`,
        },
        meter,
      );
      const msg = res.message;
      const calls = (msg.tool_calls ?? []).filter(
        (c): c is ChatCompletionMessageFunctionToolCall => c.type === 'function',
      );
      if (calls.length === 0) {
        answer = msg.content?.trim() ?? '';
        break;
      }

      messages.push({ role: 'assistant', content: msg.content ?? null, tool_calls: calls });
      // Independent tool calls run concurrently.
      const outputs = await Promise.all(calls.map((c) => this.runTool(c)));
      calls.forEach((c, i) => {
        steps.push(outputs[i].step);
        messages.push({ role: 'tool', tool_call_id: c.id, content: outputs[i].content });
      });
    }

    if (!answer) {
      // Step budget exhausted: force a final answer from what was gathered.
      messages.push({
        role: 'user',
        content: 'Step budget reached. Give your best final answer now from the evidence gathered.',
      });
      const res = await this.llm.chat({ tier: input.tier, messages, temperature: 0 }, meter);
      answer = res.message.content?.trim() ?? '';
    }

    const response: AnalyzeResponse = {
      question: input.question,
      answer,
      steps,
      cached: false,
      timings: { totalMs: Math.round(performance.now() - started) },
      usage: meter.summary(),
    };
    this.cache.setAnswer(key, response);
    return response;
  }

  private async runTool(
    call: ChatCompletionMessageFunctionToolCall,
  ): Promise<{ content: string; step: Step }> {
    const tool = call.function.name;
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(call.function.arguments || '{}') as Record<string, unknown>;
    } catch {
      return {
        content: 'Error: arguments were not valid JSON.',
        step: { tool, args: {}, ok: false, error: 'invalid JSON arguments' },
      };
    }

    try {
      switch (tool) {
        case 'run_sql': {
          const r = await this.db.readOnlyQuery(String(args.sql ?? ''));
          return {
            content:
              r.rowCount === 0 ? '(no rows)' : toPromptTable(r, this.config.get('ASK_ANSWER_MAX_ROWS')),
            step: { tool, args, ok: true, rowCount: r.rowCount, elapsedMs: r.elapsedMs },
          };
        }
        case 'search_schema': {
          const tables = await this.catalog.search(String(args.query ?? ''), 8);
          return {
            content: tables.length ? renderTables(tables) : 'No matching tables.',
            step: { tool, args, ok: true },
          };
        }
        case 'describe_tables': {
          const ids = Array.isArray(args.tables) ? args.tables.map(String) : [];
          return { content: await this.catalog.describe(ids), step: { tool, args, ok: true } };
        }
        default:
          return {
            content: `Error: unknown tool ${tool}`,
            step: { tool, args, ok: false, error: 'unknown tool' },
          };
      }
    } catch (err) {
      const message = (err as Error).message;
      this.logger.debug(`Tool ${tool} failed: ${message}`);
      // Errors go back to the model so it can correct itself.
      return { content: `Error: ${message}`, step: { tool, args, ok: false, error: message } };
    }
  }
}
