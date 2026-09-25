import { Cron } from 'croner';
import { z } from 'zod';

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time as HH:MM (24-hour)');

export const frequencySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('daily'), time }),
  /** 0 = Sunday … 6 = Saturday. */
  z.object({ type: z.literal('weekly'), time, weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7) }),
  /** Day of month, or "last". Days past a month's end (31 in September) are skipped by cron, so use "last" for month end. */
  z.object({ type: z.literal('monthly'), time, day: z.union([z.number().int().min(1).max(31), z.literal('last')]) }),
  z.object({ type: z.literal('cron'), expr: z.string().min(9).max(100) }),
]);

/** Phone number in international format, digits only (WhatsApp's "to"/"from" form): 923001234567. */
export const phoneSchema = z
  .string()
  .transform((s) => s.replace(/[\s()+-]/g, ''))
  .pipe(z.string().regex(/^\d{8,15}$/, 'phone number in international format, e.g. 923001234567'));

export const scheduleInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  target: z.union([
    z.object({ templateId: z.string().min(1).max(80), params: z.record(z.string(), z.union([z.string().max(40), z.number()])).default({}) }),
    z.object({ question: z.string().trim().min(3).max(2000) }),
  ]),
  frequency: frequencySchema,
  language: z.enum(['en', 'ur', 'ur-Latn']).default('en'),
  deliver: z
    .object({
      /** In-app inbox + notification. */
      app: z.boolean().default(true),
      whatsapp: z.array(phoneSchema).max(20).default([]),
    })
    .default({ app: true, whatsapp: [] }),
  /** Deliver only when the report has rows (alerts: shortage, expiry, over-limit). Default: the template's `alert` flag. */
  onlyIfRows: z.boolean().optional(),
  enabled: z.boolean().default(true),
});

export type Frequency = z.infer<typeof frequencySchema>;
export type ScheduleInput = z.infer<typeof scheduleInputSchema>;

export type RunStatus = 'ok' | 'skipped' | 'failed' | 'missed';

export interface Schedule extends ScheduleInput {
  id: string;
  timezone: string;
  createdAt: string;
  updatedAt: string;
  nextRunAt?: string;
  lastRunAt?: string;
  lastStatus?: RunStatus;
  lastError?: string;
  lastReportId?: string;
}

/** The cron pattern behind a frequency. */
export function toCron(f: Frequency): string {
  if (f.type === 'cron') return f.expr.trim();
  const [h, m] = f.time.split(':').map(Number);
  if (f.type === 'daily') return `${m} ${h} * * *`;
  if (f.type === 'weekly') return `${m} ${h} * * ${[...new Set(f.weekdays)].sort().join(',')}`;
  return `${m} ${h} ${f.day === 'last' ? 'L' : f.day} * *`;
}

/** Next run strictly after `after`, in the schedule's time zone; throws on an invalid pattern or zone. */
export function nextRun(f: Frequency, timezone: string, after: Date): Date | undefined {
  const cron = new Cron(toCron(f), { timezone, paused: true });
  return cron.nextRun(after) ?? undefined;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Every day at 09:00", "Mon, Thu at 08:00", "Last day of the month at 18:30". */
export function describeFrequency(f: Frequency): string {
  if (f.type === 'cron') return `Cron ${f.expr}`;
  if (f.type === 'daily') return `Every day at ${f.time}`;
  if (f.type === 'weekly') return `${[...new Set(f.weekdays)].sort().map((d) => DAYS[d]).join(', ')} at ${f.time}`;
  return f.day === 'last' ? `Last day of the month at ${f.time}` : `Day ${f.day} of each month at ${f.time}`;
}
