import { createHmac } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { AppConfig } from '../config/app-config.js';
import { buildPipeline, type Pipeline } from '../eval/pipeline.js';
import { exportMdfToDuckDb } from '../mdf/export-duckdb.js';
import { MediaService } from '../query/media.service.js';
import { FakeOpenAI, testConfig } from '../testing/fake-openai.js';
import { answerMessage, tableBlock, toWhatsApp } from '../whatsapp/format.js';
import { WhatsAppService } from '../whatsapp/whatsapp.service.js';
import { InboxService } from './inbox.service.js';
import { PushService } from './push.service.js';
import { describeFrequency, nextRun, scheduleInputSchema, toCron } from './schedule.js';
import { SchedulerService } from './scheduler.service.js';
import { TemplatesService } from './templates.service.js';

/**
 * Reports end to end on a real DuckDB file: templates, schedules, inbox, app
 * push and the WhatsApp bot, with fake model, Graph API and Expo push servers.
 */
const dir = mkdtempSync(join(tmpdir(), 'reports-'));
const ALLOWED = '923001112222';
const STRANGER = '923009998888';
const COLD = '923005556666'; // has not messaged the bot in 24 hours

// ── fake WhatsApp Graph API + Expo push ─────────────────────────────────
const graph: { path: string; body: Record<string, any> }[] = [];
const pushes: Record<string, any>[] = [];
let externalBase = '';
const external: Server = createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    const url = req.url ?? '';
    if (url.startsWith('/push')) {
      const msgs = JSON.parse(raw) as unknown[];
      pushes.push(...(msgs as Record<string, any>[]));
      return res.end(JSON.stringify({ data: msgs.map(() => ({ status: 'ok' })) }));
    }
    if (req.method === 'GET' && url === '/v25.0/media-1') return res.end(JSON.stringify({ url: `${externalBase}/files/voice`, mime_type: 'audio/ogg; codecs=opus', file_size: 11 }));
    if (req.method === 'GET' && url === '/files/voice') {
      res.setHeader('content-type', 'audio/ogg');
      return res.end(Buffer.from('OggS-fake-!'));
    }
    const body = JSON.parse(raw || '{}') as Record<string, any>;
    graph.push({ path: url, body });
    if (body.to === COLD && body.type === 'text') {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: { message: 'Re-engagement message', code: 131047 } }));
    }
    res.end(JSON.stringify({ messages: [{ id: 'wamid.x' }] }));
  });
});

// ── fake model: SQL for questions, a sentence for answers; the chat agent queries, then answers ──
let llm: FakeOpenAI;
let transcript = 'How many orders are there?';

let pipe: Pipeline;
let templates: TemplatesService;
let inbox: InboxService;
let push: PushService;
let whatsapp: WhatsAppService;
let scheduler: SchedulerService;
let config: AppConfig;

function env(extra: Record<string, string> = {}) {
  return {
    DB_ENGINE: 'duckdb',
    DUCKDB_FILE: join(dir, 'f.duckdb'),
    OPENAI_API_KEY: 'test',
    OPENAI_BASE_URL: '',
    OPENROUTER_BASE_URL: '',
    LLM_PROVIDER: 'openai',
    AGENT_OPENAI_API: 'chat_completions',
    SCHEMA_CACHE_FILE: join(dir, 'schema.json'),
    TEMPLATES_FILE: join(dir, 'templates.json'),
    USER_TEMPLATES_FILE: join(dir, 'user-templates.json'),
    SCHEDULES_FILE: join(dir, 'schedules.json'),
    INBOX_FILE: join(dir, 'inbox.json'),
    DEVICES_FILE: join(dir, 'devices.json'),
    EXPO_PUSH_URL: `${externalBase}/push`,
    REPORT_TIMEZONE: 'Asia/Karachi',
    SCHEDULER_ENABLED: 'false',
    WHATSAPP_TOKEN: 'wa-token',
    WHATSAPP_PHONE_NUMBER_ID: '1234',
    WHATSAPP_VERIFY_TOKEN: 'verify-me',
    WHATSAPP_APP_SECRET: 'app-secret',
    WHATSAPP_ALLOWED_NUMBERS: `${ALLOWED},+92 300 5556666`,
    WHATSAPP_GRAPH_URL: `${externalBase}/v25.0`,
    LOG_LEVEL: 'error',
    ...extra,
  };
}

beforeAll(async () => {
  writeFileSync(join(dir, 'f.mdf'), gunzipSync(readFileSync(join(import.meta.dirname, '../../test/fixtures/mdf/MdfFixture.mdf.gz'))));
  await exportMdfToDuckDb(join(dir, 'f.mdf'), join(dir, 'f.duckdb'));
  mkdirSync(join(dir, 'x'), { recursive: true });
  writeFileSync(
    join(dir, 'templates.json'),
    JSON.stringify({
      templates: [
        { id: 'orders', title: 'Orders', titleUr: 'آرڈرز', category: 'sales', summary: false, sql: 'SELECT COUNT(*) AS orders, SUM(qty) AS units FROM sales.Orders' },
        {
          id: 'big-orders',
          title: 'Big orders',
          category: 'sales',
          alert: true,
          params: [{ name: 'min', label: 'Minimum units', type: 'number', default: 5, min: 1, max: 1000 }],
          sql: 'SELECT shop, order_no, qty FROM sales.Orders WHERE qty >= {{min}} ORDER BY qty DESC',
        },
        {
          id: 'dated',
          title: 'Rows on a day',
          params: [{ name: 'day', label: 'Day', type: 'date', default: '2026-01-01' }],
          summary: false,
          sqlDuckdb: 'SELECT id FROM dbo.AllTypes WHERE dte >= {{day}} AND dte < {{day+1}}',
        },
        { id: 'ask-orders', title: 'Orders (AI)', question: 'How many orders are there?' },
        { id: 'mssql-only', title: 'Needs SQL Server', sql: 'SELECT TOP 1 1 AS x' },
      ],
    }),
  );
  await new Promise<void>((ok) => external.listen(0, '127.0.0.1', ok));
  externalBase = `http://127.0.0.1:${(external.address() as AddressInfo).port}`;

  llm = new FakeOpenAI(
    (body) => {
      const msgs = (body.messages as { role: string; content: string }[] | undefined) ?? [];
      if (!msgs.length) return { content: '' };
      if (body.tools) {
        if (msgs.at(-1)?.role === 'tool') return { content: 'There are **3** orders in total.' };
        const args = { title: 'Orders', sql: 'SELECT COUNT(*) AS orders FROM sales.Orders', display: 'number', chart: null };
        return { toolCalls: [{ id: `call_${msgs.length}`, name: 'run_sql', arguments: JSON.stringify(args) }] };
      }
      if (msgs[0].content.startsWith('You are a precise data analyst')) return { content: 'There are **3** orders in total.' };
      return { content: '```sql\nSELECT COUNT(*) AS orders FROM sales.Orders\n```' };
    },
    () => transcript,
  );
  const base = await llm.start();
  const e = env({ OPENAI_BASE_URL: base, OPENROUTER_BASE_URL: base });
  Object.assign(process.env, e);
  config = testConfig(e);
  pipe = buildPipeline(e);
  templates = new TemplatesService(config, pipe.db, pipe.ask);
  templates.onModuleInit();
  inbox = new InboxService(config);
  push = new PushService(config);
  whatsapp = new WhatsAppService(config, pipe.analyst, new MediaService(config, pipe.llm, pipe.ask, pipe.analyst), templates);
  scheduler = new SchedulerService(config, templates, pipe.ask, inbox, push, whatsapp);
  await push.register('ExponentPushToken[abc123]', 'android', 'Test phone');
});

afterAll(async () => {
  await scheduler?.onApplicationShutdown();
  await pipe?.close();
  await llm?.stop();
  await new Promise((ok) => external.close(ok));
});

beforeEach(() => {
  graph.length = 0;
  pushes.length = 0;
});

describe('templates', () => {
  it('lists only reports this engine can run', async () => {
    const ids = (await templates.list()).map((t) => t.id);
    expect(ids).toEqual(['orders', 'big-orders', 'dated', 'ask-orders']);
  });

  it('runs verified SQL with no model call and returns what the app renders', async () => {
    const before = llm.requests.length;
    const r = await templates.run('orders');
    expect(r.result?.rows).toEqual([[3, 11]]);
    expect(r.answer).toBeNull();
    expect(r.usage.llmCalls).toBe(0);
    expect(llm.requests.length).toBe(before);
    expect(r.template).toMatchObject({ id: 'orders', title: 'Orders', period: '' });
  });

  it('substitutes typed parameters and writes a summary when asked', async () => {
    const r = await templates.run('big-orders', { params: { min: 3 } });
    expect(r.sql).toContain('qty >= 3');
    expect(r.result?.rows).toEqual([
      [2, 1, 7],
      [1, 1, 3],
    ]);
    expect(r.answer).toContain('3');
    const d = await templates.run('dated');
    expect(d.sql).toContain("DATE '2026-01-01'");
    expect(d.result?.rows).toEqual([[4]]);
    expect(d.template.period).toBe('1 Jan 2026');
    await expect(templates.run('big-orders', { params: { min: '1 OR 1=1' } })).rejects.toThrow(/whole number/);
    await expect(templates.run('dated', { params: { day: "2026-01-01'--" } })).rejects.toThrow(/not a date/);
  });

  it('answers question templates through the pipeline', async () => {
    const r = await templates.run('ask-orders');
    expect(r.result?.rows).toEqual([[3]]);
    expect(r.question).toBe('Orders (AI)');
  });

  it('saves a chat answer as a report, validates its SQL, and deletes only saved ones', async () => {
    const t = await templates.create({ title: 'My order count', question: 'How many orders?', sql: 'SELECT COUNT(*) AS n FROM sales.Orders' });
    expect(t).toMatchObject({ category: 'custom', dialect: 'duckdb', builtIn: false });
    expect((await templates.run(t.id)).result?.rows).toEqual([[3]]);
    await expect(templates.create({ title: 'Bad', question: 'x y z', sql: 'DELETE FROM sales.Orders' })).rejects.toThrow(/cannot be saved/);
    await expect(templates.remove('orders')).rejects.toThrow(/Built-in/);
    await templates.remove(t.id);
    await expect(templates.get(t.id)).rejects.toThrow(/not found/);
  });
});

describe('schedule model', () => {
  it('turns frequencies into cron and runs in the report time zone', () => {
    expect(toCron({ type: 'daily', time: '09:00' })).toBe('0 9 * * *');
    expect(toCron({ type: 'weekly', time: '08:30', weekdays: [4, 1, 1] })).toBe('30 8 * * 1,4');
    expect(toCron({ type: 'monthly', time: '18:00', day: 'last' })).toBe('0 18 L * *');
    // 09:00 in Karachi (UTC+5) is 04:00 UTC.
    expect(nextRun({ type: 'daily', time: '09:00' }, 'Asia/Karachi', new Date('2026-09-24T03:59:00Z'))?.toISOString()).toBe('2026-09-24T04:00:00.000Z');
    expect(nextRun({ type: 'daily', time: '09:00' }, 'Asia/Karachi', new Date('2026-09-24T04:00:00Z'))?.toISOString()).toBe('2026-09-25T04:00:00.000Z');
    expect(describeFrequency({ type: 'weekly', time: '08:30', weekdays: [1, 4] })).toBe('Mon, Thu at 08:30');
  });

  it('validates input: times, phone numbers', () => {
    const ok = scheduleInputSchema.safeParse({
      name: 'Shortage',
      target: { templateId: 'big-orders' },
      frequency: { type: 'daily', time: '09:00' },
      deliver: { app: true, whatsapp: ['+92 300 111-2222'] },
    });
    expect(ok.success && ok.data.deliver.whatsapp).toEqual(['923001112222']);
    expect(scheduleInputSchema.safeParse({ name: 'x', target: { question: 'abc' }, frequency: { type: 'daily', time: '25:00' } }).success).toBe(false);
    expect(scheduleInputSchema.safeParse({ name: 'x', target: { question: 'abc' }, frequency: { type: 'daily', time: '09:00' }, deliver: { whatsapp: ['12'] } }).success).toBe(false);
  });
});

describe('scheduler', () => {
  const input = (extra: Record<string, unknown> = {}) =>
    scheduleInputSchema.parse({
      name: 'Morning orders',
      target: { templateId: 'orders' },
      frequency: { type: 'daily', time: '09:00' },
      deliver: { app: true, whatsapp: [ALLOWED] },
      ...extra,
    });

  it('runs a due schedule: inbox, app push, WhatsApp, then moves to the next day', async () => {
    const s = await scheduler.create(input());
    const due = new Date(Date.parse(s.nextRunAt!) + 60_000);
    await scheduler.tick(due);

    const { reports, unread } = await inbox.list();
    expect(unread).toBeGreaterThanOrEqual(1);
    expect(reports[0]).toMatchObject({ scheduleId: s.id, title: 'Morning orders', status: 'ok', rows: 1 });
    expect(reports[0].deliveries).toEqual([
      { channel: 'whatsapp', to: ALLOWED, status: 'sent' },
      { channel: 'app', status: 'sent' },
    ]);
    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toMatchObject({ to: 'ExponentPushToken[abc123]', title: '📊 Morning orders', data: { reportId: reports[0].id } });
    const sent = graph.find((g) => g.body.to === ALLOWED);
    expect(sent?.body.text.body).toContain('*📊 Morning orders*');
    expect(sent?.body.text.body).toContain('```');

    const after = await scheduler.get(s.id);
    expect(after).toMatchObject({ lastStatus: 'ok', lastReportId: reports[0].id });
    expect(Date.parse(after.nextRunAt!) - Date.parse(s.nextRunAt!)).toBe(24 * 3600_000);

    // Already ran: the same moment does nothing more.
    await scheduler.tick(due);
    expect((await inbox.list()).reports.filter((r) => r.scheduleId === s.id)).toHaveLength(1);
    const full = await inbox.get(reports[0].id);
    expect(full.response?.result?.rows).toEqual([[3, 11]]);
    await inbox.markRead(reports[0].id);
    expect((await inbox.get(reports[0].id)).read).toBe(true);
    await scheduler.remove(s.id);
  });

  it('stays quiet for alert reports with nothing to report', async () => {
    const s = await scheduler.create(input({ name: 'Huge orders', target: { templateId: 'big-orders', params: { min: 500 } } }));
    expect(s.onlyIfRows).toBe(true); // alert templates default to "only when there are rows"
    const r = await scheduler.execute(s.id);
    expect(r).toEqual({ skipped: true, reason: expect.stringMatching(/No rows/) });
    expect(pushes).toHaveLength(0);
    expect(graph).toHaveLength(0);
    expect((await scheduler.get(s.id)).lastStatus).toBe('skipped');
    await scheduler.remove(s.id);
  });

  it('falls back to the approved template outside the 24-hour window, and says why when there is none', async () => {
    const s = await scheduler.create(input({ name: 'Cold', deliver: { app: false, whatsapp: [COLD] } }));
    const r = await scheduler.execute(s.id);
    expect('deliveries' in r && r.deliveries[0]).toMatchObject({ to: COLD, status: 'failed', error: expect.stringMatching(/24 hours.*WHATSAPP_REPORT_TEMPLATE/) });
    expect((await scheduler.get(s.id)).lastStatus).toBe('failed');

    const withTemplate = new WhatsAppService(testConfig({ ...env({ WHATSAPP_REPORT_TEMPLATE: 'report_ready' }) }), pipe.analyst, {} as MediaService, templates);
    graph.length = 0;
    await withTemplate.sendReport(COLD, { title: 'Cold', text: 'x', summary: 'There are 3 orders.' });
    expect(graph.at(-1)?.body).toMatchObject({
      to: COLD,
      type: 'template',
      template: { name: 'report_ready', components: [{ type: 'body', parameters: [{ text: 'Cold' }, { text: 'There are 3 orders.' }] }] },
    });
    await scheduler.remove(s.id);
  });

  it('files failures in the inbox and skips runs missed during downtime', async () => {
    const s = await scheduler.create(input({ name: 'Broken', target: { templateId: 'orders' }, deliver: { app: true, whatsapp: [] } }));
    const bad = await scheduler.create(input({ name: 'Gone', target: { templateId: 'dated' }, deliver: { app: true, whatsapp: [] } }));
    await scheduler.update(bad.id, { ...input({ name: 'Gone', target: { templateId: 'dated', params: { day: 'someday' } }, deliver: { app: true, whatsapp: [] } }) });
    const r = await scheduler.execute(bad.id);
    expect(r).toMatchObject({ status: 'failed', error: expect.stringMatching(/not a date/) });
    expect(pushes[0]).toMatchObject({ title: '⚠️ Gone' });

    const late = new Date(Date.parse((await scheduler.get(s.id)).nextRunAt!) + 7 * 3600_000);
    await scheduler.tick(late);
    const after = await scheduler.get(s.id);
    expect(after.lastStatus).toBe('missed');
    expect(Date.parse(after.nextRunAt!)).toBeGreaterThan(late.getTime());
    await scheduler.remove(s.id);
    await scheduler.remove(bad.id);
  });

  it('refuses schedules for unknown reports or with nowhere to deliver', async () => {
    await expect(scheduler.create(input({ target: { templateId: 'nope' } }))).rejects.toThrow(/not found/);
    await expect(scheduler.create(input({ deliver: { app: false, whatsapp: [] } }))).rejects.toThrow(/at least one/);
  });
});

describe('WhatsApp bot', () => {
  const sign = (body: string) => `sha256=${createHmac('sha256', 'app-secret').update(body).digest('hex')}`;
  const message = (from: string, m: Record<string, unknown>, id = `wamid.${Math.random()}`) =>
    ({
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ value: { messages: [{ id, from, ...m }] } }] }],
    }) as Parameters<WhatsAppService['accept']>[0];
  const replies = () => graph.filter((g) => g.body.type).map((g) => g.body);

  it('verifies the webhook handshake and every call signature', () => {
    expect(whatsapp.verifyChallenge('subscribe', 'verify-me')).toBe(true);
    expect(whatsapp.verifyChallenge('subscribe', 'wrong')).toBe(false);
    const body = JSON.stringify({ a: 1 });
    expect(whatsapp.validSignature(Buffer.from(body), sign(body))).toBe(true);
    expect(whatsapp.validSignature(Buffer.from(body + ' '), sign(body))).toBe(false);
    expect(whatsapp.validSignature(Buffer.from(body), undefined)).toBe(false);
  });

  it('answers a question from an allowed number, with follow-up context, and handles each message once', async () => {
    const m = message(ALLOWED, { type: 'text', text: { body: 'How many orders are there?' } }, 'wamid.same');
    expect(whatsapp.accept(m)).toBe(1);
    expect(whatsapp.accept(m)).toBe(0); // Meta retry: ignored
    await whatsapp.idle();
    const text = replies().find((r) => r.type === 'text');
    expect(text).toMatchObject({ to: ALLOWED });
    expect(text?.text.body).toContain('*3*'); // **3** became WhatsApp bold

    whatsapp.accept(message(ALLOWED, { type: 'text', text: { body: 'and for shop 1?' } }));
    await whatsapp.idle();
    const sqlCall = llm.requests.at(-2) as { messages: { role: string; content: string }[] };
    expect(JSON.stringify(sqlCall.messages)).toContain('How many orders are there?'); // earlier turn sent as context
  });

  it('shows the report menu and runs a tapped report', async () => {
    whatsapp.accept(message(ALLOWED, { type: 'text', text: { body: 'reports' } }));
    await whatsapp.idle();
    const list = replies().find((r) => r.type === 'interactive');
    expect(list?.interactive.action.sections[0].rows.map((r: { id: string }) => r.id)).toEqual(['tpl:orders', 'tpl:big-orders', 'tpl:dated', 'tpl:ask-orders']);

    graph.length = 0;
    whatsapp.accept(message(ALLOWED, { type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'tpl:orders', title: 'Orders' } } }));
    await whatsapp.idle();
    const report = replies().find((r) => r.type === 'text');
    expect(report?.text.body).toMatch(/^\*📊 Orders\*/);
    expect(report?.text.body).toContain('orders  units');
  });

  it('transcribes voice notes and answers them', async () => {
    transcript = 'How many orders are there?';
    whatsapp.accept(message(ALLOWED, { type: 'audio', audio: { id: 'media-1', mime_type: 'audio/ogg; codecs=opus' } }));
    await whatsapp.idle();
    const text = replies().find((r) => r.type === 'text');
    expect(text?.text.body).toContain('🎤');
    expect(text?.text.body).toContain(transcript);
    expect(llm.transcriptions.at(-1)).toContain('voice.ogg');
  });

  it('refuses numbers that are not allowed, once, without touching the database', async () => {
    const before = llm.requests.length;
    whatsapp.accept(message(STRANGER, { type: 'text', text: { body: 'How many orders?' } }));
    whatsapp.accept(message(STRANGER, { type: 'text', text: { body: 'hello?' } }));
    await whatsapp.idle();
    const sent = replies().filter((r) => r.to === STRANGER);
    expect(sent).toHaveLength(1);
    expect(sent[0].text.body).toMatch(/not allowed/);
    expect(llm.requests.length).toBe(before);
  });
});

describe('WhatsApp formatting', () => {
  it('converts markdown and renders results as an aligned monospace table', () => {
    expect(toWhatsApp('## Top\n**Total**: 5\n- a\n| x | y |\n|---|---|')).toBe('*Top*\n*Total*: 5\n• a');
    const r = { columns: [{ name: 'customer', type: 'text' }, { name: 'net_sales', type: 'decimal' }], rows: [['ALI', 1234.5], ['BILAL TRADERS', 99]], rowCount: 12, truncated: false, elapsedMs: 1 };
    expect(tableBlock(r, 2)).toBe('```\ncustomer       net sales\nALI              1,234.5\nBILAL TRADERS         99\n… 10 more rows\n```');
    const msg = answerMessage({ title: 'T', answer: 'x'.repeat(5000), result: r });
    expect(msg.length).toBeLessThanOrEqual(4000);
  });
});
