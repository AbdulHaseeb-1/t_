import { readFile } from 'node:fs/promises';
import { rm } from 'node:fs/promises';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import sql from 'mssql';
import { FakeOpenAI } from '../src/testing/fake-openai.js';
import { configureApp } from '../src/configure-app.js';

/**
 * Full stack against a real SQL Server with a synthetic database.
 * Run with E2E_DB_HOST / E2E_DB_PASSWORD set (see README); skipped otherwise.
 */
const host = process.env.E2E_DB_HOST;
const password = process.env.E2E_DB_PASSWORD ?? '';
const DB = 'E2E_Shop';
const CACHE_FILE = '.cache/e2e-schema.json';

describe.skipIf(!host)('server e2e (SQL Server)', () => {
  let app: NestFastifyApplication;
  let llm: FakeOpenAI;
  let transcript = '';
  let script: (body: Record<string, unknown>) => {
    content?: string;
    toolCalls?: { id: string; name: string; arguments: string }[];
  };

  const inject = async (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) => {
    const res = await app
      .getHttpAdapter()
      .getInstance()
      .inject({ method, url, payload, headers: { 'x-api-key': 'secret' } });
    return { status: res.statusCode, body: res.json() as Record<string, any> };
  };

  beforeAll(async () => {
    const admin = await new sql.ConnectionPool({
      server: host!,
      user: 'sa',
      password,
      database: 'master',
      options: { encrypt: false, trustServerCertificate: true },
    }).connect();
    await admin
      .request()
      .batch(
        `IF DB_ID('${DB}') IS NOT NULL BEGIN ALTER DATABASE ${DB} SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ${DB}; END; CREATE DATABASE ${DB};`,
      );
    await admin.close();
    const seed = await new sql.ConnectionPool({
      server: host!,
      user: 'sa',
      password,
      database: DB,
      options: { encrypt: false, trustServerCertificate: true },
    }).connect();
    await seed.request().batch(await readFile(new URL('./fixtures/seed.sql', import.meta.url), 'utf8'));
    await seed.close();
    await rm(CACHE_FILE, { force: true });

    llm = new FakeOpenAI(
      (body) => script(body),
      () => transcript,
    );
    Object.assign(process.env, {
      NODE_ENV: 'test',
      LOG_LEVEL: 'warn',
      API_KEY: 'secret',
      DB_HOST: host,
      DB_NAME: DB,
      DB_USER: 'sa',
      DB_PASSWORD: password,
      DB_POOL_MAX: '1', // forces connection reuse so session-state leaks would show up
      DB_MAX_ROWS: '100',
      SCHEMA_CACHE_FILE: CACHE_FILE,
      EXAMPLES_FILE: '.cache/e2e-examples.json',
      OPENAI_API_KEY: 'test',
      OPENAI_BASE_URL: await llm.start(),
      LLM_PROVIDER: 'openai',
      MEDIA_MAX_AUDIO_MB: '1',
    });

    const { AppModule } = await import('../src/app.module.js');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await configureApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
    await llm?.stop();
    await rm(CACHE_FILE, { force: true });
    await rm('.cache/e2e-examples.json', { force: true });
  });

  it('reports health without an API key and protects everything else', async () => {
    const health = await app.getHttpAdapter().getInstance().inject({ method: 'GET', url: '/health' });
    expect(health.json()).toMatchObject({ status: 'ok', db: { ok: true }, llm: { configured: true } });
    const denied = await app.getHttpAdapter().getInstance().inject({ method: 'GET', url: '/schema' });
    expect(denied.statusCode).toBe(401);
  });

  it('introspects tables, keys, row counts and descriptions', async () => {
    const { body } = await inject('GET', '/schema');
    expect(body.tables.map((t: { id: string }) => t.id)).toEqual([
      'dbo.Customers',
      'dbo.OrderLines',
      'dbo.Orders',
      'dbo.Products',
    ]);
    expect(body.tables.find((t: { id: string }) => t.id === 'dbo.Orders').rowCount).toBe(500);

    const ctx = await inject('GET', '/schema/context?q=orders');
    expect(ctx.body.full).toBe(true);
    expect(ctx.body.text).toContain(
      'dbo.Orders ~500 rows | OrderId int PK, CustomerId int ->dbo.Customers.CustomerId, OrderDate date',
    );
    expect(ctx.body.text).toContain('-- Every sellable item');
    // Categorical values are sampled; personal columns never are.
    expect(ctx.body.text).toMatch(/Country char\(2\) \{(PK|AE|GB)\|(PK|AE|GB)\|(PK|AE|GB)\}/);
    expect(ctx.body.text).toContain('FullName nvarchar(100),');
    expect(ctx.body.text).not.toContain('Customer 1|');
  });

  it('stores verified examples only when their SQL runs', async () => {
    const bad = await inject('POST', '/query/examples', {
      question: 'broken example',
      sql: 'SELECT nope FROM dbo.Orders',
    });
    expect(bad.status).toBe(422);
    const ok = await inject('POST', '/query/examples', {
      question: 'Orders per country',
      sql: 'SELECT COUNT(*) AS n FROM dbo.Orders',
    });
    expect(ok.status).toBe(201);
    const list = await inject('GET', '/query/examples');
    expect(list.body).toEqual([expect.objectContaining({ id: ok.body.id, question: 'Orders per country' })]);
    const del = await inject('DELETE', `/query/examples/${ok.body.id}`);
    expect(del.status).toBe(200);
  });

  it('runs direct SQL with a row cap and no session-state leak', async () => {
    const capped = await inject('POST', '/query/sql', {
      sql: 'SELECT OrderId FROM dbo.Orders ORDER BY OrderId',
      maxRows: 5,
    });
    expect(capped.body).toMatchObject({
      rowCount: 5,
      truncated: true,
      columns: [{ name: 'OrderId', type: 'int' }],
    });
    expect(capped.body.rows).toEqual([[1], [2], [3], [4], [5]]);

    // Same pooled connection (pool max 1): SET ROWCOUNT must have been reset.
    const internal = await inject('POST', '/query/sql', {
      sql: 'SELECT COUNT(*) AS n FROM (SELECT TOP (50) OrderId FROM dbo.Orders) x',
    });
    expect(internal.body.rows).toEqual([[50]]);
    const full = await inject('POST', '/query/sql', { sql: 'SELECT TOP (60) OrderId FROM dbo.Orders' });
    expect(full.body).toMatchObject({ rowCount: 60, truncated: false });
  });

  it('rejects writes before they reach the database', async () => {
    for (const bad of [
      'DELETE FROM dbo.Orders',
      'SELECT 1 DROP TABLE dbo.Orders',
      'SELECT * INTO dbo.X FROM dbo.Orders',
    ]) {
      const res = await inject('POST', '/query/sql', { sql: bad });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('UNSAFE_SQL');
    }
    const still = await inject('POST', '/query/sql', { sql: 'SELECT COUNT(*) AS n FROM dbo.Orders' });
    expect(still.body.rows).toEqual([[500]]);
  });

  it('surfaces SQL errors as 422 with the failing statement', async () => {
    const res = await inject('POST', '/query/sql', { sql: 'SELECT NoSuchColumn FROM dbo.Orders' });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: 'SQL_ERROR', message: expect.stringContaining('NoSuchColumn') });
  });

  it('answers a question end to end with self-repair', async () => {
    let n = 0;
    script = (body) => {
      const msgs = body.messages as { role: string; content: string }[];
      if (String(msgs[0].content).startsWith('You are a precise data analyst')) {
        return { content: 'PK customers ordered the most.' };
      }
      n++;
      return n === 1
        ? { content: '```sql\nSELECT Country, COUNT(*) AS Orders FROM dbo.Orderz GROUP BY Country\n```' }
        : {
            content:
              '```sql\nSELECT c.[Country], COUNT(*) AS [Orders]\nFROM [dbo].[Orders] o JOIN [dbo].[Customers] c ON c.[CustomerId] = o.[CustomerId]\nGROUP BY c.[Country] ORDER BY [Orders] DESC\n```',
          };
    };
    const { status, body } = await inject('POST', '/query/ask', {
      question: 'Which country has the most orders?',
    });
    expect(status).toBe(200);
    expect(body).toMatchObject({ attempts: 2, answer: 'PK customers ordered the most.', cache: null });
    expect(body.result.rows).toHaveLength(3);
    expect(body.result.rows.reduce((s: number, r: [string, number]) => s + r[1], 0)).toBe(500);
    expect(body.usage.llmCalls).toBe(3);

    const again = await inject('POST', '/query/ask', { question: 'which country has the most orders' });
    expect(again.body).toMatchObject({ cache: 'answer', usage: { llmCalls: 0 } });
  });

  it('runs a multi-step analysis with parallel tool calls', async () => {
    let turn = 0;
    script = () => {
      turn++;
      if (turn === 1) {
        return {
          toolCalls: [
            {
              id: 'a',
              name: 'run_sql',
              arguments: JSON.stringify({ sql: 'SELECT SUM(Quantity) AS Units FROM dbo.OrderLines' }),
            },
            { id: 'b', name: 'describe_tables', arguments: JSON.stringify({ tables: ['dbo.Products'] }) },
          ],
        };
      }
      if (turn === 2)
        return {
          toolCalls: [
            { id: 'c', name: 'run_sql', arguments: JSON.stringify({ sql: 'DELETE FROM dbo.Products' }) },
          ],
        };
      return { content: 'Total units sold: see figures.' };
    };
    const { body } = await inject('POST', '/query/analyze', { question: 'How many units did we sell?' });
    expect(body.answer).toBe('Total units sold: see figures.');
    expect(body.steps).toMatchObject([
      { tool: 'run_sql', ok: true, rowCount: 1 },
      { tool: 'describe_tables', ok: true },
      { tool: 'run_sql', ok: false, error: expect.stringContaining('only SELECT') },
    ]);
    expect(body.usage.llmCalls).toBe(3);
  });

  it('switches provider mode at runtime', async () => {
    const res = await inject('PUT', '/llm/mode', { mode: 'openrouter' });
    expect(res.status).toBe(400); // no OpenRouter key configured in this test
    const ok = await inject('PUT', '/llm/mode', { mode: 'auto' });
    expect(ok.body.mode).toBe('auto');
  });

  const upload = async (form: FormData) => {
    const res = await app
      .getHttpAdapter()
      .getInstance()
      .inject({ method: 'POST', url: '/query/ask/media', payload: form, headers: { 'x-api-key': 'secret' } });
    return { status: res.statusCode, body: res.json() as Record<string, any> };
  };
  const role = (body: Record<string, unknown>) =>
    String((body.messages as { content: unknown }[])[0].content);

  it('answers a voice message in Urdu: transcribe -> SQL from the Urdu -> Urdu answer', async () => {
    transcript = 'ہمارے کتنے آرڈر ہیں؟';
    script = (body) => {
      const sys = role(body);
      if (sys.startsWith('You translate questions about a business database'))
        return { content: 'How many orders do we have?' };
      if (sys.startsWith('You are a precise data analyst')) return { content: 'ہمارے کل 500 آرڈر ہیں۔' };
      return { content: '```sql\nSELECT COUNT(*) AS [Orders] FROM [dbo].[Orders]\n```' };
    };
    const form = new FormData();
    form.append('context', '[]');
    form.append('audio', new Blob([Buffer.from('ID3fake-mp3-bytes')], { type: 'audio/mpeg' }), 'voice.mp3');
    const { status, body } = await upload(form);
    expect(status).toBe(200);
    expect(body).toMatchObject({
      transcript: 'ہمارے کتنے آرڈر ہیں؟',
      language: 'ur',
      answer: 'ہمارے کل 500 آرڈر ہیں۔',
      result: { rows: [[500]] },
    });
    expect(body.translatedQuestion).toBeUndefined(); // schema fits: the SQL model reads the Urdu directly
    expect(body.usage.models).toContain('openai:gpt-4o-transcribe');
    expect(body.usage.costComplete).toBe(false);
    const sent = llm.transcriptions.at(-1)!;
    expect(sent).toContain('name="model"');
    expect(sent).toContain('gpt-4o-transcribe');
    expect(sent).not.toContain('name="language"');
  });

  it('answers from an image: read -> English question -> SQL', async () => {
    let visionRequest: Record<string, any> | undefined;
    script = (body) => {
      const sys = role(body);
      if (sys.startsWith('You help people query')) {
        visionRequest = body;
        return {
          content:
            '{"language":"ur","question":"How many products do we sell?","display":"ہم کتنی مصنوعات بیچتے ہیں؟","extracted":"مصنوعات کے شیلف کی تصویر"}',
        };
      }
      if (sys.startsWith('You are a precise data analyst')) return { content: 'We sell 5 products.' };
      return { content: '```sql\nSELECT COUNT(*) AS [Products] FROM [dbo].[Products]\n```' };
    };
    const form = new FormData();
    form.append('question', 'How many of these do we sell?');
    form.append(
      'image',
      new Blob([Buffer.from([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }),
      'shelf.png',
    );
    const { status, body } = await upload(form);
    expect(status).toBe(200);
    expect(body).toMatchObject({
      image: {
        question: 'How many products do we sell?',
        display: 'ہم کتنی مصنوعات بیچتے ہیں؟',
        extracted: 'مصنوعات کے شیلف کی تصویر',
      },
      result: { rows: [[5]] },
      // The typed message was English, so the answer is English even though the image was Urdu.
      language: 'en',
    });
    const parts = visionRequest!.messages[1].content;
    expect(parts[1].image_url).toMatchObject({
      detail: 'high',
      url: expect.stringMatching(/^data:image\/png;base64,/),
    });
    expect(visionRequest!.reasoning_effort).toBe('low');
  });

  it('rejects empty, unsupported and oversized uploads', async () => {
    const empty = new FormData();
    empty.append('question', '');
    expect((await upload(empty)).status).toBe(400);

    const wrongType = new FormData();
    wrongType.append('audio', new Blob(['hello'], { type: 'text/plain' }), 'a.txt');
    expect((await upload(wrongType)).status).toBe(415);

    const big = new FormData();
    big.append('audio', new Blob([Buffer.alloc(1_200_000)], { type: 'audio/mpeg' }), 'long.mp3');
    const res = await upload(big);
    expect(res.status).toBe(413);
    expect(res.body.message).toMatch(/too large/);
  });
});
