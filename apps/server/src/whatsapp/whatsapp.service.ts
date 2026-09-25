import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { LRUCache } from 'lru-cache';
import { AppConfig } from '../config/app-config.js';
import { AnalystService } from '../query/analyst/analyst.service.js';
import { detectLanguage, type Lang } from '../query/language.js';
import { MediaService } from '../query/media.service.js';
import type { ChatTurn } from '../query/query.dto.js';
import type { ReportTemplate } from '../reports/template.js';
import { TemplatesService } from '../reports/templates.service.js';
import { answerMessage } from './format.js';
import { WhatsAppClient, WhatsAppError } from './whatsapp.client.js';

interface IncomingMessage {
  id: string;
  from: string;
  type: string;
  text?: { body: string };
  audio?: { id: string; mime_type?: string };
  voice?: { id: string; mime_type?: string };
  image?: { id: string; mime_type?: string; caption?: string };
  interactive?: { type: string; list_reply?: { id: string; title: string }; button_reply?: { id: string; title: string } };
}

interface WebhookBody {
  object?: string;
  entry?: { changes?: { value?: { messages?: IncomingMessage[] } }[] }[];
}

interface Conversation {
  turns: ChatTurn[];
  lang: Lang;
}

const PAGE = 9;
const MENU_WORDS = /^(menu|reports?|help|hi|hello|salam|assalam.*|start|list|رپورٹ|رپورٹس|مینو|مدد)$/i;
const RESET_WORDS = /^(new|reset|clear|نیا)$/i;

const TEXT: Record<'en' | 'ur', Record<string, string>> = {
  en: {
    menuBody: 'Tap a report to get it now, or just ask a question: text, voice note or photo.',
    menuButton: 'Reports',
    more: 'More reports…',
    moreDesc: 'Show the next page',
    notAllowed: 'This number is not allowed to use the reports bot. Ask your administrator to add it.',
    unsupported: 'Send a question as text, a voice note or a photo, or type *reports* for the menu.',
    reset: 'Started a new conversation.',
    failed: 'Sorry, that did not work',
    heard: 'Heard',
  },
  ur: {
    menuBody: 'فوری رپورٹ کے لیے کسی رپورٹ پر ٹیپ کریں، یا سوال پوچھیں: لکھ کر، وائس نوٹ یا تصویر سے۔',
    menuButton: 'رپورٹس',
    more: 'مزید رپورٹس…',
    moreDesc: 'اگلا صفحہ',
    notAllowed: 'یہ نمبر رپورٹس بوٹ استعمال کرنے کی اجازت نہیں رکھتا۔ اپنے ایڈمن سے شامل کروائیں۔',
    unsupported: 'سوال لکھ کر، وائس نوٹ یا تصویر کے ذریعے بھیجیں، یا مینو کے لیے *رپورٹ* لکھیں۔',
    reset: 'نئی گفتگو شروع ہو گئی۔',
    failed: 'معذرت، یہ نہیں ہو سکا',
    heard: 'سنا گیا',
  },
};

/**
 * WhatsApp as a front end: allow-listed numbers ask questions (text, voice
 * note, photo) through the same pipeline as the app, and tap reports from a
 * menu. Also delivers scheduled reports.
 */
@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);
  private readonly client?: WhatsAppClient;
  private readonly seen = new LRUCache<string, true>({ max: 5000, ttl: 24 * 3600_000 });
  private readonly conversations = new LRUCache<string, Conversation>({ max: 2000, ttl: 30 * 60_000 });
  private readonly refused = new LRUCache<string, true>({ max: 1000, ttl: 24 * 3600_000 });
  private readonly pending = new Set<Promise<void>>();

  constructor(
    private readonly config: AppConfig,
    private readonly analyst: AnalystService,
    private readonly media: MediaService,
    private readonly templates: TemplatesService,
  ) {
    const token = config.get('WHATSAPP_TOKEN');
    const phone = config.get('WHATSAPP_PHONE_NUMBER_ID');
    if (token && phone) this.client = new WhatsAppClient(config.get('WHATSAPP_GRAPH_URL'), phone, token, config.get('LLM_TIMEOUT_MS'));
  }

  /** Sending works (token + phone number id). */
  get configured(): boolean {
    return !!this.client;
  }

  /** Receiving works too: the webhook can be verified and its calls authenticated. */
  get webhookReady(): boolean {
    return this.configured && !!this.config.get('WHATSAPP_VERIFY_TOKEN') && !!this.config.get('WHATSAPP_APP_SECRET');
  }

  verifyChallenge(mode?: string, token?: string): boolean {
    const expected = this.config.get('WHATSAPP_VERIFY_TOKEN');
    return mode === 'subscribe' && !!expected && token === expected;
  }

  /** Meta signs each webhook call with the app secret: HMAC-SHA256 of the raw body. */
  validSignature(raw: Buffer | undefined, header: string | undefined): boolean {
    const secret = this.config.get('WHATSAPP_APP_SECRET');
    if (!secret || !raw || !header?.startsWith('sha256=')) return false;
    const expected = Buffer.from(`sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`);
    const given = Buffer.from(header);
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  allowed(from: string): boolean {
    const list = this.config.get('WHATSAPP_ALLOWED_NUMBERS').map((n) => n.replace(/\D/g, ''));
    return list.includes('*') || list.includes(from);
  }

  /** Accepts a webhook payload and processes its messages in the background (Meta wants a fast 200). */
  accept(body: WebhookBody): number {
    let n = 0;
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        for (const msg of change.value?.messages ?? []) {
          // Meta retries deliveries: each message id is handled once.
          if (!msg?.id || this.seen.has(msg.id)) continue;
          this.seen.set(msg.id, true);
          n++;
          const p = this.handle(msg)
            .catch((err: Error) => this.logger.error(`WhatsApp message from ${mask(msg.from)} failed: ${err.message}`))
            .finally(() => this.pending.delete(p));
          this.pending.add(p);
        }
      }
    }
    return n;
  }

  /** Resolves when every accepted message has been answered (tests, graceful shutdown). */
  async idle(): Promise<void> {
    while (this.pending.size) await Promise.all(this.pending);
  }

  private async handle(msg: IncomingMessage): Promise<void> {
    const client = this.client!;
    const from = msg.from.replace(/\D/g, '');
    if (!this.allowed(from)) {
      this.logger.warn(`WhatsApp message from non-allowed number ${mask(from)}`);
      if (!this.refused.has(from)) {
        this.refused.set(from, true);
        await client.sendText(from, `${TEXT.en.notAllowed}\n\n${TEXT.ur.notAllowed}`);
      }
      return;
    }
    void client.markRead(msg.id).catch(() => undefined);
    const conv = this.conversations.get(from) ?? { turns: [], lang: 'en' as Lang };
    const t = (lang: Lang) => TEXT[lang === 'ur' ? 'ur' : 'en'];

    try {
      if (msg.type === 'text' && msg.text?.body) {
        const body = msg.text.body.trim();
        conv.lang = detectLanguage(body);
        if (MENU_WORDS.test(body)) return await this.sendMenu(from, conv.lang, 0);
        if (RESET_WORDS.test(body)) {
          this.conversations.delete(from);
          return void (await client.sendText(from, t(conv.lang).reset));
        }
        return await this.answer(from, conv, { question: body });
      }
      if (msg.type === 'interactive') {
        const id = msg.interactive?.list_reply?.id ?? msg.interactive?.button_reply?.id ?? '';
        if (id.startsWith('page:')) return await this.sendMenu(from, conv.lang, Number(id.slice(5)) || 0);
        if (id.startsWith('tpl:')) return await this.sendTemplateReport(from, id.slice(4), conv.lang);
      }
      const voice = msg.audio ?? msg.voice;
      if ((msg.type === 'audio' || msg.type === 'voice') && voice) {
        const file = await client.download(voice.id, this.config.get('MEDIA_MAX_AUDIO_MB') * 1e6);
        return await this.answer(from, conv, { audio: { ...file, filename: `voice.${ext(file.mimetype)}` } });
      }
      if (msg.type === 'image' && msg.image) {
        const file = await client.download(msg.image.id, this.config.get('MEDIA_MAX_IMAGE_MB') * 1e6);
        return await this.answer(from, conv, { image: { ...file, filename: `photo.${ext(file.mimetype)}` }, question: msg.image.caption ?? '' });
      }
      await client.sendText(from, t(conv.lang).unsupported);
    } catch (err) {
      const message = err instanceof WhatsAppError ? err.message : ((err as { getResponse?: () => { message?: string } }).getResponse?.().message ?? (err as Error).message);
      await client.sendText(from, `${t(conv.lang).failed}: ${String(message).slice(0, 300)}`).catch(() => undefined);
      throw err;
    }
  }

  /** Text goes straight to the chat agent; voice notes and photos through the media pipeline first. Follow-ups keep context. */
  private async answer(
    from: string,
    conv: Conversation,
    input: { question?: string; audio?: { buffer: Buffer; filename: string; mimetype: string }; image?: { buffer: Buffer; filename: string; mimetype: string } },
  ): Promise<void> {
    const res =
      input.audio || input.image
        ? await this.media.chat({ question: input.question ?? '', context: conv.turns, language: 'auto', audio: input.audio, image: input.image })
        : await this.analyst.chat({ question: input.question!, context: conv.turns, language: 'auto', tier: 'fast', noCache: false });
    conv.lang = res.language;
    conv.turns = [...conv.turns, { question: res.question, answer: res.answer.slice(0, 1500), ...(res.sql ? { sql: res.sql } : {}) }].slice(-6);
    this.conversations.set(from, conv);
    const heard = 'transcript' in res && res.transcript ? `🎤 _${TEXT[conv.lang === 'ur' ? 'ur' : 'en'].heard}: ${res.transcript}_` : undefined;
    // Headline figures are already in the sentence; tables and charts become aligned text tables.
    const tables = res.results.filter((r) => r.display.view !== 'number');
    await this.client!.sendText(
      from,
      answerMessage({ note: heard, answer: res.answer, tables: tables.map((r) => ({ title: tables.length > 1 ? r.title : undefined, result: r.result })) }),
    );
  }

  private label(t: ReportTemplate, lang: Lang) {
    return lang === 'ur' && t.titleUr ? t.titleUr : t.title;
  }

  /** Report menu as an interactive list: nine reports per page plus "More". */
  private async sendMenu(to: string, lang: Lang, page: number): Promise<void> {
    const all = await this.templates.list();
    const t = TEXT[lang === 'ur' ? 'ur' : 'en'];
    if (!all.length) return void (await this.client!.sendText(to, t.unsupported));
    const slice = all.slice(page * PAGE, page * PAGE + PAGE);
    const rows = slice.map((x) => ({
      id: `tpl:${x.id}`,
      title: this.label(x, lang),
      description: (lang === 'ur' && x.descriptionUr ? x.descriptionUr : x.description) ?? '',
    }));
    if (all.length > (page + 1) * PAGE) rows.push({ id: `page:${page + 1}`, title: t.more, description: t.moreDesc });
    await this.client!.sendList(to, { body: t.menuBody, button: t.menuButton, sections: [{ title: t.menuButton, rows }] });
  }

  private async sendTemplateReport(to: string, id: string, lang: Lang): Promise<void> {
    const r = await this.templates.run(id, { language: lang });
    const title = lang === 'ur' && r.template.titleUr ? r.template.titleUr : r.template.title;
    await this.client!.sendText(to, answerMessage({ title: `📊 ${title}`, subtitle: r.template.period, answer: r.answer, result: r.result }));
  }

  /**
   * Delivers a scheduled report. Free-form text only reaches people who wrote
   * to the bot in the last 24 hours; otherwise the approved template (if set)
   * carries the title and summary.
   */
  async sendReport(to: string, report: { title: string; text: string; summary: string }): Promise<void> {
    if (!this.client) throw new WhatsAppError('WhatsApp is not configured (WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID)');
    try {
      await this.client.sendText(to, report.text);
    } catch (err) {
      if (!(err instanceof WhatsAppError) || !err.outsideWindow) throw err;
      const template = this.config.get('WHATSAPP_REPORT_TEMPLATE');
      if (!template) {
        throw new WhatsAppError(
          `${to} has not messaged the bot in the last 24 hours, so WhatsApp only allows an approved template message. Ask them to send "hi" once a day, or set WHATSAPP_REPORT_TEMPLATE.`,
          err.code,
        );
      }
      await this.client.sendTemplate(to, template, this.config.get('WHATSAPP_TEMPLATE_LANGUAGE'), [report.title, report.summary.slice(0, 900) || '—']);
    }
  }
}

function ext(mime: string): string {
  return mime.split('/')[1]?.split(/[;+]/)[0] || 'bin';
}

/** Phone numbers in logs: last four digits only. */
function mask(n: string): string {
  return `…${n.slice(-4)}`;
}
