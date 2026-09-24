import { useState } from 'react';
import { api } from '../lib/api';
import { useAsync } from '../lib/hooks';
import { pct, usd, when } from '../lib/stats';
import { Banner, Icon, Spinner } from './ui';

/** Every saved run (web and CLI), newest first. */
export function History({ onOpen }: { onOpen: (id: string) => void }) {
  const runs = useAsync(() => api.runs(), []);
  const [error, setError] = useState<string>();
  const [dataset, setDataset] = useState('');

  const remove = async (id: string) => {
    if (!window.confirm(`Delete run ${id}? Its report files are removed from the server.`)) return;
    try {
      await api.remove(id);
      runs.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const list = (runs.data ?? []).filter((r) => !dataset || r.dataset === dataset);
  const datasets = [...new Set((runs.data ?? []).map((r) => r.dataset))];

  return (
    <div>
      <div className="row wrap" style={{ alignItems: 'flex-end', marginBottom: 20 }}>
        <div className="grow">
          <h1 className="page-title">History</h1>
          <p className="page-sub" style={{ margin: 0 }}>
            Runs from this page and from <span className="mono">pnpm eval</span>, stored in the server’s report folder.
          </p>
        </div>
        {datasets.length > 1 && (
          <select className="select" style={{ width: 200 }} value={dataset} onChange={(e) => setDataset(e.target.value)} aria-label="Filter by dataset">
            <option value="">All datasets</option>
            {datasets.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        )}
        <button type="button" className="btn" onClick={runs.reload}>
          <Icon name="refresh" size={14} /> Refresh
        </button>
      </div>
      {(error || runs.error) && <Banner>{error ?? runs.error?.message}</Banner>}
      {runs.loading && !runs.data ? (
        <Spinner label="Loading runs…" />
      ) : list.length === 0 ? (
        <div className="card empty">No runs yet. Start one from New benchmark.</div>
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Dataset</th>
                  <th>Models (accuracy · $/question)</th>
                  <th className="r">Cases</th>
                  <th>Source</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.id} className="clickable" onClick={() => onOpen(r.id)}>
                    <td className="num" style={{ whiteSpace: 'nowrap' }}>
                      {when(r.startedAt)}
                      {r.status !== 'done' && (
                        <span className={`badge ${r.status === 'failed' ? 'badge-bad' : r.status === 'cancelled' ? '' : 'badge-warn'}`} style={{ marginLeft: 6 }}>
                          {r.status}
                        </span>
                      )}
                    </td>
                    <td>
                      {r.dataset}
                      {r.engine && <div className="small faint">{r.engine}</div>}
                    </td>
                    <td>
                      <div style={{ display: 'grid', gap: 2 }}>
                        {[...r.variants]
                          .sort((a, b) => b.accuracy - a.accuracy)
                          .map((v) => (
                            <span key={v.variant} className="small">
                              <b className="num">{pct(v.accuracy)}</b> <span className="muted">{v.variant}</span> <span className="faint num">· {usd(v.perQuestionUsd)}</span>
                            </span>
                          ))}
                      </div>
                    </td>
                    <td className="r num">
                      {r.cases}
                      {r.repeats > 1 ? ` × ${r.repeats}` : ''}
                    </td>
                    <td>
                      <span className="badge">{r.source ?? 'cli'}</span>
                    </td>
                    <td className="r" onClick={(e) => e.stopPropagation()}>
                      {(r.status === 'done' || r.status === 'failed' || r.status === 'cancelled') && (
                        <button type="button" className="icon-btn" aria-label={`Delete run ${r.id}`} onClick={() => remove(r.id)}>
                          <Icon name="trash" size={15} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
