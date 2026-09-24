import { useMemo, useState } from 'react';
import { CATEGORY_LABEL, compact, counts, ms, pct, specFromOverrides, usd, wilson } from '../lib/stats';
import type { Category, VariantSummary } from '../lib/types';
import { seriesColor } from './ui';

type SortKey = 'accuracy' | 'firstTry' | 'p50' | 'p95' | 'cost' | 'perCorrect' | 'tokens';

interface Row {
  s: VariantSummary;
  color: number;
  correct: number;
  total: number;
  lo: number;
  hi: number;
  tokensPerCase: number;
}

/** Tokens were spent but no price is known: show a dash, never a misleading $0. */
export const unpriced = (s: VariantSummary) => s.cost.totalUsd === 0 && s.tokens.llmCalls > 0;

const SORTS: Record<SortKey, { get: (r: Row) => number; better: 'high' | 'low' }> = {
  accuracy: { get: (r) => r.s.accuracy, better: 'high' },
  firstTry: { get: (r) => r.s.firstTryAccuracy, better: 'high' },
  p50: { get: (r) => r.s.latency.p50Ms, better: 'low' },
  p95: { get: (r) => r.s.latency.p95Ms, better: 'low' },
  cost: { get: (r) => (unpriced(r.s) ? Infinity : r.s.cost.perQuestionUsd), better: 'low' },
  perCorrect: { get: (r) => (unpriced(r.s) ? Infinity : r.s.cost.perCorrectUsd || Infinity), better: 'low' },
  tokens: { get: (r) => r.tokensPerCase, better: 'low' },
};

/** One row per model: accuracy with its 95% interval, then speed and cost. Best value per column in bold. */
export function Leaderboard({ summaries, variants }: { summaries: VariantSummary[]; variants: string[] }) {
  const [sort, setSort] = useState<SortKey>('accuracy');
  const repeats = Math.max(1, ...summaries.map((s) => s.repeats));
  const rows = useMemo(() => {
    const list: Row[] = summaries.map((s) => {
      const c = counts(s);
      const { lo, hi } = wilson(c.correct, c.total);
      const runs = Math.max(1, c.total);
      return {
        s,
        color: Math.max(0, variants.indexOf(s.variant)),
        ...c,
        lo,
        hi,
        tokensPerCase: (s.tokens.prompt + s.tokens.completion) / runs,
      };
    });
    const { get, better } = SORTS[sort];
    return list.sort((a, b) => (better === 'high' ? get(b) - get(a) : get(a) - get(b)));
  }, [summaries, variants, sort]);

  const best = (key: SortKey) => {
    const vals = rows.map((r) => SORTS[key].get(r)).filter(Number.isFinite);
    if (rows.length < 2 || !vals.length) return undefined;
    return SORTS[key].better === 'high' ? Math.max(...vals) : Math.min(...vals);
  };
  const cls = (key: SortKey, r: Row) => (best(key) !== undefined && SORTS[key].get(r) === best(key) ? 'best' : undefined);
  const th = (key: SortKey, label: string, title?: string) => (
    <th
      className="sortable r"
      title={title}
      aria-sort={sort === key ? (SORTS[key].better === 'high' ? 'descending' : 'ascending') : undefined}
      onClick={() => setSort(key)}
    >
      {label}
      {sort === key ? ' ↓' : ''}
    </th>
  );
  const anyInfra = rows.some((r) => r.s.infraErrors > 0);

  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th style={{ width: 28 }}>#</th>
            <th>Model</th>
            <th className="sortable" aria-sort={sort === 'accuracy' ? 'descending' : undefined} onClick={() => setSort('accuracy')} title="Share of scored runs whose result matched gold. Whisker: 95% confidence interval.">
              Accuracy{sort === 'accuracy' ? ' ↓' : ''}
            </th>
            {th('firstTry', 'First try', 'Correct without repair, re-check or escalation')}
            {repeats > 1 && <th className="r" title="Cases solved in every repeat">Always right</th>}
            {repeats > 1 && <th className="r" title="Cases with the same verdict in every repeat">Stable</th>}
            {th('p50', 'Median', 'Median time per question')}
            {th('p95', 'p95', '95th percentile time per question')}
            {th('cost', '$ / question')}
            {th('perCorrect', '$ / correct', 'Total cost divided by correct answers')}
            {th('tokens', 'Tokens / q', 'Prompt + completion tokens per question')}
            {anyInfra && <th className="r" title="Rate limits and outages; excluded from accuracy">Provider errors</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const spec = specFromOverrides(r.s.overrides);
            return (
              <tr key={r.s.variant}>
                <td className="num muted">{i + 1}</td>
                <td>
                  <div className="row">
                    <span className="swatch" style={{ background: seriesColor(r.color) }} />
                    <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{r.s.variant}</span>
                  </div>
                  {spec && (
                    <div className="small faint" style={{ paddingLeft: 18 }}>
                      {spec.provider}
                      {spec.reasoningEffort ? ` · effort ${spec.reasoningEffort}` : ''}
                    </div>
                  )}
                </td>
                <td>
                  <div className="acc" title={`${r.correct}/${r.total} correct · 95% CI ${pct(r.lo)}–${pct(r.hi)}`}>
                    <span className={`num ${cls('accuracy', r) ?? ''}`} style={{ textAlign: 'right' }}>
                      {pct(r.s.accuracy)}
                    </span>
                    <span className="acc-track" aria-hidden>
                      <span className="acc-fill" style={{ width: `${r.s.accuracy * 100}%`, background: seriesColor(r.color) }} />
                      <span className="acc-ci" style={{ left: `${r.lo * 100}%`, width: `${Math.max(0.5, (r.hi - r.lo) * 100)}%` }} />
                    </span>
                  </div>
                  <div className="small faint num">
                    {r.correct}/{r.total} · CI {pct(r.lo, 0)}–{pct(r.hi, 0)}
                  </div>
                </td>
                <td className={`r num ${cls('firstTry', r) ?? ''}`}>{pct(r.s.firstTryAccuracy)}</td>
                {repeats > 1 && <td className="r num">{pct(r.s.passAllK)}</td>}
                {repeats > 1 && <td className="r num">{pct(r.s.stability)}</td>}
                <td className={`r num ${cls('p50', r) ?? ''}`}>{ms(r.s.latency.p50Ms)}</td>
                <td className={`r num ${cls('p95', r) ?? ''}`}>{ms(r.s.latency.p95Ms)}</td>
                <td className={`r num ${cls('cost', r) ?? ''}`} title={unpriced(r.s) ? 'No public price for this model' : undefined}>
                  {unpriced(r.s) ? '—' : usd(r.s.cost.perQuestionUsd)}
                </td>
                <td className={`r num ${cls('perCorrect', r) ?? ''}`}>{r.s.cost.perCorrectUsd && !unpriced(r.s) ? usd(r.s.cost.perCorrectUsd) : '—'}</td>
                <td className={`r num ${cls('tokens', r) ?? ''}`}>{compact(r.tokensPerCase)}</td>
                {anyInfra && <td className="r num">{r.s.infraErrors || ''}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Accuracy by topic and difficulty: one hue, darker = more accurate, the number always printed. */
export function BreakdownTable({ summaries, variants }: { summaries: VariantSummary[]; variants: string[] }) {
  const ordered = variants.map((v) => summaries.find((s) => s.variant === v)).filter((s): s is VariantSummary => !!s);
  const tagN = new Map<string, number>();
  for (const s of ordered) for (const [t, r] of Object.entries(s.byTag)) tagN.set(t, Math.max(tagN.get(t) ?? 0, r.total));
  const tags = [...tagN.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  const diffs = ['easy', 'medium', 'hard'].filter((d) => ordered.some((s) => s.byDifficulty[d]));
  const cell = (r?: { correct: number; total: number; accuracy: number }) =>
    r ? (
      <td className="r num" title={`${r.correct}/${r.total}`} style={{ background: `rgba(var(--seq), ${0.06 + r.accuracy * 0.42})` }}>
        {pct(r.accuracy, 0)}
      </td>
    ) : (
      <td className="r faint">—</td>
    );
  const header = (
    <tr>
      <th />
      <th className="r">n</th>
      {ordered.map((s) => (
        <th key={s.variant} className="r">
          <span className="row" style={{ justifyContent: 'flex-end' }}>
            <span className="swatch" style={{ background: seriesColor(variants.indexOf(s.variant)) }} />
            <span style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.variant}</span>
          </span>
        </th>
      ))}
    </tr>
  );
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>{header}</thead>
        <tbody>
          {diffs.map((d) => (
            <tr key={`d-${d}`}>
              <td>
                <span className="badge">{d}</span>
              </td>
              <td className="r num muted">{Math.max(...ordered.map((s) => s.byDifficulty[d]?.total ?? 0))}</td>
              {ordered.map((s) => cell(s.byDifficulty[d]))}
            </tr>
          ))}
          {tags.map((t) => (
            <tr key={`t-${t}`}>
              <td>{t}</td>
              <td className="r num muted">{tagN.get(t)}</td>
              {ordered.map((s) => cell(s.byTag[t]))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** How each model fails: counts per failure type (only types that occurred). */
export function FailureTable({ summaries, variants }: { summaries: VariantSummary[]; variants: string[] }) {
  const ordered = variants.map((v) => summaries.find((s) => s.variant === v)).filter((s): s is VariantSummary => !!s);
  const cats = (Object.keys(CATEGORY_LABEL) as Category[]).filter((c) => c !== 'correct' && ordered.some((s) => s.categories[c]));
  if (!cats.length) return <div className="empty small">No failures: every scored run matched gold.</div>;
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th>Failure</th>
            {ordered.map((s) => (
              <th key={s.variant} className="r">
                <span className="row" style={{ justifyContent: 'flex-end' }}>
                  <span className="swatch" style={{ background: seriesColor(variants.indexOf(s.variant)) }} />
                  <span style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.variant}</span>
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cats.map((c) => (
            <tr key={c}>
              <td>{CATEGORY_LABEL[c]}</td>
              {ordered.map((s) => (
                <td key={s.variant} className="r num">
                  {s.categories[c] ?? <span className="faint">0</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
