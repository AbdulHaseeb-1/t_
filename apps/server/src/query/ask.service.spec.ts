import { SqlExecutionError } from '../common/errors.js';
import type { DatabaseService } from '../database/database.service.js';
import { assertReadOnlySql } from '../database/sql-guard.js';
import type { QueryResult } from '../database/database.types.js';
import type { SchemaCatalogService } from '../database/schema/schema-catalog.service.js';
import type { LlmService } from '../llm/llm.service.js';
import type { ChatRequest } from '../llm/llm.types.js';
import { testConfig } from '../testing/fake-openai.js';
import { AskService, formatScalar, humanizeColumn } from './ask.service.js';
import { ExamplesService } from './examples.service.js';
import { TranslatorService } from './translator.service.js';
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

function setup(
  llmReplies: string[],
  dbImpl: (sql: string) => QueryResult,
  env: Record<string, string> = {},
  schemaFits = true,
) {
  const config = testConfig({ ASK_MAX_REPAIRS: '2', ...env });
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
    contextFor: vi.fn(async () => ({
      text: 'dbo.Orders | Id int PK',
      tables: ['dbo.Orders'],
      full: schemaFits,
      schemaHash: 'h1',
    })),
  } as unknown as SchemaCatalogService;
  const examples = new ExamplesService(config);
  const service = new AskService(
    config,
    db,
    catalog,
    llm,
    new QueryCacheService(config),
    examples,
    new TranslatorService(llm),
  );
  return { service, calls, db, llm, examples, catalog };
}

const ask = (question: string, extra = {}) => ({
  question,
  context: [],
  language: 'auto' as const,
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
      answer: 'Order count: **42**',
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

  it('answers a cached-SQL hit in the requested language, not English', async () => {
    // Regression: the SQL-cache path used to phrase every answer in English.
    const { service, calls } = setup(
      ['```sql\nSELECT COUNT(*) AS Customers FROM dbo.Customers\n```', 'Ap k 400 customers hain.'],
      () => ({ ...scalar, columns: [{ name: 'Customers', type: 'int' }] }),
    );
    const en = await service.ask(ask('How many customers do we have?'));
    expect(en.answer).toBe('Customers: **42**');
    const roman = await service.ask(ask('How many customers do we have?', { language: 'ur-Latn' }));
    expect(roman).toMatchObject({ cache: 'sql', language: 'ur-Latn', answer: 'Ap k 400 customers hain.' });
    expect(JSON.stringify(calls.at(-1)!.messages)).toMatch(/Roman Urdu/);
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

  it('confirms a refusal with the smart tier before returning it, without touching the database', async () => {
    const refusal = '```sql\n-- CANNOT_ANSWER: no weather data\n```';
    const { service, db, calls } = setup([refusal, refusal], () => scalar);
    const r = await service.ask(ask("what's the weather"));
    expect(r).toMatchObject({ sql: null, result: null, answer: expect.stringContaining('no weather data') });
    expect(calls.map((c) => c.tier)).toEqual(['fast', 'smart']);
    expect(db.readOnlyQuery).not.toHaveBeenCalled();
  });

  it('lets the smart tier overturn an over-eager fast-tier refusal', async () => {
    const { service, calls } = setup(
      ['```sql\n-- CANNOT_ANSWER: no revenue column\n```', '```sql\nSELECT 1 AS OrderCount\n```'],
      () => scalar,
    );
    const r = await service.ask(ask('top products by revenue'));
    expect(r).toMatchObject({ sql: 'SELECT 1 AS OrderCount', attempts: 2 });
    expect(calls.map((c) => c.tier)).toEqual(['fast', 'smart']);
  });

  it('votes between parallel candidates by result, not by SQL text', async () => {
    const { service, calls } = setup(
      [
        '```sql\nSELECT 1 AS wrong\n```',
        '```sql\nSELECT Country, Revenue FROM a\n```',
        '```sql\nSELECT Revenue, Country FROM b\n```',
      ],
      (sql) =>
        sql.includes('wrong')
          ? scalar
          : {
              ...table,
              columns: [...table.columns],
              rows: sql.includes('FROM b') ? table.rows.map((r) => [...r].reverse()) : table.rows,
            },
      { ASK_SQL_CANDIDATES: '3' },
    );
    const r = await service.ask(ask('revenue by country', { answer: false }));
    expect(r.sql).toBe('SELECT Country, Revenue FROM a');
    expect(r.trace).toMatchObject({ candidates: 3, votes: 3, agreement: 2 });
    expect(calls).toHaveLength(3);
  });

  it('rechecks text filters once when a query returns no rows', async () => {
    const empty = { ...table, rows: [], rowCount: 0 };
    const { service, calls } = setup(
      [
        "```sql\nSELECT * FROM x WHERE Country = 'Pakistan'\n```",
        "```sql\nSELECT * FROM x WHERE Country = 'PK'\n```",
      ],
      (sql) => (sql.includes("'PK'") ? table : empty),
    );
    const r = await service.ask(ask('revenue in Pakistan', { answer: false }));
    expect(r.sql).toContain("'PK'");
    expect(r.trace).toMatchObject({ emptyRecheck: true, escalated: true });
    expect(calls[1].tier).toBe('smart');
    expect(String(calls[1].messages.at(-1)?.content)).toContain('returned no rows');
  });

  it('keeps a genuinely empty result when the recheck returns the same query', async () => {
    const empty = { ...table, rows: [], rowCount: 0 };
    const q = "```sql\nSELECT * FROM x WHERE Status = 'Lost'\n```";
    const { service } = setup([q, q], () => empty);
    const r = await service.ask(ask('lost orders', { answer: false }));
    expect(r).toMatchObject({ result: { rowCount: 0 }, trace: { emptyRecheck: true } });
    expect(r.usage.llmCalls).toBe(2);
  });

  it('injects the closest verified examples after the cacheable prefix', async () => {
    const { service, calls, examples } = setup(['```sql\nSELECT 1 AS OrderCount\n```'], () => scalar, {
      ASK_FEWSHOT_K: '3',
    });
    examples.replaceAll([{ question: 'Revenue by country last year', sql: 'SELECT 42' }]);
    const r = await service.ask(ask('revenue by country this year', { answer: false }));
    expect(r.trace.examples).toBe(1);
    expect(calls[0].messages.map((m) => m.role)).toEqual(['system', 'system', 'system', 'user']);
    expect(String(calls[0].messages[2].content)).toContain('SELECT 42');
  });

  it('passes earlier turns as dialogue and keys the cache on them', async () => {
    const reply = '```sql\nSELECT 1 AS OrderCount\n```';
    const { service, calls } = setup([reply, reply], () => scalar);
    const context = [{ question: 'Revenue by country in 2025', sql: 'SELECT 2025' }];
    await service.ask(ask('and for 2024?', { context, answer: false }));
    expect(calls[0].messages.slice(-3)).toEqual([
      { role: 'user', content: 'Revenue by country in 2025' },
      { role: 'assistant', content: '```sql\nSELECT 2025\n```' },
      { role: 'user', content: 'and for 2024?' },
    ]);
    // Same words, different conversation: must not reuse the cached SQL.
    const other = await service.ask(ask('and for 2024?', { answer: false }));
    expect(other.cache).toBeNull();
    expect(calls).toHaveLength(2);
  });

  it('phrases single values without a model call', () => {
    expect(humanizeColumn('CustomerCount')).toBe('Customer count');
    expect(humanizeColumn('total_net_revenue')).toBe('Total net revenue');
    expect(humanizeColumn('AvgOrderUSD')).toBe('Avg order usd');
    expect(formatScalar(7525868.5)).toBe('7,525,868.5');
    expect(formatScalar(2.666666)).toBe('2.6667');
    expect(formatScalar(null)).toBe('no value');
  });

  it('answers Urdu in Urdu from the original question when the schema fits (no translation)', async () => {
    const { service, calls } = setup(
      ["```sql\nSELECT COUNT(*) AS n FROM c WHERE CountryCode = 'PK'\n```", 'پاکستان میں 42 گاہک ہیں۔'],
      () => scalar,
    );
    const r = await service.ask(ask('پاکستان میں ہمارے کتنے گاہک ہیں؟'));
    expect(r).toMatchObject({ language: 'ur', answer: 'پاکستان میں 42 گاہک ہیں۔' });
    expect(r.translatedQuestion).toBeUndefined();
    // 1) SQL from the Urdu original, 2) Urdu phrasing (no English scalar shortcut).
    expect(calls).toHaveLength(2);
    const sqlTurn = String(calls[0].messages.at(-1)?.content);
    expect(sqlTurn.startsWith('پاکستان میں ہمارے کتنے گاہک ہیں؟')).toBe(true);
    expect(sqlTurn).toContain('CANNOT_ANSWER reason in Urdu');
    expect(String(calls[1].messages.at(-1)?.content)).toContain('Write the whole answer in Urdu script');
  });

  it('translates only to pick tables when the schema is too large to send whole', async () => {
    const { service, calls, catalog } = setup(
      ['How many customers are based in Pakistan?', '```sql\nSELECT 1 AS n\n```', 'پاکستان میں 42 گاہک ہیں۔'],
      () => scalar,
      {},
      false,
    );
    const r = await service.ask(ask('پاکستان میں ہمارے کتنے گاہک ہیں؟'));
    expect(r.translatedQuestion).toBe('How many customers are based in Pakistan?');
    expect(catalog.contextFor).toHaveBeenLastCalledWith('How many customers are based in Pakistan?');
    // The SQL model still sees the original Urdu question.
    expect(String(calls[1].messages.at(-1)?.content).startsWith('پاکستان میں')).toBe(true);
  });

  it('refuses and reports empty results in the question language', async () => {
    const refusal = '```sql\n-- CANNOT_ANSWER: عمر کا ڈیٹا موجود نہیں\n```';
    const { service } = setup([refusal, refusal], () => scalar);
    const r = await service.ask(ask('ہمارے گاہکوں کی اوسط عمر کیا ہے؟'));
    expect(r.answer).toBe('اس ڈیٹا بیس سے اس سوال کا جواب نہیں دیا جا سکتا: عمر کا ڈیٹا موجود نہیں');
  });

  it('can skip translation (ablation switch) and honours an explicit language', async () => {
    const { service, calls } = setup(['```sql\nSELECT 1 AS n\n```', 'Jawab: 42'], () => scalar, {
      ASK_TRANSLATE_NON_ENGLISH: 'false',
    });
    const r = await service.ask(ask('Pakistan mein kitne customers hain?', { language: 'ur-Latn' }));
    expect(r.language).toBe('ur-Latn');
    expect(calls).toHaveLength(2);
    expect(String(calls[1].messages.at(-1)?.content)).toContain('Roman Urdu');
  });
});
