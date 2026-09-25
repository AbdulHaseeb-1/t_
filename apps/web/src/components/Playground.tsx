import { useState } from 'react';
import { api } from '../lib/api';
import { useStored } from '../lib/hooks';
import { compact, ms, usd } from '../lib/stats';
import type { BenchConfig, CompareResponse, ModelInfo, ModelSpec } from '../lib/types';
import { ModelPicker } from './ModelPicker';
import { Banner, Icon, PreviewTable, seriesColor } from './ui';

const EXAMPLES = ['Top 5 customers by net sales this year', 'Monthly net sales in 2026', 'How many invoices were written off?'];

/** One question, several models, side by side: SQL, rows, time, tokens and whether they agree. */
export function Playground({ config, catalog }: { config: BenchConfig; catalog: ModelInfo[] }) {
  const [question, setQuestion] = useStored('bench.playground.question', '');
  const [models, setModels] = useStored<ModelSpec[]>('bench.playground.models', []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [res, setRes] = useState<CompareResponse>();

  const ask = async () => {
    setBusy(true);
    setError(undefined);
    try {
      setRes(await api.compare(question, models));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const agreeCount = res?.consensus.length ?? 0;
  const answered = res?.results.filter((r) => r.result).length ?? 0;

  return (
    <div>
      <h1 className="page-title">Playground</h1>
      <p className="page-sub">
        Ask one question of several models against {config.engine === 'duckdb' ? 'the converted .mdf file' : `the ${config.database} database`}. There is no gold answer here, so
        agreement between models is the signal.
      </p>
      {error && <Banner>{error}</Banner>}
      <div className="card card-pad" style={{ marginBottom: 20 }}>
        <div className="field">
          <label className="label" htmlFor="question">
            Question
          </label>
          <textarea
            id="question"
            className="textarea"
            placeholder="e.g. Which booking man sold the most in August?"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && question.trim().length >= 3 && models.length) void ask();
            }}
          />
          <div className="row wrap">
            {EXAMPLES.map((q) => (
              <button key={q} type="button" className="chip" onClick={() => setQuestion(q)}>
                {q}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span className="label">Models</span>
          <ModelPicker catalog={catalog} config={config} value={models} onChange={setModels} />
        </div>
        <div className="row">
          <button type="button" className="btn btn-primary btn-lg" disabled={busy || question.trim().length < 3 || !models.length} onClick={ask}>
            {busy ? <span className="spinner" /> : <Icon name="play" size={14} />} Ask {models.length > 1 ? `${models.length} models` : ''}
          </button>
          <span className="hint">Ctrl/⌘ + Enter. Caches are off, so every model really runs.</span>
        </div>
      </div>

      {res && (
        <>
          <p style={{ fontWeight: 600, margin: '0 0 12px' }}>
            {res.results.length === 1
              ? 'One model: nothing to compare against.'
              : agreeCount > 1
                ? `${agreeCount} of ${res.results.length} models returned the same data.`
                : answered > 1
                  ? 'Every model returned different data. Check the SQL to see which reading of the question is right.'
                  : 'Not enough successful answers to compare.'}
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
            {res.results.map((r, i) => {
              const inConsensus = res.consensus.includes(i);
              return (
                <div key={i} className="card card-pad" style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
                  <div className="row wrap">
                    <span className="swatch" style={{ background: seriesColor(i) }} />
                    <span style={{ fontWeight: 650 }} className="grow">
                      {r.variant}
                    </span>
                    {r.error ? (
                      <span className="badge badge-bad">
                        <Icon name="x" size={11} /> Error
                      </span>
                    ) : !r.sql ? (
                      <span className="badge">Refused</span>
                    ) : res.results.length > 1 && inConsensus ? (
                      <span className="badge badge-good">
                        <Icon name="check" size={11} /> Agrees with {agreeCount - 1}
                      </span>
                    ) : res.results.length > 1 ? (
                      <span className="badge badge-warn">
                        <Icon name="alert" size={11} /> Differs
                      </span>
                    ) : null}
                  </div>
                  {r.error && <div className="small" style={{ color: 'var(--bad)', overflowWrap: 'anywhere' }}>{r.error}</div>}
                  {r.answer && <div style={{ whiteSpace: 'pre-wrap' }}>{r.answer}</div>}
                  {r.sql && (
                    <details open={res.results.length <= 2}>
                      <summary className="small muted" style={{ cursor: 'pointer' }}>
                        SQL
                      </summary>
                      <pre className="sql" style={{ marginTop: 6 }}>
                        {r.sql}
                      </pre>
                    </details>
                  )}
                  {r.result && <PreviewTable p={{ columns: r.result.columns.map((c) => c.name), rows: r.result.rows, rowCount: r.result.rowCount }} max={10} />}
                  <div className="kv">
                    {r.timings && (
                      <>
                        <span>
                          Time <b className="num">{ms(r.timings.totalMs)}</b>
                        </span>
                        <span>
                          Model <b className="num">{ms(r.timings.llmMs)}</b>
                        </span>
                      </>
                    )}
                    {r.usage && (
                      <>
                        <span>
                          Tokens <b className="num">{compact(r.usage.promptTokens + r.usage.completionTokens)}</b>
                        </span>
                        <span>
                          Cost <b className="num">{usd(r.usage.costUsd)}</b>
                        </span>
                      </>
                    )}
                    {r.trace?.repairs ? <span>{r.trace.repairs} repair(s)</span> : null}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
