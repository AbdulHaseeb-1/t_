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

export function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export function plural(n: number, word: string): string {
  return `${numberFmt.format(n)} ${word}${n === 1 ? '' : 's'}`;
}
