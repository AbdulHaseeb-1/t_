import { readFileSync } from 'node:fs';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { JsonStore } from '../common/json-store.js';
import { AppConfig } from '../config/app-config.js';
import { DatabaseService } from '../database/database.service.js';
import { resolveConfigPath } from '../database/schema/schema-notes.js';
import { assertReadOnlySql } from '../database/sql-guard.js';
import { UsageMeter } from '../llm/llm.types.js';
import { AskService, type AskResponse } from '../query/ask.service.js';
import type { Lang } from '../query/language.js';
import {
  type Category,
  type ParamValues,
  periodLabel,
  renderQuestion,
  renderSql,
  type ReportTemplate,
  resolveParams,
  sqlFor,
  templateFileSchema,
  templateSchema,
  todayIn,
} from './template.js';

export interface TemplateRunInfo {
  id: string;
  title: string;
  titleUr?: string;
  category: Category;
  alert: boolean;
  /** Resolved parameter values (dates as YYYY-MM-DD). */
  params: Record<string, string | number>;
  /** "1 Sep 2026 – 24 Sep 2026", empty for undated reports. */
  period: string;
}

export type ReportResult = AskResponse & { template: TemplateRunInfo };

export interface NewTemplate {
  title: string;
  titleUr?: string;
  description?: string;
  category?: Category;
  question: string;
  sql?: string;
}

/** Built-in templates (TEMPLATES_FILE) plus the ones users save; runs them without a model writing SQL. */
@Injectable()
export class TemplatesService implements OnModuleInit {
  private readonly logger = new Logger(TemplatesService.name);
  private builtIn: ReportTemplate[] = [];
  private readonly store: JsonStore<{ templates: ReportTemplate[] }>;

  constructor(
    private readonly config: AppConfig,
    private readonly db: DatabaseService,
    private readonly asker: AskService,
  ) {
    this.store = new JsonStore(config.get('USER_TEMPLATES_FILE'), () => ({ templates: [] }));
  }

  onModuleInit(): void {
    const file = this.config.get('TEMPLATES_FILE');
    if (!file) return;
    try {
      const parsed = templateFileSchema.parse(JSON.parse(readFileSync(resolveConfigPath(file), 'utf8')));
      this.builtIn = parsed.templates.map((t) => ({ ...t, builtIn: true }));
      this.logger.log(`Loaded ${this.builtIn.length} report templates from ${file}`);
    } catch (err) {
      this.logger.error(`Report templates not loaded from ${file}: ${(err as Error).message}`);
    }
  }

  get timezone(): string {
    return this.config.get('REPORT_TIMEZONE');
  }

  today(): string {
    return todayIn(this.timezone);
  }

  /** Templates this server can run (SQL for its engine, or a question), built-in first. */
  async list(): Promise<ReportTemplate[]> {
    const saved = (await this.store.read()).templates;
    return [...this.builtIn, ...saved].filter((t) => this.runnable(t));
  }

  async get(id: string): Promise<ReportTemplate> {
    const t = (await this.list()).find((x) => x.id === id);
    if (!t) throw new NotFoundException(`Report template "${id}" not found`);
    return t;
  }

  private runnable(t: ReportTemplate): boolean {
    return !!sqlFor(t, this.db.dialect) || !!t.question;
  }

  /** Saves a report from a chat answer. Its SQL is checked by the guard and by running it once. */
  async create(input: NewTemplate): Promise<ReportTemplate> {
    const base = input.title
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
    const id = `${base || 'report'}-${Math.random().toString(36).slice(2, 7)}`;
    let sql: string | undefined;
    if (input.sql) {
      try {
        sql = assertReadOnlySql(input.sql, this.db.dialect);
        await this.db.readOnlyQuery(sql, 1);
      } catch (err) {
        throw new BadRequestException(`This query cannot be saved: ${(err as Error).message}`);
      }
    }
    const parsed = templateSchema.safeParse({
      id,
      title: input.title,
      titleUr: input.titleUr,
      description: input.description,
      category: input.category ?? 'custom',
      icon: 'bookmark',
      question: input.question,
      sql,
      dialect: sql ? this.db.dialect : undefined,
      builtIn: false,
      createdAt: new Date().toISOString(),
    });
    if (!parsed.success) throw new BadRequestException(parsed.error.issues.map((i) => i.message).join('; '));
    await this.store.update((s) => {
      s.templates.push(parsed.data);
    });
    return parsed.data;
  }

  async remove(id: string): Promise<void> {
    if (this.builtIn.some((t) => t.id === id)) throw new ForbiddenException('Built-in reports cannot be deleted');
    const removed = await this.store.update((s) => {
      const before = s.templates.length;
      s.templates = s.templates.filter((t) => t.id !== id);
      return before !== s.templates.length;
    });
    if (!removed) throw new NotFoundException(`Report template "${id}" not found`);
  }

  /** Runs a report: verified SQL straight to the database (a model only phrases the summary), else the ask pipeline. */
  async run(id: string, opts: { params?: ParamValues; language?: Lang; answer?: boolean } = {}): Promise<ReportResult> {
    const t = await this.get(id);
    const lang = opts.language ?? 'en';
    let values: Record<string, string | number>;
    try {
      values = resolveParams(t, opts.params, this.today());
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
    const period = periodLabel(t, values);
    const title = lang === 'ur' && t.titleUr ? t.titleUr : t.title;
    const info: TemplateRunInfo = { id: t.id, title: t.title, titleUr: t.titleUr, category: t.category, alert: t.alert, params: values, period };
    const heading = period ? `${title} · ${period}` : title;
    const template = sqlFor(t, this.db.dialect);

    if (!template) {
      const res = await this.asker.ask({
        question: renderQuestion(t.question!, values),
        context: [],
        language: lang,
        answer: opts.answer ?? true,
        tier: 'fast',
        noCache: false,
      });
      return { ...res, question: heading, template: info };
    }

    const started = performance.now();
    const sql = renderSql(template, values, this.db.dialect);
    const result = await this.db.readOnlyQuery(sql);
    const dbMs = Math.round(performance.now() - started);
    let answer: string | null = null;
    let usage = new UsageMeter().summary();
    let llmMs = 0;
    if ((opts.answer ?? true) && t.summary) {
      const described = await this.asker
        .describe(`${t.title}${period ? ` (${period})` : ''}${t.description ? `. ${t.description}` : ''}`, sql, result, lang)
        .catch((err: Error) => {
          // The numbers matter more than the prose: a model outage must not lose the report.
          this.logger.warn(`Report summary failed for ${t.id}: ${err.message}`);
          return undefined;
        });
      if (described) ({ answer, usage, llmMs } = described);
    }
    return {
      question: heading,
      language: lang,
      sql,
      answer,
      result,
      cache: null,
      attempts: 0,
      trace: { candidates: 0, repairs: 0, emptyRecheck: false, escalated: false, examples: 0 },
      schema: { tables: [], full: false, tableCount: 0, chars: 0, approxTokens: 0 },
      context: { turns: 0, engine: this.db.dialect === 'duckdb' ? 'duckdb' : 'mssql' },
      timings: { totalMs: Math.round(performance.now() - started), llmMs, dbMs },
      usage,
      template: info,
    };
  }
}
