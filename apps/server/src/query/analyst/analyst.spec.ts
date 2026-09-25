import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { Model, ModelRequest, ModelResponse, StreamEvent } from '@openai/agents';
import { Usage } from '@openai/agents';
import { APIError } from 'openai';
import type { QueryResult } from '../../database/database.types.js';
import type { ColumnInfo, TableInfo } from '../../database/schema/schema.types.js';
import { buildPipeline, type Pipeline } from '../../eval/pipeline.js';
import { type AgentRoute, type AgentRouteHooks, FailoverAgentModel } from '../../llm/agent-model.js';
import { exportMdfToDuckDb } from '../../mdf/export-duckdb.js';
import { FakeOpenAI, type FakeReply } from '../../testing/fake-openai.js';
import { AnalystRun, type ChatEvent } from './analyst.run.js';
import type { ChatResponse } from './analyst.service.js';
import { columnValuesSql, describeResult, sqlHint } from './analyst.tools.js';

/**
 * The chat agent end to end: the real Agents SDK (Chat Completions adapter,
 * JSON and streamed) against a fake model server, and a real DuckDB file.
 */
const dir = mkdtempSync(join(tmpdir(), 'analyst-'));
let llm: FakeOpenAI;
let pipe: Pipeline;
let script: (body: Body) => FakeReply;

interface Message {
  role: string;
  content?: unknown;
  tool_calls?: { id: string; function: { name: string; arguments: string } }[];
}
type Body = Record<string, unknown> & { messages: Message[] };

const toolMessages = (b: Body) => b.messages.filter((m) => m.role === 'tool');
const lastTool = (b: Body) => String(toolMessages(b).at(-1)?.content ?? '');
const call = (name: string, args: object, id = `call_${name}_${Math.random().toString(36).slice(2, 7)}`) => ({ id, name, arguments: JSON.stringify(args) });
const sql = (title: string, text: string, display = 'table', chart: string | null = null) => call('run_sql', { title, sql: text, display, chart });

beforeAll(async () => {
  writeFileSync(join(dir, 'f.mdf'), gunzipSync(readFileSync(join(import.meta.dirname, '../../../test/fixtures/mdf/MdfFixture.mdf.gz'))));
  await exportMdfToDuckDb(join(dir, 'f.mdf'), join(dir, 'f.duckdb'));
  llm = new FakeOpenAI((body) => script(body as Body));
  const base = await llm.start();
  pipe = buildPipeline({
    NODE_ENV: 'test',
    DB_ENGINE: 'duckdb',
    DUCKDB_FILE: join(dir, 'f.duckdb'),
    SCHEMA_CACHE_FILE: join(dir, 'schema.json'),
    OPENAI_API_KEY: 'test',
    OPENAI_BASE_URL: base,
    LLM_PROVIDER: 'openai',
    AGENT_OPENAI_API: 'chat_completions',
    LLM_REASONING_EFFORT_FAST: 'low',
    REPORT_TIMEZONE: 'Asia/Karachi',
    LOG_LEVEL: 'error',
  });
});

afterAll(async () => {
  await pipe?.close();
  await llm?.stop();
});

const chat = (question: string, extra: Partial<Parameters<Pipeline['analyst']['chat']>[0]> = {}, opts?: Parameters<Pipeline['analyst']['chat']>[1]) =>
  pipe.analyst.chat({ question, context: [], language: 'auto', tier: 'fast', noCache: true, ...extra }, opts);

describe('chat agent', () => {
  it('talks without touching the database when no data is needed', async () => {
    const before = llm.requests.length;
    script = () => ({ content: 'Hi! Ask me about orders, for example **orders by shop**.' });
    const res = await chat('hi there, what can you do?');
    expect(res.answer).toContain('orders by shop');
    expect(res).toMatchObject({ results: [], steps: [], sql: null, result: null, display: null, attempts: 1, language: 'en' });
    const body = llm.requests[before] as Body;
    // Instructions carry the schema; the question carries today's date and the reply language.
    expect(String(body.messages[0].content)).toContain('sales.Orders');
    expect(JSON.stringify(body.messages.at(-1))).toMatch(/Today is \w+day, \d{4}-\d{2}-\d{2} \(Asia\/Karachi\)[\s\S]*Reply in English/);
    expect((body.tools as { function: { name: string } }[]).map((t) => t.function.name)).toEqual([
      'run_sql',
      'search_schema',
      'describe_tables',
      'column_values',
    ]);
    expect(body).toMatchObject({ reasoning_effort: 'low', parallel_tool_calls: true });
    expect(res.usage.llmCalls).toBe(1);
    expect(res.usage.calls[0].purpose).toBe('agent');
  });

  it('queries, then shows the result the way the model chose', async () => {
    script = (b) =>
      toolMessages(b).length === 0
        ? { toolCalls: [sql('Units by shop', 'SELECT shop, SUM(qty) AS units FROM sales.Orders GROUP BY shop ORDER BY shop', 'chart', 'bar')] }
        : { content: 'Shop **2** sold the most units (**7**).' };
    const res = await chat('which shop sells the most units? show a chart');
    const fed = lastTool(llm.requests.at(-1) as Body);
    expect(fed).toMatch(/^r1: 2 rows\nshop\tunits\n1\t4\n2\t7/);
    expect(res.answer).toBe('Shop **2** sold the most units (**7**).');
    expect(res.results).toHaveLength(1);
    expect(res.results[0]).toMatchObject({ id: 'r1', title: 'Units by shop', display: { view: 'chart', chart: 'bar' } });
    expect(res.results[0].result.rows).toEqual([[1, 4], [2, 7]]);
    expect(res.display).toEqual({ view: 'chart', chart: 'bar' });
    expect(res.sql).toContain('GROUP BY shop');
    expect(res.steps).toMatchObject([{ tool: 'run_sql', label: 'Units by shop', ok: true, rowCount: 2, resultId: 'r1' }]);
    expect(res.attempts).toBe(2);
    expect(res.timings.dbMs).toBeGreaterThanOrEqual(0);
  });

  it('recovers from a failed query using the hint it gets back', async () => {
    script = (b) => {
      const n = toolMessages(b).length;
      if (n === 0) return { toolCalls: [sql('Orders', 'SELECT nope FROM sales.Orders')] };
      if (n === 1) return { toolCalls: [sql('Orders', 'SELECT shop, order_no, qty FROM sales.Orders ORDER BY qty DESC')] };
      return { content: 'Here are the **3** orders.' };
    };
    const res = await chat('list all orders');
    const second = llm.requests.at(-2) as Body;
    expect(lastTool(second)).toMatch(/^r1 failed: [\s\S]*describe_tables/);
    expect(res.steps.map((s) => s.ok)).toEqual([false, true]);
    expect(res.results.map((r) => r.id)).toEqual(['r2']);
    expect(res.results[0].display).toEqual({ view: 'table' });
    expect(res.result?.rowCount).toBe(3);
  });

  it('refuses writes through the guard and says how to fix it', async () => {
    script = (b) => (toolMessages(b).length === 0 ? { toolCalls: [sql('Delete', 'DELETE FROM sales.Orders')] } : { content: 'I can only read data.' });
    const res = await chat('delete all orders');
    expect(lastTool(llm.requests.at(-1) as Body)).toMatch(/Rejected SQL[\s\S]*single read-only SELECT/);
    expect(res.results).toEqual([]);
    expect(res.steps[0]).toMatchObject({ tool: 'run_sql', ok: false });
  });

  it('looks up stored values, in parallel, before filtering', async () => {
    script = (b) =>
      toolMessages(b).length === 0
        ? {
            toolCalls: [
              call('column_values', { table: 'dbo.Dups', column: 'v', contains: null }, 'cv1'),
              call('column_values', { table: 'Dups', column: 'V', contains: 'B' }, 'cv2'),
              call('column_values', { table: 'dbo.Nope', column: 'v', contains: null }, 'cv3'),
            ],
          }
        : { content: 'The values are a, b and c.' };
    const res = await chat('what values does v have?');
    const outputs = toolMessages(llm.requests.at(-1) as Body).map((m) => String(m.content));
    expect(outputs[0]).toMatch(/dbo\.Dups\.v .*: value\trows\n/);
    expect(outputs[0]).toContain('a\t1');
    expect(outputs[0]).toContain('c\t1');
    expect(outputs[1]).toMatch(/\nb\t1$/);
    expect(outputs[2]).toMatch(/Unknown table "dbo.Nope"/);
    // Parallel calls report as they finish: the unknown table needs no query, so it may come first.
    expect(res.steps.map((s) => [s.tool, s.ok]).sort()).toEqual([
      ['column_values', false],
      ['column_values', true],
      ['column_values', true],
    ]);
  });

  it('streams progress and text, and drops a preamble written before tool calls', async () => {
    script = (b) =>
      toolMessages(b).length === 0
        ? { content: 'Let me check that.', toolCalls: [sql('Order count', 'SELECT COUNT(*) AS orders FROM sales.Orders', 'number')] }
        : { content: 'There are **3** orders in total, across 2 shops.' };
    const events: ChatEvent[] = [];
    const res = await chat('how many orders?', {}, { emit: (e) => events.push(e) });

    const types = events.map((e) => e.type);
    expect(types[0]).toBe('status');
    const reset = types.indexOf('reset');
    expect(reset).toBeGreaterThan(0);
    expect(types.slice(0, reset)).toContain('delta');
    expect(events).toContainEqual({ type: 'status', stage: 'query', label: 'Order count' });
    expect(events.find((e) => e.type === 'step')).toMatchObject({ step: { tool: 'run_sql', ok: true, rowCount: 1 } });

    // What a client shows: deltas since the last reset.
    let text = '';
    for (const e of events) {
      if (e.type === 'reset') text = '';
      if (e.type === 'delta') text += e.text;
    }
    expect(text).toBe(res.answer);
    expect(res.answer).toBe('There are **3** orders in total, across 2 shops.');
    expect(events.filter((e) => e.type === 'delta').length).toBeGreaterThan(2); // really streamed
    expect(res.results[0].display).toEqual({ view: 'number' });
  });

  it('answers from the evidence when the step budget runs out', async () => {
    script = (b) =>
      b.tool_choice === 'none'
        ? { content: 'So far: **3** orders; the rest is unknown.' }
        : { toolCalls: [sql(`Probe ${toolMessages(b).length}`, 'SELECT COUNT(*) AS n FROM sales.Orders', 'none')] };
    const events: ChatEvent[] = [];
    const res = await chat('dig deep into orders', {}, { maxTurns: 2, emit: (e) => events.push(e) });
    expect(res.answer).toBe('So far: **3** orders; the rest is unknown.');
    expect(events.filter((e) => e.type === 'delta').map((e) => (e as { text: string }).text).join('')).toBe(res.answer);
    expect(res.results).toEqual([]); // probes were display: none
  });

  it('sends earlier turns with their answers and SQL, and replies in the question language', async () => {
    script = () => ({ content: 'پچھلے مہینے 3 آرڈرز تھے۔' });
    const res = await chat('اور پچھلے مہینے؟', {
      context: [{ question: 'How many orders?', answer: 'There are 3 orders.', sql: 'SELECT COUNT(*) FROM sales.Orders' }],
    });
    const body = llm.requests.at(-1) as Body;
    const text = JSON.stringify(body.messages);
    expect(text).toContain('How many orders?');
    expect(text).toContain('Query behind this answer');
    expect(text).toContain('Reply in Urdu');
    expect(res.language).toBe('ur');
    expect(res.context.turns).toBe(1);
  });

  it('serves a repeated question from the answer cache', async () => {
    script = () => ({ content: 'Cached reply.' });
    const first = await chat('say something cacheable', { noCache: false });
    const before = llm.requests.length;
    const events: ChatEvent[] = [];
    const again = await chat('Say something cacheable?', { noCache: false }, { emit: (e) => events.push(e) });
    expect(llm.requests.length).toBe(before);
    expect(first.cache).toBeNull();
    expect(again).toMatchObject({ cache: 'answer', answer: 'Cached reply.' });
    expect(events).toEqual([{ type: 'delta', text: 'Cached reply.' }]);
  });

  it('drops a parameter the model rejects and remembers it', async () => {
    let rejected = false;
    script = (b) => {
      if ('parallel_tool_calls' in b) {
        rejected = true;
        return { status: 400, errorMessage: "Unsupported parameter: 'parallel_tool_calls' is not supported with this model.", param: 'parallel_tool_calls' };
      }
      return { content: 'ok' };
    };
    const res: ChatResponse = await chat('anything new?');
    expect(rejected).toBe(true);
    expect(res.answer).toBe('ok');
    const before = llm.requests.length;
    await chat('anything else?');
    expect(llm.requests.length).toBe(before + 1); // no second rejection
  });
});

describe('agent building blocks', () => {
  const result = (rows: unknown[][]): QueryResult => ({ columns: [{ name: 'n', type: 'int' }], rows, rowCount: rows.length, truncated: false, elapsedMs: 1 });

  it('shows displayed results only, dropping empty attempts that were replaced', () => {
    const run = new AnalystRun();
    run.addQuery({ title: 'check', sql: 's1', display: null, result: result([[1]]) });
    run.addQuery({ title: 'first try', sql: 's2', display: { view: 'table' }, result: result([]) });
    run.addQuery({ title: 'failed', sql: 's3', display: { view: 'table' }, error: 'boom' });
    run.addQuery({ title: 'fixed', sql: 's4', display: { view: 'table' }, result: result([[2]]) });
    run.addQuery({ title: 'chart', sql: 's5', display: { view: 'chart', chart: 'line' }, result: result([[3]]) });
    expect(run.shown().map((r) => r.title)).toEqual(['fixed', 'chart']);

    const empty = new AnalystRun();
    empty.addQuery({ title: 'really empty', sql: 's', display: { view: 'table' }, result: result([]) });
    expect(empty.shown().map((r) => r.title)).toEqual(['really empty']);
  });

  it('keeps at most three results', () => {
    const run = new AnalystRun();
    for (let i = 1; i <= 5; i++) run.addQuery({ title: `t${i}`, sql: 's', display: { view: 'table' }, result: result([[i]]) });
    expect(run.shown().map((r) => r.id)).toEqual(['r3', 'r4', 'r5']);
  });

  it('tells the model how to read results and fix errors', () => {
    expect(describeResult('r1', 'SELECT a FROM t WHERE b = 1', result([]), 10)).toMatch(/r1: no rows\. .*column_values/);
    expect(describeResult('r2', 'SELECT a FROM t', result([]), 10)).toBe('r2: no rows.');
    expect(describeResult('r3', 'SELECT n FROM t', { ...result([[1], [2]]), truncated: true }, 10)).toMatch(/^r3: 2\+ rows\nn\n1\n2/);
    expect(sqlHint('Binder Error: Referenced column "x" not found')).toMatch(/describe_tables/);
    expect(sqlHint("Invalid object name 'dbo.X'.")).toMatch(/search_schema/);
    expect(sqlHint('Rejected SQL: only SELECT / WITH queries are allowed')).toMatch(/read-only SELECT/);
  });

  it('builds value lookups from catalog identifiers with escaped patterns', () => {
    const t = { id: 'dbo.My Table', schema: 'dbo', name: 'My"Tab]le', kind: 'table', columns: [] } as unknown as TableInfo;
    const c = { name: 'na"me]', type: 'varchar' } as ColumnInfo;
    const duck = columnValuesSql(t, c, "O'Brien 100%_x\\", 'duckdb');
    expect(duck).toContain('FROM "dbo"."My""Tab]le"');
    expect(duck).toContain(`ILIKE '%O''Brien 100\\%\\_x\\\\%' ESCAPE '\\'`);
    expect(duck).toMatch(/LIMIT 41$/);
    const tsql = columnValuesSql(t, c, "O'Brien 100%_[x]", 'tsql');
    expect(tsql).toContain('FROM [dbo].[My"Tab]]le]');
    expect(tsql).toContain(`LIKE N'%O''Brien 100[%][_][[]x]%'`);
    expect(columnValuesSql(t, c, null, 'tsql')).not.toContain('LIKE');
  });
});

describe('FailoverAgentModel', () => {
  const response: ModelResponse = { usage: new Usage({ requests: 1, inputTokens: 10, outputTokens: 2 }), output: [] };
  const request = { input: 'hi', modelSettings: {}, tools: [], outputType: 'text', handoffs: [], tracing: false } as unknown as ModelRequest;

  function setup(adapters: Partial<Model>[], learnable = () => false) {
    const log: string[] = [];
    const routes: AgentRoute[] = adapters.map((a, i) => ({ provider: i ? 'openrouter' : 'openai', model: `m${i}`, adapter: a as Model, settings: {} }));
    const hooks: AgentRouteHooks = {
      prepare: (_r, req) => req,
      learn: (r) => (learnable() ? (log.push(`learn:${r.provider}`), true) : false),
      succeeded: async (r) => void log.push(`ok:${r.provider}`),
      failed: (r, err) => (log.push(`fail:${r.provider}`), err instanceof APIError && (err.status ?? 0) >= 500),
      toError: (err, _r, exhausted) => new Error(exhausted ? 'all failed' : `fatal: ${(err as Error).message}`),
    };
    return { model: new FailoverAgentModel(routes, hooks), log };
  }
  const apiError = (status: number) => new APIError(status, undefined, `status ${status}`, undefined);

  it('fails over on provider outages but not on bad requests', async () => {
    const down = setup([{ getResponse: async () => Promise.reject(apiError(503)) }, { getResponse: async () => response }]);
    await expect(down.model.getResponse(request)).resolves.toBe(response);
    expect(down.log).toEqual(['fail:openai', 'ok:openrouter']);

    const bad = setup([{ getResponse: async () => Promise.reject(apiError(400)) }, { getResponse: async () => response }]);
    await expect(bad.model.getResponse(request)).rejects.toThrow(/^fatal: .*status 400/);

    const all = setup([{ getResponse: async () => Promise.reject(apiError(500)) }, { getResponse: async () => Promise.reject(apiError(502)) }]);
    await expect(all.model.getResponse(request)).rejects.toThrow('all failed');
  });

  it('retries the same route after learning a fix', async () => {
    let calls = 0;
    let teach = true;
    const { model, log } = setup(
      [{ getResponse: async () => (++calls === 1 ? Promise.reject(apiError(400)) : response) }],
      () => (teach ? ((teach = false), true) : false),
    );
    await expect(model.getResponse(request)).resolves.toBe(response);
    expect(log).toEqual(['learn:openai', 'ok:openai']);
  });

  it('streams from the next route only if nothing was sent yet', async () => {
    const done: StreamEvent = { type: 'response_done', response: { id: 'x', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, output: [] } };
    const failing = {
      async *getStreamedResponse(): AsyncIterable<StreamEvent> {
        yield* [];
        throw apiError(503);
      },
    };
    const midway = {
      async *getStreamedResponse(): AsyncIterable<StreamEvent> {
        yield { type: 'output_text_delta', delta: 'Hel' };
        throw apiError(503);
      },
    };
    const good = {
      async *getStreamedResponse(): AsyncIterable<StreamEvent> {
        yield { type: 'output_text_delta', delta: 'Hello' };
        yield done;
      },
    };
    const collect = async (m: FailoverAgentModel) => {
      const seen: string[] = [];
      for await (const e of m.getStreamedResponse(request)) seen.push(e.type);
      return seen;
    };
    const fallback = setup([failing, good]);
    await expect(collect(fallback.model)).resolves.toEqual(['output_text_delta', 'response_done']);
    expect(fallback.log).toEqual(['fail:openai', 'ok:openrouter']);

    const started = setup([midway, good]);
    await expect(collect(started.model)).rejects.toThrow(/status 503/);
    expect(started.log).toEqual([]);
  });
});
