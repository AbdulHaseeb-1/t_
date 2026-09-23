import { SqlExecutionError } from '../common/errors.js';
import type { DatabaseService } from '../database/database.service.js';
import { assertReadOnlySql } from '../database/sql-guard.js';
import type { QueryResult } from '../database/database.types.js';
import type { SchemaCatalogService } from '../database/schema/schema-catalog.service.js';
import type { LlmService } from '../llm/llm.service.js';
import type { ChatRequest } from '../llm/llm.types.js';
import { testConfig } from '../testing/fake-openai.js';
import { AskService } from './ask.service.js';
import { QueryCacheService } from './query-cache.service.js';

const scalar: QueryResult = {
  columns: [{ name: 'OrderCount', type: 'int' }],
  rows: [[42]],
  rowCount: 1,
  truncated: false,
  elapsedMs: 3,
};
const table: QueryResult = {
  columns: [
    { name: 'Country', type: 'nvarchar' },
    { name: 'Revenue', type: 'decimal' },
  ],
  rows: [
    ['PK', 100],
    ['AE', 50],
  ],
  rowCount: 2,
  truncated: false,
  elapsedMs: 4,
};

function setup(llmReplies: string[], dbImpl: (sql: string) => QueryResult) {
  const config = testConfig({ ASK_MAX_REPAIRS: '2' });
  const calls: ChatRequest[] = [];
  const llm = {
    chat: vi.fn(async (req: ChatRequest, meter?: { add: (u: unknown) => void }) => {
      calls.push(structuredClone(req));
      meter?.add({
        provider: 'openai',
        model: req.tier,
        promptTokens: 10,
        cachedPromptTokens: 0,
        completionTokens: 5,
        costUsd: 0.0001,
        latencyMs: 1,
      });
      return { message: { role: 'assistant', content: llmReplies.shift() ?? '' } };
    }),
  } as unknown as LlmService;
  const db = {
    readOnlyQuery: vi.fn(async (sql: string) => {
      const r = dbImpl(sql);
      return r;
    }),
  } as unknown as DatabaseService;
  const catalog = {
    hash: async () => 'h1',
    snapshot: async () => ({ database: 'Shop', generatedAt: '', tables: [] }),
    contextFor: async () => ({
      text: 'dbo.Orders | Id int PK',
      tables: ['dbo.Orders'],
      full: true,
      schemaHash: 'h1',
    }),
  } as unknown as SchemaCatalogService;
  const service = new AskService(config, db, catalog, llm, new QueryCacheService(config));
  return { service, calls, db, llm };
}

const ask = (question: string, extra = {}) => ({
  question,
  answer: true,
  tier: 'fast' as const,
  noCache: false,
  ...extra,
});

describe('AskService', () => {
  it('answers a scalar question with one LLM call and serves repeats from cache', async () => {
    const { service, calls, db } = setup(
      ['```sql\nSELECT COUNT(*) AS OrderCount FROM dbo.Orders\n```'],
      () => scalar,
    );

    const first = await service.ask(ask('How many orders?'));
    expect(first).toMatchObject({
      sql: 'SELECT COUNT(*) AS OrderCount FROM dbo.Orders',
      answer: '**OrderCount**: 42',
      cache: null,
      attempts: 1,
    });
    expect(first.usage.llmCalls).toBe(1);
    expect(calls[0]).toMatchObject({ tier: 'fast', temperature: 0, cacheKey: 'sql:h1' });

    const again = await service.ask(ask('how many ORDERS'));
    expect(again.cache).toBe('answer');
    expect(again.usage.llmCalls).toBe(0);
    expect(db.readOnlyQuery).toHaveBeenCalledTimes(1);
  });

  it('reuses cached SQL (fresh data, no tokens) when the answer cache is bypassed', async () => {
    const { service, llm, db } = setup(['```sql\nSELECT 1 AS OrderCount\n```'], () => scalar);
    await service.ask(ask('orders count', { answer: false }));
    const r = await service.ask(ask('orders count', { answer: true }));
    expect(r.cache).toBe('sql');
    expect(llm.chat).toHaveBeenCalledTimes(1);
    expect(db.readOnlyQuery).toHaveBeenCalledTimes(2);
  });

  it('repairs failing SQL and escalates the final attempt to the smart tier', async () => {
    const { service, calls } = setup(
      [
        '```sql\nSELECT bad1\n```',
        '```sql\nSELECT bad2\n```',
        '```sql\nSELECT Country, Revenue FROM x\n```',
        'PK leads with 100.',
      ],
      (sql) => {
        if (sql.includes('bad')) throw new SqlExecutionError(`Invalid column name '${sql.slice(7)}'.`, sql);
        return table;
      },
    );
    const r = await service.ask(ask('revenue by country'));
    expect(r.attempts).toBe(3);
    expect(r.answer).toBe('PK leads with 100.');
    expect(calls.map((c) => c.tier)).toEqual(['fast', 'fast', 'smart', 'fast']);
    const repairTurn = calls[2].messages.at(-1);
    expect(repairTurn).toMatchObject({ role: 'user' });
    expect(String(repairTurn?.content)).toContain("Invalid column name 'bad2'");
  });

  it('gives up after the repair budget', async () => {
    const { service } = setup(Array(3).fill('```sql\nSELECT nope\n```'), (sql) => {
      throw new SqlExecutionError('boom', sql);
    });
    await expect(service.ask(ask('anything at all'))).rejects.toThrow('boom');
  });

  it('turns unsafe SQL into a repair turn, never an execution', async () => {
    const { service, calls } = setup(
      ['```sql\nDELETE FROM dbo.Orders\n```', '```sql\nSELECT COUNT(*) AS OrderCount FROM dbo.Orders\n```'],
      (sql) => {
        assertReadOnlySql(sql); // what the real DatabaseService does before touching the DB
        return scalar;
      },
    );
    const r = await service.ask(ask('remove orders'));
    expect(r.attempts).toBe(2);
    expect(String(calls[1].messages.at(-1)?.content)).toContain('only SELECT');
  });

  it('returns a refusal without touching the database', async () => {
    const { service, db } = setup(['```sql\n-- CANNOT_ANSWER: no weather data\n```'], () => scalar);
    const r = await service.ask(ask("what's the weather"));
    expect(r).toMatchObject({ sql: null, result: null, answer: expect.stringContaining('no weather data') });
    expect(db.readOnlyQuery).not.toHaveBeenCalled();
  });
});
