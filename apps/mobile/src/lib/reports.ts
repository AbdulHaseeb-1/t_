import type { Strings } from '../i18n';
import type { Frequency, ParamValues, ReportCategory, ReportTemplate, TemplateParam } from './api';

export const CATEGORY_ORDER: ReportCategory[] = ['sales', 'stock', 'customers', 'finance', 'team', 'custom'];

export const CATEGORY_ICON: Record<ReportCategory, string> = {
  sales: 'trending-up',
  stock: 'package',
  customers: 'users',
  finance: 'dollar-sign',
  team: 'briefcase',
  custom: 'bookmark',
};

export function categoryLabel(c: ReportCategory, t: Strings): string {
  return { sales: t.catSales, stock: t.catStock, customers: t.catCustomers, finance: t.catFinance, team: t.catTeam, custom: t.catCustom }[c];
}

export function templateTitle(r: Pick<ReportTemplate, 'title' | 'titleUr'>, lang: 'en' | 'ur'): string {
  return lang === 'ur' && r.titleUr ? r.titleUr : r.title;
}

export function templateDescription(r: Pick<ReportTemplate, 'description' | 'descriptionUr'>, lang: 'en' | 'ur'): string | undefined {
  return lang === 'ur' && r.descriptionUr ? r.descriptionUr : r.description;
}

export function paramLabel(p: TemplateParam, lang: 'en' | 'ur'): string {
  return lang === 'ur' && p.labelUr ? p.labelUr : p.label;
}

const DAY = 86_400_000;
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** The same date tokens the server understands, resolved for display ("This month" -> 2026-09-01). */
export function resolveDate(token: string, today: string): string {
  const [y, m] = today.split('-').map(Number);
  const pad = (n: number) => String(n).padStart(2, '0');
  switch (token) {
    case 'today':
      return today;
    case 'yesterday':
      return addDays(today, -1);
    case 'week_start':
      return addDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
    case 'month_start':
      return `${y}-${pad(m)}-01`;
    case 'prev_month_start':
      return m === 1 ? `${y - 1}-12-01` : `${y}-${pad(m - 1)}-01`;
    case 'prev_month_end':
      return addDays(`${y}-${pad(m)}-01`, -1);
    case 'year_start':
      return `${y}-01-01`;
  }
  const rel = /^([+-])(\d{1,4})d$/.exec(token);
  return rel ? addDays(today, (rel[1] === '-' ? -1 : 1) * Number(rel[2])) : token;
}

export interface Preset {
  value: string;
  label: string;
}

/**
 * Date choices that fit a parameter: forward-looking ones for "expiring
 * before", period starts for "from", period ends for "to", days otherwise.
 */
export function datePresets(p: TemplateParam, t: Strings): Preset[] {
  const d = String(p.default);
  if (d.startsWith('+')) {
    return [
      { value: '+30d', label: t.presetIn30 },
      { value: '+90d', label: t.presetIn90 },
    ];
  }
  if (/start/.test(d) || p.name === 'from') {
    return [
      { value: 'today', label: t.presetToday },
      { value: 'week_start', label: t.presetWeek },
      { value: 'month_start', label: t.presetMonth },
      { value: 'prev_month_start', label: t.presetLastMonth },
      { value: 'year_start', label: t.presetYear },
    ];
  }
  if (p.name === 'to') {
    return [
      { value: 'today', label: t.presetToday },
      { value: 'yesterday', label: t.presetYesterday },
      { value: 'prev_month_end', label: t.presetLastMonth },
    ];
  }
  return [
    { value: 'today', label: t.presetToday },
    { value: 'yesterday', label: t.presetYesterday },
  ];
}

export function defaultParams(r: Pick<ReportTemplate, 'params'>): ParamValues {
  return Object.fromEntries(r.params.map((p) => [p.name, p.default]));
}

/** "From" = "This month" + "To" = "Today" reads as one period chip in a summary. */
export function paramSummary(r: Pick<ReportTemplate, 'params'>, values: ParamValues, t: Strings, lang: 'en' | 'ur'): string {
  return r.params
    .map((p) => {
      const v = values[p.name] ?? p.default;
      if (p.type === 'number') return `${paramLabel(p, lang)}: ${v}`;
      const preset = datePresets(p, t).find((x) => x.value === v);
      return preset ? preset.label : String(v);
    })
    .join(' – ');
}

/** What the user bubble says when a report runs: "📊 Top customers · This month – Today". */
export function reportLabel(r: ReportTemplate, values: ParamValues, t: Strings, lang: 'en' | 'ur'): string {
  const summary = paramSummary(r, values, t, lang);
  return `📊 ${templateTitle(r, lang)}${summary ? ` · ${summary}` : ''}`;
}

export function validDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** "Every day at 09:00" / "روزانہ 09:00 بجے", in the app's language. */
export function describeFrequency(f: Frequency, t: Strings, language: 'en' | 'ur'): string {
  if (f.type === 'cron') return f.expr;
  if (f.type === 'daily') return t.everyDayAt(f.time);
  if (f.type === 'weekly') return t.daysAt([...new Set(f.weekdays)].sort().map((d) => t.weekdaysShort[d]).join(language === 'ur' ? '، ' : ', '), f.time);
  return f.day === 'last' ? t.lastDayAt(f.time) : t.monthDayAt(f.day, f.time);
}
