import { useEffect, useMemo, useState } from 'react';
import { CATEGORY_LABEL, caseMatrix, compact, ms, usd, type MatrixRow } from '../lib/stats';
import type { CaseResult } from '../lib/types';
import { Icon, PreviewTable, Segmented, seriesColor, VerdictBadge, VerdictCell } from './ui';

type Filter = 'all' | 'disagree' | 'failed' | 'allWrong';

/** Every case against every model; click a row for gold vs each model's SQL and rows. */
export function CaseMatrix({ results, variants }: { results: CaseResult[]; variants: string[] }) {
  const rows = useMemo(() => caseMatrix(results, variants), [results, variants]);
  const [filter, setFilter] = useState<Filter>(variants.length > 1 ? 'disagree' : 'failed');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string>();

  const counts = {
    all: rows.length,
    disagree: rows.filter((r) => r.disagree).length,
    failed: rows.filter((r) => Object.values(r.cells).some((c) => c.total > c.correct)).length,
    allWrong: rows.filter((r) => r.allWrong).length,
  };
  const q = query.trim().toLowerCase();
  const shown = rows.filter(
    (r) =>
      (filter === 'all' ||
        (filter === 'disagree' && r.disagree) ||
        (filter === 'failed' && Object.values(r.cells).some((c) => c.total > c.correct)) ||
        (filter === 'allWrong' && r.allWrong)) &&
      (!q || r.id.toLowerCase().includes(q) || r.question.toLowerCase().includes(q) || r.tags.some((t) => t.toLowerCase().includes(q))),
  );
  const openRow = rows.find((r) => r.id === open);

  return (
    <div>
      <div className="row wrap" style={{ marginBottom: 10 }}>
        <Segmented<Filter>
          label="Filter cases"
          value={filter}
          onChange={setFilter}
          options={[
            ...(variants.length > 1 ? [{ value: 'disagree' as const, label: `Models disagree (${counts.disagree})` }] : []),
            { value: 'failed', label: `Any failure (${counts.failed})` },
            ...(variants.length > 1 ? [{ value: 'allWrong' as const, label: `All wrong (${counts.allWrong})` }] : []),
            { value: 'all', label: `All (${counts.all})` },
          ]}
        />
        <span className="spacer" />
        <input className="input" style={{ maxWidth: 240 }} placeholder="Search cases" aria-label="Search cases" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="card">
        {shown.length === 0 ? (
          <div className="empty small">{filter === 'disagree' ? 'Every model reached the same verdict on every case.' : 'No cases match.'}</div>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Case</th>
                  {variants.map((v, i) => (
                    <th key={v} className="r" title={v}>
                      <span className="row" style={{ justifyContent: 'flex-end' }}>
                        <span className="swatch" style={{ background: seriesColor(i) }} />
                        <span style={{ maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis' }}>{v}</span>
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} className="clickable" onClick={() => setOpen(r.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpen(r.id)}>
                    <td style={{ maxWidth: 520 }}>
                      <div className="row" style={{ gap: 6 }}>
                        <span className="mono faint">{r.id}</span>
                        <span className="badge">{r.difficulty}</span>
                        {r.allWrong && variants.length > 1 && (
                          <span className="badge badge-warn" title="Every model failed: check the gold query or the schema notes">
                            all wrong
                          </span>
                        )}
                      </div>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.question}</div>
                    </td>
                    {variants.map((v) => {
                      const c = r.cells[v];
                      return (
                        <td key={v} className="r">
                          {c ? <VerdictCell correct={c.correct} total={c.total} label={v} /> : <span className="faint small">…</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {openRow && <CaseDrawer row={openRow} variants={variants} onClose={() => setOpen(undefined)} />}
    </div>
  );
}

function CaseDrawer({ row, variants, onClose }: { row: MatrixRow; variants: string[]; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const any = Object.values(row.cells)[0]?.results[0];

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={`Case ${row.id}`}>
        <div className="drawer-head">
          <div className="grow">
            <div className="row small muted">
              <span className="mono">{row.id}</span>
              <span className="badge">{row.difficulty}</span>
              {row.tags.map((t) => (
                <span key={t} className="badge">
                  {t}
                </span>
              ))}
            </div>
            <div style={{ fontWeight: 650, fontSize: 16, marginTop: 4 }}>{row.question}</div>
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <div className="drawer-body">
          {any?.expect === 'refusal' ? (
            <div className="card card-pad">
              <div className="label">Expected</div>
              <div className="muted">The correct behaviour is to refuse: the database cannot answer this.</div>
            </div>
          ) : (
            <div className="card card-pad">
              <div className="row" style={{ marginBottom: 8 }}>
                <span className="label">Gold</span>
                <span className="hint">the verified query; its rows are the ground truth</span>
              </div>
              {any?.goldSql && <pre className="sql">{any.goldSql}</pre>}
              {any?.gold && (
                <div style={{ marginTop: 10 }}>
                  <PreviewTable p={any.gold} />
                </div>
              )}
            </div>
          )}

          {variants.map((v, i) => {
            const cell = row.cells[v];
            if (!cell) return null;
            return (
              <div key={v} className="card card-pad">
                <div className="row wrap" style={{ marginBottom: 8 }}>
                  <span className="swatch" style={{ background: seriesColor(i) }} />
                  <span style={{ fontWeight: 650 }}>{v}</span>
                  <span className="spacer" />
                  <VerdictCell correct={cell.correct} total={cell.total} />
                </div>
                {cell.results.map((r) => (
                  <Attempt key={r.repeat} r={r} showRepeat={cell.results.length > 1} />
                ))}
              </div>
            );
          })}
        </div>
      </aside>
    </>
  );
}

function Attempt({ r, showRepeat }: { r: CaseResult; showRepeat: boolean }) {
  const flags = [
    r.trace?.repairs ? `${r.trace.repairs} repair${r.trace.repairs > 1 ? 's' : ''}` : '',
    r.trace?.emptyRecheck ? 'empty-result re-check' : '',
    r.trace?.escalated ? 'escalated' : '',
    r.trace?.votes ? `vote ${r.trace.agreement}/${r.trace.votes}` : '',
  ].filter(Boolean);
  return (
    <div style={{ borderTop: showRepeat ? '1px solid var(--grid)' : undefined, paddingTop: showRepeat ? 10 : 0, marginTop: showRepeat ? 10 : 0 }}>
      <div className="row wrap" style={{ marginBottom: 6 }}>
        {showRepeat && <span className="small muted">Repeat {r.repeat + 1}</span>}
        <VerdictBadge r={r} />
        {r.category !== 'correct' && <span className="small">{CATEGORY_LABEL[r.category]}</span>}
      </div>
      {r.detail && r.category !== 'correct' && (
        <div className="small muted" style={{ marginBottom: 8, overflowWrap: 'anywhere' }}>
          {r.detail}
        </div>
      )}
      {r.sql && <pre className="sql">{r.sql}</pre>}
      {r.predicted && (
        <div style={{ marginTop: 8 }}>
          <PreviewTable p={r.predicted} />
        </div>
      )}
      {r.answer && (
        <div className="small" style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>
          {r.answer}
        </div>
      )}
      <div className="kv" style={{ marginTop: 8 }}>
        <span>
          Time <b className="num">{ms(r.latencyMs)}</b>
        </span>
        <span>
          Model <b className="num">{ms(r.llmMs)}</b>
        </span>
        <span>
          Database <b className="num">{ms(r.dbMs)}</b>
        </span>
        {r.usage && (
          <>
            <span>
              Tokens <b className="num">{compact(r.usage.promptTokens)}</b> in ({compact(r.usage.cachedPromptTokens)} cached) · <b className="num">{compact(r.usage.completionTokens)}</b> out
            </span>
            <span>
              Cost <b className="num">{usd(r.usage.costUsd)}</b>
            </span>
            <span>
              Calls <b className="num">{r.usage.llmCalls}</b>
            </span>
          </>
        )}
        {flags.length > 0 && <span>{flags.join(' · ')}</span>}
      </div>
    </div>
  );
}
