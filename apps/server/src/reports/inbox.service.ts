import { Injectable, NotFoundException } from '@nestjs/common';
import { JsonStore } from '../common/json-store.js';
import { AppConfig } from '../config/app-config.js';
import type { ReportResult } from './templates.service.js';

export interface Delivery {
  channel: 'app' | 'whatsapp';
  to?: string;
  status: 'sent' | 'failed';
  error?: string;
}

export interface InboxReport {
  id: string;
  scheduleId?: string;
  title: string;
  createdAt: string;
  read: boolean;
  status: 'ok' | 'failed';
  rows: number;
  /** The model's short summary, or the error for a failed run. */
  summary: string | null;
  error?: string;
  deliveries: Delivery[];
  /** Full response for the app to render (rows capped). */
  response?: ReportResult;
}

export type InboxEntry = Omit<InboxReport, 'response'>;

const KEEP = 200;
const STORED_ROWS = 200;

/** Delivered scheduled reports: what the app lists, badges and notifies about. */
@Injectable()
export class InboxService {
  private readonly store: JsonStore<{ reports: InboxReport[] }>;

  constructor(config: AppConfig) {
    this.store = new JsonStore(config.get('INBOX_FILE'), () => ({ reports: [] }));
  }

  async add(r: Omit<InboxReport, 'id' | 'createdAt' | 'read'>): Promise<InboxReport> {
    const createdAt = new Date().toISOString();
    const report: InboxReport = {
      ...r,
      id: `${createdAt.replace(/[-:.TZ]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 6)}`,
      createdAt,
      read: false,
      response: r.response?.result
        ? { ...r.response, result: { ...r.response.result, rows: r.response.result.rows.slice(0, STORED_ROWS) } }
        : r.response,
    };
    await this.store.update((s) => {
      s.reports.unshift(report);
      s.reports.length = Math.min(s.reports.length, KEEP);
    });
    return report;
  }

  /** Newest first; `since` (ISO time) returns only newer reports, for polling. */
  async list(since?: string, limit = 50): Promise<{ unread: number; reports: InboxEntry[] }> {
    const all = (await this.store.read()).reports;
    const unread = all.filter((r) => !r.read).length;
    const reports = all
      .filter((r) => !since || r.createdAt > since)
      .slice(0, limit)
      .map(({ response: _r, ...entry }) => entry);
    return { unread, reports };
  }

  async get(id: string): Promise<InboxReport> {
    const r = (await this.store.read()).reports.find((x) => x.id === id);
    if (!r) throw new NotFoundException(`Report ${id} not found`);
    return structuredClone(r);
  }

  async markRead(id?: string): Promise<void> {
    await this.store.update((s) => {
      for (const r of s.reports) if (!id || r.id === id) r.read = true;
    });
  }

  async remove(id: string): Promise<void> {
    await this.store.update((s) => {
      s.reports = s.reports.filter((r) => r.id !== id);
    });
  }
}
