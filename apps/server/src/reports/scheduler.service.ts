import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { JsonStore } from '../common/json-store.js';
import { AppConfig } from '../config/app-config.js';
import { AskService } from '../query/ask.service.js';
import { answerMessage } from '../whatsapp/format.js';
import { WhatsAppService } from '../whatsapp/whatsapp.service.js';
import { type Delivery, type InboxReport, InboxService } from './inbox.service.js';
import { PushService } from './push.service.js';
import { describeFrequency, nextRun, type Schedule, type ScheduleInput } from './schedule.js';
import { type ReportResult, TemplatesService } from './templates.service.js';

const TICK_MS = 30_000;
/** A run missed by more than this (server was down) is skipped, not replayed late. */
const CATCH_UP_MS = 6 * 3600_000;

/**
 * Runs saved schedules at their time (in their time zone): runs the report,
 * files it in the inbox, notifies the app and sends it on WhatsApp.
 * One process should run it (SCHEDULER_ENABLED); state lives in SCHEDULES_FILE.
 */
@Injectable()
export class SchedulerService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(SchedulerService.name);
  private readonly store: JsonStore<{ schedules: Schedule[] }>;
  private timer?: NodeJS.Timeout;
  private ticking?: Promise<void>;
  private readonly running = new Set<string>();

  constructor(
    private readonly config: AppConfig,
    private readonly templates: TemplatesService,
    private readonly asker: AskService,
    private readonly inbox: InboxService,
    private readonly push: PushService,
    private readonly whatsapp: WhatsAppService,
  ) {
    this.store = new JsonStore(config.get('SCHEDULES_FILE'), () => ({ schedules: [] }));
  }

  onModuleInit(): void {
    if (!this.config.get('SCHEDULER_ENABLED')) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
    // First check soon after boot: catches runs that fell due while the server was down.
    setTimeout(() => void this.tick(), 2_000).unref();
  }

  async onApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    await this.ticking;
  }

  async list(): Promise<(Schedule & { description: string })[]> {
    return (await this.store.read()).schedules.map((s) => ({ ...structuredClone(s), description: describeFrequency(s.frequency) }));
  }

  async get(id: string): Promise<Schedule> {
    const s = (await this.store.read()).schedules.find((x) => x.id === id);
    if (!s) throw new NotFoundException(`Schedule ${id} not found`);
    // A copy: callers must not change stored state behind the store's back.
    return structuredClone(s);
  }

  private async validate(input: ScheduleInput): Promise<void> {
    const template = 'templateId' in input.target ? await this.templates.get(input.target.templateId) : undefined;
    input.onlyIfRows ??= template?.alert ?? false;
    if (input.deliver.whatsapp.length && !this.whatsapp.configured) {
      throw new BadRequestException('WhatsApp delivery needs WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID on the server');
    }
    if (!input.deliver.app && !input.deliver.whatsapp.length) throw new BadRequestException('Choose at least one way to deliver the report');
  }

  private next(s: Pick<Schedule, 'frequency' | 'timezone'>, after = new Date()): string | undefined {
    try {
      return nextRun(s.frequency, s.timezone, after)?.toISOString();
    } catch (err) {
      throw new BadRequestException(`Invalid schedule: ${(err as Error).message}`);
    }
  }

  async create(input: ScheduleInput): Promise<Schedule> {
    await this.validate(input);
    const now = new Date().toISOString();
    const s: Schedule = {
      ...input,
      id: `sch-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
      timezone: this.config.get('REPORT_TIMEZONE'),
      createdAt: now,
      updatedAt: now,
    };
    s.nextRunAt = s.enabled ? this.next(s) : undefined;
    await this.store.update((st) => void st.schedules.push(structuredClone(s)));
    return s;
  }

  async update(id: string, input: ScheduleInput): Promise<Schedule> {
    await this.validate(input);
    const current = await this.get(id);
    const s: Schedule = { ...current, ...input, updatedAt: new Date().toISOString() };
    s.nextRunAt = s.enabled ? this.next(s) : undefined;
    await this.store.update((st) => void (st.schedules = st.schedules.map((x) => (x.id === id ? structuredClone(s) : x))));
    return s;
  }

  async remove(id: string): Promise<void> {
    await this.get(id);
    await this.store.update((st) => void (st.schedules = st.schedules.filter((x) => x.id !== id)));
  }

  /** Runs every due schedule once; safe to call at any time (overlapping ticks wait). */
  tick(now = new Date()): Promise<void> {
    this.ticking = (this.ticking ?? Promise.resolve()).then(async () => {
      const due = (await this.store.read()).schedules.filter((s) => s.enabled && s.nextRunAt && Date.parse(s.nextRunAt) <= now.getTime());
      for (const s of due) {
        if (now.getTime() - Date.parse(s.nextRunAt!) > CATCH_UP_MS) {
          this.logger.warn(`Schedule "${s.name}" missed its ${s.nextRunAt} run (server was down); skipping to the next one`);
          await this.patch(s.id, { lastStatus: 'missed', lastError: `Missed the run due ${s.nextRunAt}`, nextRunAt: this.next(s, now) });
          continue;
        }
        await this.execute(s.id, now).catch((err: Error) => this.logger.error(`Schedule "${s.name}" crashed: ${err.message}`));
      }
    });
    return this.ticking;
  }

  private async patch(id: string, fields: Partial<Schedule>): Promise<void> {
    await this.store.update((st) => {
      const s = st.schedules.find((x) => x.id === id);
      if (s) Object.assign(s, fields);
    });
  }

  /**
   * Runs one schedule now: report -> inbox -> app notification -> WhatsApp.
   * Scheduled runs also move nextRunAt forward; "run now" leaves it alone.
   */
  async execute(id: string, now?: Date): Promise<InboxReport | { skipped: true; reason: string }> {
    if (this.running.has(id)) throw new BadRequestException('This schedule is already running');
    this.running.add(id);
    const s = await this.get(id);
    const scheduled = !!now;
    try {
      let res: ReportResult | Awaited<ReturnType<AskService['ask']>>;
      const title = s.name;
      try {
        res =
          'templateId' in s.target
            ? await this.templates.run(s.target.templateId, { params: s.target.params, language: s.language })
            : await this.asker.ask({ question: s.target.question, context: [], language: s.language, answer: true, tier: 'fast', noCache: true });
      } catch (err) {
        const error = (err as { getResponse?: () => { message?: string } }).getResponse?.().message ?? (err as Error).message;
        const report = await this.inbox.add({ scheduleId: s.id, title, status: 'failed', rows: 0, summary: null, error: String(error), deliveries: [] });
        await this.patch(s.id, { lastRunAt: new Date().toISOString(), lastStatus: 'failed', lastError: String(error), lastReportId: report.id, ...(scheduled ? { nextRunAt: this.next(s, now) } : {}) });
        if (s.deliver.app) await this.notify(`⚠️ ${title}`, `Scheduled report failed: ${error}`, report.id);
        return report;
      }

      const rows = res.result?.rowCount ?? 0;
      if (s.onlyIfRows && rows === 0) {
        await this.patch(s.id, { lastRunAt: new Date().toISOString(), lastStatus: 'skipped', lastError: undefined, ...(scheduled ? { nextRunAt: this.next(s, now) } : {}) });
        return { skipped: true, reason: 'No rows: nothing to report' };
      }

      const period = 'template' in res ? (res as ReportResult).template.period : '';
      const summary = res.answer ?? `${rows} rows`;
      const deliveries: Delivery[] = [];
      if (s.deliver.whatsapp.length) {
        const text = answerMessage({ title: `📊 ${title}`, subtitle: period, answer: res.answer, result: res.result });
        for (const to of s.deliver.whatsapp) {
          try {
            await this.whatsapp.sendReport(to, { title, text, summary: stripMarkdown(summary) });
            deliveries.push({ channel: 'whatsapp', to, status: 'sent' });
          } catch (err) {
            deliveries.push({ channel: 'whatsapp', to, status: 'failed', error: (err as Error).message });
          }
        }
      }
      if (s.deliver.app) deliveries.push({ channel: 'app', status: 'sent' });
      const report = await this.inbox.add({ scheduleId: s.id, title, status: 'ok', rows, summary: res.answer, deliveries, response: res as ReportResult });
      if (s.deliver.app) await this.notify(`📊 ${title}`, stripMarkdown(summary), report.id);

      const failed = deliveries.filter((d) => d.status === 'failed');
      await this.patch(s.id, {
        lastRunAt: new Date().toISOString(),
        lastStatus: failed.length ? 'failed' : 'ok',
        lastError: failed.length ? failed.map((d) => `${d.to}: ${d.error}`).join('; ') : undefined,
        lastReportId: report.id,
        ...(scheduled ? { nextRunAt: this.next(s, now) } : {}),
      });
      return report;
    } finally {
      this.running.delete(id);
    }
  }

  private async notify(title: string, body: string, reportId: string): Promise<void> {
    await this.push.send(title, body, { reportId }).catch((err: Error) => this.logger.warn(`Push failed: ${err.message}`));
  }
}

function stripMarkdown(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^\s*[-*]\s+/gm, '• ')
    .replace(/^\s*\|.*\|\s*$/gm, '')
    .replace(/\n{2,}/g, '\n')
    .trim();
}
