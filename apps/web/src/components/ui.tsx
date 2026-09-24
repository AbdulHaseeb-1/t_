import type { ReactNode } from 'react';
import type { CaseResult, Preview } from '../lib/types';

export const seriesColor = (i: number) => `var(--c${i % 6})`;

type IconName = 'check' | 'x' | 'alert' | 'play' | 'stop' | 'trash' | 'download' | 'key' | 'plus' | 'close' | 'refresh' | 'sun' | 'moon' | 'chevron';

const PATHS: Record<IconName, string> = {
  check: 'M4 12.5l5 5L20 6.5',
  x: 'M6 6l12 12M18 6L6 18',
  alert: 'M12 8v5M12 16.5v.5M10.3 3.9L2.4 17.6A2 2 0 004.1 20.6h15.8a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z',
  play: 'M7 5l12 7-12 7z',
  stop: 'M7 7h10v10H7z',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  key: 'M15 7a4 4 0 11-3.9 5H4v3H2v-5h9.1A4 4 0 0115 7zm0 3v.01',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
  refresh: 'M20 12a8 8 0 11-2.3-5.7M20 4v5h-5',
  sun: 'M12 4V2M12 22v-2M4 12H2M22 12h-2M5 5L3.6 3.6M20.4 20.4L19 19M5 19l-1.4 1.4M20.4 3.6L19 5M12 8a4 4 0 100 8 4 4 0 000-8z',
  moon: 'M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z',
  chevron: 'M9 6l6 6-6 6',
};

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={PATHS[name]} />
    </svg>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="row" role="status">
      <span className="spinner" />
      {label && <span className="muted">{label}</span>}
    </span>
  );
}

export function Banner({ kind = 'error', children }: { kind?: 'error' | 'warn' | 'info'; children: ReactNode }) {
  return (
    <div className={`banner ${kind === 'warn' ? 'banner-warn' : kind === 'info' ? 'banner-info' : ''}`} role={kind === 'error' ? 'alert' : undefined}>
      <Icon name="alert" />
      <div className="grow">{children}</div>
    </div>
  );
}

export function Switch({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="switch">
      <span className="grow">
        <span className="label">{label}</span>
        {hint && <span className="hint" style={{ display: 'block' }}>{hint}</span>}
      </span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Correct / wrong / mixed across repeats, with an icon so status never rests on colour alone. */
export function VerdictCell({ correct, total, label }: { correct: number; total: number; label?: string }) {
  if (total === 0) {
    return (
      <span className="cell-na" title="Not scored (provider error)">
        —
      </span>
    );
  }
  const text = total > 1 ? `${correct}/${total}` : correct ? 'Pass' : 'Fail';
  const cls = correct === total ? 'cell-ok' : correct === 0 ? 'cell-bad' : 'cell-mixed';
  const icon = correct === total ? 'check' : correct === 0 ? 'x' : 'alert';
  return (
    <span className={cls} aria-label={label ? `${label}: ${correct} of ${total} correct` : undefined}>
      <Icon name={icon} size={12} />
      {text}
    </span>
  );
}

export function VerdictBadge({ r }: { r: Pick<CaseResult, 'verdict' | 'category'> }) {
  if (r.verdict === 'correct') {
    return (
      <span className="badge badge-good">
        <Icon name="check" size={11} /> Correct
      </span>
    );
  }
  if (r.category === 'llm_error') {
    return (
      <span className="badge badge-warn">
        <Icon name="alert" size={11} /> Provider error
      </span>
    );
  }
  return (
    <span className="badge badge-bad">
      <Icon name="x" size={11} /> {r.verdict === 'error' ? 'Error' : 'Wrong'}
    </span>
  );
}

export function cellText(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 4 });
  if (typeof v === 'object') return JSON.stringify(v);
  const s = String(v);
  const d = /^(\d{4}-\d{2}-\d{2})T00:00:00(\.0+)?Z$/.exec(s);
  return d ? d[1] : s;
}

export function PreviewTable({ p, max = 8 }: { p: Preview; max?: number }) {
  return (
    <div className="preview">
      <table className="data">
        <thead>
          <tr>
            {p.columns.map((c, i) => (
              <th key={i}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {p.rows.slice(0, max).map((r, i) => (
            <tr key={i}>
              {r.map((v, j) => (
                <td key={j} className={typeof v === 'number' ? 'r num' : undefined}>
                  {cellText(v)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {p.rowCount > Math.min(max, p.rows.length) && <div className="hint" style={{ padding: '6px 9px' }}>{p.rowCount.toLocaleString()} rows in total</div>}
    </div>
  );
}

export function download(name: string, content: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
