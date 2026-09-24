import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { counts, ms, pareto, pct, usd, when, wilson } from '../lib/stats';
import type { CaseResult, RunView, StartRun } from '../lib/types';
import { CaseMatrix } from './CaseMatrix';
import { AccuracyCostChart, LatencyChart, type Point } from './Charts';
import { BreakdownTable, FailureTable, Leaderboard } from './Leaderboard';
import { Banner, download, Icon, seriesColor, Spinner } from './ui';

const LIVE = new Set(['gold', 'running']);

/** Polls a run while it is in progress (fetching only new results), then shows the full report. */
function useRun(id: string) {
  const [run, setRun] = useState<RunView>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let results: CaseResult[] = [];
    let wasLive = false;
    const tick = async () => {
      try {
        let v = await api.run(id, results.length);
        if (stopped) return;
        if (wasLive && !LIVE.has(v.status)) {
          // Finished: the saved report re-orders results, so load it whole.
          v = await api.run(id);
          results = [];
        }
        results = results.concat(v.results);
        wasLive = LIVE.has(v.status);
        setRun({ ...v, results });
        setError(undefined);
        if (wasLive) timer = setTimeout(tick, 1200);
      } catch (e) {
        if (stopped) return;
        setError((e as Error).message);
        timer = setTimeout(tick, 4000);
      }
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [id]);
  return { run, error };
}

function toCsv(run: RunView): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ['model', 'repeat', 'case', 'difficulty', 'tags', 'verdict', 'category', 'latency_ms', 'prompt_tokens', 'cached_tokens', 'completion_tokens', 'cost_usd', 'question', 'sql', 'detail'];
  const lines = run.results.map((r) =>
    [r.variant, r.repeat, r.id, r.difficulty, r.tags.join(' '), r.verdict, r.category, r.latencyMs, r.usage?.promptTokens, r.usage?.cachedPromptTokens, r.usage?.completionTokens, r.usage?.costUsd, r.question, r.sql, r.detail]
      .map(esc)
      .join(','),
  );
  return [head.join(','), ...lines].join('\n');
}

export function RunPage({ id, onRerun }: { id: string; onRerun: (req: StartRun) => void }) {
  const { run, error } = useRun(id);
  const [cancelling, setCancelling] = useState(false);

  const points: Point[] = useMemo(() => {
    if (!run) return [];
    return run.summaries.map((s) => {
      const c = counts(s);
      const ci = wilson(c.correct, c.total);
      return {
        key: s.variant,
        name: s.variant,
        color: Math.max(0, run.variants.indexOf(s.variant)),
        accuracy: s.accuracy,
        lo: ci.lo,
        hi: ci.hi,
        cost: s.cost.perQuestionUsd,
        p50: s.latency.p50Ms,
        p95: s.latency.p95Ms,
      };
    });
  }, [run]);
  const frontier = useMemo(() => pareto(points.filter((p) => p.cost > 0).map((p) => ({ key: p.key, cost: p.cost, accuracy: p.accuracy }))), [points]);

  if (!run) {
    return error ? <Banner>{error}</Banner> : <Spinner label="Loading run…" />;
  }

  const live = LIVE.has(run.status);
  const doneTotal = Object.values(run.progress.done).reduce((a, b) => a + b, 0);
  const grand = run.progress.total * run.variants.length;
  const duration = run.info?.durationS ?? (run.finishedAt ? (Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000 : (Date.now() - Date.parse(run.startedAt)) / 1000);
  const top = [...run.summaries].sort((a, b) => b.accuracy - a.accuracy)[0];
  const fastest = [...run.summaries].sort((a, b) => a.latency.p50Ms - b.latency.p50Ms)[0];
  const bestValue = frontier.length > 1 ? frontier.find((k) => (points.find((p) => p.key === k)?.accuracy ?? 0) >= (top?.accuracy ?? 1) - 0.02) : undefined;
  const brokenFixed = run.flips.reduce(
    (acc, f) => ({ ...acc, [f.to]: { fixed: (acc[f.to]?.fixed ?? 0) + (f.change === 'fixed' ? 1 : 0), broken: (acc[f.to]?.broken ?? 0) + (f.change === 'broken' ? 1 : 0) } }),
    {} as Record<string, { fixed: number; broken: number }>,
  );

  const cancel = async () => {
    setCancelling(true);
    try {
      await api.cancel(run.id);
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div>
      <div className="row wrap" style={{ alignItems: 'flex-start', marginBottom: 20 }}>
        <div style={{ flex: '1 1 280px', minWidth: 0 }}>
          <h1 className="page-title">{run.datasetName}</h1>
          <p className="page-sub" style={{ margin: 0 }}>
            {when(run.startedAt)} · {run.progress.total} case runs per model{run.request?.repeats && run.request.repeats > 1 ? ` (${run.request.repeats} repeats)` : ''} · {run.engine ?? 'engine not recorded'} · {Math.round(duration)} s
          </p>
        </div>
        <div className="row wrap">
          {live ? (
            <button type="button" className="btn btn-danger" onClick={cancel} disabled={cancelling}>
              <Icon name="stop" size={14} /> Cancel
            </button>
          ) : (
            <>
              {run.request && (
                <button type="button" className="btn" onClick={() => onRerun(run.request!)}>
                  <Icon name="refresh" size={14} /> Run again
                </button>
              )}
              <button type="button" className="btn" onClick={() => download(`${run.id}.json`, JSON.stringify(run, null, 2))}>
                <Icon name="download" size={14} /> JSON
              </button>
              <button type="button" className="btn" onClick={() => download(`${run.id}.csv`, toCsv(run), 'text/csv')}>
                <Icon name="download" size={14} /> CSV
              </button>
            </>
          )}
        </div>
      </div>

      {error && <Banner kind="warn">Lost contact with the server, retrying: {error}</Banner>}
      {run.status === 'failed' && <Banner>Run failed: {run.error}</Banner>}
      {run.status === 'cancelled' && <Banner kind="info">Cancelled. Results so far are shown below but were not saved.</Banner>}

      {live && (
        <div className="card card-pad" style={{ marginBottom: 20 }}>
          <div className="row" style={{ marginBottom: 12 }}>
            <Spinner />
            <span style={{ fontWeight: 600 }}>{run.status === 'gold' ? 'Running gold queries…' : `Running · ${doneTotal} of ${grand} case runs`}</span>
          </div>
          <div style={{ display: 'grid', gap: 10 }}>
            {run.variants.map((v, i) => {
              const done = run.progress.done[v] ?? 0;
              return (
                <div key={v} style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 220px) 1fr 70px', gap: 12, alignItems: 'center' }}>
                  <span className="row small" style={{ minWidth: 0 }}>
                    <span className="swatch" style={{ background: seriesColor(i) }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</span>
                  </span>
                  <div className="progress" role="progressbar" aria-label={`${v} progress`} aria-valuenow={done} aria-valuemax={run.progress.total}>
                    <div style={{ width: `${(done / Math.max(1, run.progress.total)) * 100}%`, background: seriesColor(i) }} />
                  </div>
                  <span className="small num muted" style={{ textAlign: 'right' }}>
                    {done}/{run.progress.total}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="hint" style={{ margin: '12px 0 0' }}>
            Models run one after another; results below update live.
          </p>
        </div>
      )}

      {run.summaries.length > 0 && (
        <>
          {!live && top && (
            <div className="grid-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', marginBottom: 20 }}>
              <div className="card card-pad stat">
                <span className="muted small">Most accurate</span>
                <span className="stat-value">{pct(top.accuracy)}</span>
                <span className="small">{top.variant}</span>
              </div>
              {bestValue && bestValue !== top.variant && (
                <div className="card card-pad stat">
                  <span className="muted small">Best value (within 2 points of the top)</span>
                  <span className="stat-value">{usd(points.find((p) => p.key === bestValue)?.cost)}</span>
                  <span className="small">{bestValue} · per question</span>
                </div>
              )}
              {fastest && run.summaries.length > 1 && (
                <div className="card card-pad stat">
                  <span className="muted small">Fastest median</span>
                  <span className="stat-value">{ms(fastest.latency.p50Ms)}</span>
                  <span className="small">{fastest.variant}</span>
                </div>
              )}
              <div className="card card-pad stat">
                <span className="muted small">Total spend</span>
                <span className="stat-value">{usd(run.summaries.reduce((a, s) => a + s.cost.totalUsd, 0))}</span>
                <span className="small">{doneTotal} case runs</span>
              </div>
            </div>
          )}

          <h2 className="section-title">Leaderboard</h2>
          <div className="card">
            <Leaderboard summaries={run.summaries} variants={run.variants} />
          </div>
          <p className="hint">
            Accuracy = the generated SQL returned the same rows as the verified gold query. The whisker is a 95% confidence interval: overlapping whiskers mean the gap could be noise.
          </p>

          <div className="grid-2" style={{ marginTop: 24 }}>
            <div className="card card-pad">
              <h3 className="card-title">Accuracy vs cost</h3>
              <p className="hint" style={{ margin: '0 0 8px' }}>
                Up and to the left is better. The dashed line joins models nothing else beats on both.
              </p>
              <AccuracyCostChart points={points} frontier={frontier} />
            </div>
            <div className="card card-pad">
              <h3 className="card-title">Time per question</h3>
              <p className="hint" style={{ margin: '0 0 8px' }}>
                End to end: model, database and repairs.
              </p>
              <LatencyChart points={points} />
            </div>
          </div>

          {/* Side by side for two models; full width beyond that so every model's column fits. */}
          <div className={run.variants.length > 2 ? undefined : 'grid-2'} style={{ marginTop: 16, display: 'grid', gap: 16, gridTemplateColumns: run.variants.length > 2 ? 'minmax(0, 1fr)' : undefined }}>
            <div className="card card-pad">
              <h3 className="card-title">By difficulty and topic</h3>
              <BreakdownTable summaries={run.summaries} variants={run.variants} />
            </div>
            <div className="card card-pad">
              <h3 className="card-title">How they fail</h3>
              <FailureTable summaries={run.summaries} variants={run.variants} />
              {Object.keys(brokenFixed).length > 0 && (
                <p className="hint" style={{ marginBottom: 0 }}>
                  Compared with {run.variants[0]}:{' '}
                  {Object.entries(brokenFixed)
                    .map(([v, x]) => `${v} fixes ${x.fixed}, breaks ${x.broken}`)
                    .join(' · ')}
                  .
                </p>
              )}
            </div>
          </div>
        </>
      )}

      {run.results.length > 0 && (
        <>
          <h2 className="section-title">Cases</h2>
          <CaseMatrix results={run.results} variants={run.variants} />
        </>
      )}
    </div>
  );
}
