const numberFmt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

export function formatCell(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return numberFmt.format(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  const s = String(v);
  // Midnight timestamps are dates.
  const d = /^(\d{4}-\d{2}-\d{2})T00:00:00(\.0+)?Z$/.exec(s);
  return d ? d[1] : s;
}

/** Seconds in the interface language (a Latin unit inside Urdu text reads backwards). */
export function formatDuration(ms: number, lang: 'en' | 'ur' = 'en'): string {
  const s = Math.max(0.1, ms / 1000).toFixed(1);
  return lang === 'ur' ? `${s} سیکنڈ` : `${s} s`;
}

export function plural(n: number, word: string): string {
  return `${numberFmt.format(n)} ${word}${n === 1 ? '' : 's'}`;
}

/** 842 -> "842", 12_345 -> "12.3K". */
export function formatTokens(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 1e6) return `${(n / 1000).toFixed(n < 1e4 ? 1 : 0).replace(/\.0$/, '')}K`;
  return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
}

/** Tiny API costs stay readable: $0.00042 -> "$0.0004", below that "< $0.0001". */
export function formatCost(usd: number | undefined): string {
  if (usd === undefined) return '—';
  if (usd === 0) return '$0';
  if (usd < 0.0001) return '< $0.0001';
  return `$${usd < 0.01 ? usd.toFixed(4) : usd.toFixed(3)}`;
}

/** Short durations in ms, longer ones in seconds. */
export function formatMs(ms: number, lang: 'en' | 'ur' = 'en'): string {
  if (ms < 1000) return lang === 'ur' ? `${Math.round(ms)} ملی سیکنڈ` : `${Math.round(ms)} ms`;
  return formatDuration(ms, lang);
}

/** "Thu 24 Sep, 09:00" in the device's time zone. */
export function formatWhen(iso: string, lang: 'en' | 'ur' = 'en'): string {
  return new Date(iso).toLocaleString(lang === 'ur' ? 'ur-PK' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
