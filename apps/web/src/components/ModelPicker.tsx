import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { compact, perM } from '../lib/stats';
import type { BenchConfig, Effort, ModelInfo, ModelSpec } from '../lib/types';
import { Icon, seriesColor } from './ui';

export const MAX_MODELS = 6;

const keyOf = (m: Pick<ModelSpec, 'provider' | 'model'>) => `${m.provider}:${m.model}`;

/**
 * Search every model the server can reach (OpenAI account + OpenRouter
 * catalog), with prices and context size, and pick up to six to compare.
 */
export function ModelPicker({
  catalog,
  config,
  value,
  onChange,
}: {
  catalog: ModelInfo[];
  config: BenchConfig;
  value: ModelSpec[];
  onChange: (v: ModelSpec[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [onlyAvailable, setOnlyAvailable] = useState(true);
  const [latestCatalog, setLatestCatalog] = useState(catalog);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string>();
  const boxRef = useRef<HTMLDivElement>(null);
  const refreshId = useRef(0);

  useEffect(() => setLatestCatalog(catalog), [catalog]);
  useEffect(() => () => { refreshId.current += 1; }, []);

  const refreshModels = () => {
    const id = ++refreshId.current;
    setRefreshing(true);
    setRefreshError(undefined);
    api.models().then(
      (result) => {
        if (id !== refreshId.current) return;
        setLatestCatalog(result.models);
        setRefreshError(result.errors.join('; ') || undefined);
        setRefreshing(false);
      },
      (error: Error) => {
        if (id !== refreshId.current) return;
        setRefreshError(error.message);
        setRefreshing(false);
      },
    );
  };

  const matches = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return latestCatalog
      .filter((m) => !onlyAvailable || m.available)
      .filter((m) => terms.every((t) => `${m.id} ${m.name} ${m.provider}`.toLowerCase().includes(t)))
      .slice(0, 60);
  }, [latestCatalog, query, onlyAvailable]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const full = value.length >= MAX_MODELS;
  const add = (m: ModelInfo) => {
    if (full || !m.available) return;
    onChange([...value, { provider: m.provider, model: m.id }]);
    setQuery('');
    setActive(0);
    // Close so the list never covers the buttons below; typing reopens it.
    setOpen(false);
  };
  const update = (i: number, patch: Partial<ModelSpec>) => onChange(value.map((v, j) => (j === i ? { ...v, ...patch } : v)));
  const remove = (i: number) => onChange(value.filter((_, j) => j !== i));

  const currentProvider = config.current.provider === 'openrouter' ? 'openrouter' : 'openai';
  const current = { provider: currentProvider, model: config.current[currentProvider].fast } as ModelSpec;
  const hasCurrent = value.some((v) => keyOf(v) === keyOf(current) && !v.reasoningEffort);

  return (
    <div>
      <div className="picker" ref={boxRef}>
        <input
          className="input"
          placeholder={full ? `Up to ${MAX_MODELS} models per run` : 'Search models: gpt-5, claude, deepseek, llamaâ€¦'}
          value={query}
          disabled={full}
          role="combobox"
          aria-expanded={open}
          aria-controls="model-list"
          aria-label="Search models"
          onFocus={() => {
            setOpen(true);
            refreshModels();
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(matches.length - 1, a + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === 'Enter' && matches[active]) {
              e.preventDefault();
              add(matches[active]);
            } else if (e.key === 'Escape') setOpen(false);
          }}
        />
        {open && !full && (
          <div className="picker-list" id="model-list" role="listbox">
            <div className="row" style={{ justifyContent: 'space-between', padding: '6px 10px' }}>
              <span className="small muted" role="status">{refreshing ? 'Loading latest modelsâ€¦' : refreshError ? `Refresh failed: ${refreshError}` : 'Latest provider models'}</span>
              <button type="button" className="icon-btn" aria-label="Refresh models" title="Refresh models" disabled={refreshing} onClick={refreshModels}>
                <Icon name="refresh" size={14} />
              </button>
            </div>
            <label className="row small muted" style={{ padding: '6px 10px' }}>
              <input type="checkbox" checked={onlyAvailable} onChange={(e) => setOnlyAvailable(e.target.checked)} />
              Only models this server has a key for
            </label>
            {matches.length === 0 && <div className="empty small">No models match â€œ{query}â€.</div>}
            {matches.map((m, i) => {
              const picked = value.some((v) => keyOf(v) === keyOf({ provider: m.provider, model: m.id }));
              return (
                <button
                  key={keyOf({ provider: m.provider, model: m.id })}
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  className="picker-item"
                  disabled={!m.available}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => add(m)}
                  title={m.available ? undefined : `Set ${m.provider === 'openai' ? 'OPENAI_API_KEY' : 'OPENROUTER_API_KEY'} on the server to use this model`}
                >
                  <span className="row" style={{ minWidth: 0 }}>
                    <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
                    {m.current && <span className="badge">in use</span>}
                    {picked && <span className="badge">added</span>}
                    <span className={`badge ${m.priceStatus === 'free' ? 'badge-good' : m.priceStatus === 'paid' ? 'badge-warn' : ''}`}>{m.priceStatus === 'unknown' ? 'Price unavailable' : m.priceStatus === 'free' ? 'Free' : 'Paid'}</span>
                  </span>
                  <span className="num small muted" style={{ textAlign: 'right' }}>
                    {m.priceStatus === 'unknown' ? 'Price unavailable' : m.priceStatus === 'free' ? 'Free' : <>{perM(m.promptPerM)} / {perM(m.completionPerM)}</>}
                  </span>
                  <span className="small faint mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {m.provider} Â· {m.id}
                  </span>
                  <span className="small faint" style={{ textAlign: 'right' }}>
                    {[m.contextLength ? `${compact(m.contextLength)} ctx` : '', m.reasoning ? 'reasoning' : ''].filter(Boolean).join(' Â· ') || ' '}
                  </span>
                </button>
              );
            })}
            <div className="hint" style={{ padding: '6px 10px' }}>Prices are USD per million input / output tokens.</div>
          </div>
        )}
      </div>

      <div className="row wrap" style={{ marginTop: 8 }}>
        {!hasCurrent && !full && (
          <button type="button" className="chip" onClick={() => onChange([...value, current])}>
            <Icon name="plus" size={12} /> Current model ({current.model})
          </button>
        )}
      </div>

      {value.length > 0 && (
        <div className="picked" aria-label="Selected models">
          {value.map((v, i) => {
            const info = latestCatalog.find((m) => m.provider === v.provider && m.id === v.model);
            return (
              <div className="picked-row" key={`${keyOf(v)}-${i}`}>
                <span className="swatch" style={{ background: seriesColor(i) }} />
                <span className="grow" style={{ minWidth: 0 }}>
                  <span style={{ fontWeight: 600, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {info?.name ?? v.model}
                  </span>
                  <span className="small faint">
                    {v.provider} Â· {perM(info?.promptPerM)} / {perM(info?.completionPerM)} per 1M
                  </span>
                </span>
                <select
                  className="select select-sm"
                  aria-label={`Reasoning effort for ${v.model}`}
                  value={v.reasoningEffort ?? ''}
                  onChange={(e) => update(i, { reasoningEffort: (e.target.value || undefined) as Effort | undefined })}
                  title="Reasoning effort (ignored by models without reasoning)"
                >
                  <option value="">Effort: server default{config.current.reasoningEffort ? ` (${config.current.reasoningEffort})` : ''}</option>
                  {config.efforts.map((e) => (
                    <option key={e} value={e}>
                      Effort: {e}
                    </option>
                  ))}
                </select>
                <button type="button" className="icon-btn" aria-label={`Remove ${v.model}`} onClick={() => remove(i)}>
                  <Icon name="close" size={14} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
