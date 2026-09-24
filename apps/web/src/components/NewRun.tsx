import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { averageUsage, DEFAULT_CASE_USAGE, estimateCost, usd } from '../lib/stats';
import type { BenchConfig, DatasetCase, DatasetInfo, Features, ModelInfo, ModelSpec, StartRun } from '../lib/types';
import { ModelPicker } from './ModelPicker';
import { Banner, Icon, Segmented, Spinner, Switch } from './ui';

const REPEATS = [1, 2, 3, 5];

export function NewRun({
  config,
  catalog,
  datasets,
  prefill,
  onStarted,
}: {
  config: BenchConfig;
  catalog: ModelInfo[];
  datasets: DatasetInfo[];
  prefill?: StartRun;
  onStarted: (id: string) => void;
}) {
  const firstCompatible = datasets.find((d) => d.compatible && !d.error)?.file ?? datasets[0]?.file ?? '';
  const [file, setFile] = useState(prefill?.dataset ?? firstCompatible);
  const [models, setModels] = useState<ModelSpec[]>(prefill?.models ?? []);
  const [repeats, setRepeats] = useState(prefill?.repeats ?? 1);
  const [concurrency, setConcurrency] = useState(prefill?.concurrency ?? 4);
  const [answers, setAnswers] = useState(prefill?.answers ?? false);
  const [features, setFeatures] = useState<Features>({
    valueHints: config.features.valueHints,
    emptyRecheck: config.features.emptyRecheck,
    candidates: config.features.candidates,
    fewShot: false,
    ...prefill?.features,
  });
  const [cases, setCases] = useState<DatasetCase[]>();
  const [tags, setTags] = useState<string[]>([]);
  const [difficulty, setDifficulty] = useState<string[]>([]);
  /** Exact cases of a run being repeated. */
  const [subset, setSubset] = useState<string[]>();
  const [usage, setUsage] = useState(DEFAULT_CASE_USAGE);
  const [usageFrom, setUsageFrom] = useState<string>();
  const [error, setError] = useState<string>();
  const [starting, setStarting] = useState(false);

  const info = datasets.find((d) => d.file === file);

  useEffect(() => {
    if (!file) return;
    let live = true;
    setCases(undefined);
    setTags([]);
    setDifficulty([]);
    api.dataset(file).then(
      (d) => {
        if (!live) return;
        setCases(d.cases);
        setSubset(prefill?.dataset === file && prefill.caseIds?.length ? prefill.caseIds : undefined);
      },
      (e: Error) => live && setError(e.message),
    );
    // Calibrate the cost estimate on this dataset's latest run, if any.
    setUsage(DEFAULT_CASE_USAGE);
    setUsageFrom(undefined);
    api
      .runs()
      .then(async (runs) => {
        const last = runs.find((r) => r.status === 'done' && info && r.dataset === info.name);
        if (!last || !live) return;
        const view = await api.run(last.id);
        const u = averageUsage(view.results);
        if (u && live) {
          setUsage(u);
          setUsageFrom(last.id);
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // Reload only when the dataset changes.
  }, [file]);

  const selected = useMemo(() => {
    if (!cases) return [];
    if (subset) return cases.filter((c) => subset.includes(c.id));
    return cases.filter(
      (c) => (!tags.length || c.tags.some((t) => tags.includes(t))) && (!difficulty.length || difficulty.includes(c.difficulty)),
    );
  }, [cases, tags, difficulty, subset]);

  const caseRuns = selected.length * repeats;
  const totalRuns = caseRuns * models.length;
  const estimate = estimateCost(models, catalog, caseRuns, usage);
  const minutes = models.length * Math.ceil(caseRuns / concurrency) * 2.5 / 60;
  const overCap = totalRuns > config.maxCaseRuns;
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const start = async () => {
    setError(undefined);
    setStarting(true);
    try {
      const filtered = subset || tags.length || difficulty.length;
      const run = await api.start({
        dataset: file,
        models,
        repeats,
        concurrency,
        answers,
        features,
        caseIds: filtered ? selected.map((c) => c.id) : undefined,
      });
      onStarted(run.id);
    } catch (e) {
      setError((e as Error).message);
      setStarting(false);
    }
  };

  const tagEntries = Object.entries(info?.tags ?? {}).sort((a, b) => b[1] - a[1]);

  return (
    <div className="setup">
      <div>
        {error && <Banner>{error}</Banner>}

        <div className="card card-pad" style={{ marginBottom: 16 }}>
          <h2 className="card-title">1 · Questions</h2>
          <p className="hint" style={{ margin: '0 0 14px' }}>
            Each case has a verified gold query. A model scores only when its SQL returns the same rows as gold.
          </p>
          <div className="field">
            <label className="label" htmlFor="dataset">
              Dataset
            </label>
            <select id="dataset" className="select" value={file} onChange={(e) => setFile(e.target.value)}>
              {datasets.map((d) => (
                <option key={d.file} value={d.file} disabled={!d.compatible || !!d.error}>
                  {d.name} · {d.cases} cases · {d.database}
                  {!d.compatible ? ` (needs SQL Server; server runs ${config.engine})` : ''}
                  {d.error ? ' (invalid)' : ''}
                </option>
              ))}
            </select>
            {info?.description && <span className="hint">{info.description}</span>}
          </div>

          {tagEntries.length > 0 && (
            <div className="field">
              <span className="label">Topics</span>
              <div className="row wrap">
                {tagEntries.map(([t, n]) => (
                  <button key={t} type="button" className="chip" aria-pressed={tags.includes(t)} onClick={() => setTags(toggle(tags, t))}>
                    {t} <span className="count">{n}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {info && Object.keys(info.difficulties).length > 1 && (
            <div className="field" style={{ marginBottom: 0 }}>
              <span className="label">Difficulty</span>
              <div className="row wrap">
                {Object.entries(info.difficulties).map(([d, n]) => (
                  <button key={d} type="button" className="chip" aria-pressed={difficulty.includes(d)} onClick={() => setDifficulty(toggle(difficulty, d))}>
                    {d} <span className="count">{n}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {subset && (
            <div className="row" style={{ marginTop: 12 }}>
              <span className="chip" aria-pressed>
                Same {subset.length} cases as the earlier run
              </span>
              <button type="button" className="btn btn-ghost" onClick={() => setSubset(undefined)}>
                Use topic filters instead
              </button>
            </div>
          )}
          <p className="hint" style={{ margin: '12px 0 0' }}>
            {cases ? (
              <>
                <b className="num">{selected.length}</b> of {cases.length} cases selected{tags.length || difficulty.length ? ' (any matching topic)' : ''}.
              </>
            ) : (
              <Spinner label="Loading cases…" />
            )}
          </p>
        </div>

        <div className="card card-pad" style={{ marginBottom: 16 }}>
          <h2 className="card-title">2 · Models</h2>
          <p className="hint" style={{ margin: '0 0 14px' }}>
            Every model runs through the same production pipeline (schema context, guard, repair). Escalation uses the same model.
          </p>
          <ModelPicker catalog={catalog} config={config} value={models} onChange={setModels} />
          {!config.providers.openrouter && (
            <p className="hint" style={{ margin: '10px 0 0' }}>
              OpenRouter models (Claude, Gemini, DeepSeek, Llama…) unlock when <span className="mono">OPENROUTER_API_KEY</span> is set on the server.
            </p>
          )}
        </div>

        <div className="card card-pad">
          <h2 className="card-title">3 · Settings</h2>
          <div className="row wrap" style={{ gap: 24, margin: '10px 0 8px' }}>
            <div className="field" style={{ margin: 0 }}>
              <span className="label">Repeats</span>
              <Segmented label="Repeats" value={repeats} options={REPEATS.map((n) => ({ value: n, label: `${n}×` }))} onChange={setRepeats} />
              <span className="hint">More repeats measure stability; accuracy is their mean.</span>
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label className="label" htmlFor="concurrency">
                Parallel requests
              </label>
              <select id="concurrency" className="select" style={{ width: 90 }} value={concurrency} onChange={(e) => setConcurrency(Number(e.target.value))}>
                {[1, 2, 3, 4, 6, 8].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
              <span className="hint">Lower it if you hit rate limits.</span>
            </div>
          </div>
          <details>
            <summary className="label" style={{ cursor: 'pointer', margin: '12px 0 4px' }}>
              Pipeline (same for every model)
            </summary>
            <Switch
              label="Stored-value hints"
              hint="Show the model real values of low-cardinality columns."
              checked={!!features.valueHints}
              onChange={(v) => setFeatures({ ...features, valueHints: v })}
            />
            <Switch
              label="Re-check empty results"
              hint="Ask the model to revisit a query that returned no rows."
              checked={!!features.emptyRecheck}
              onChange={(v) => setFeatures({ ...features, emptyRecheck: v })}
            />
            <Switch
              label="Few-shot examples from the dataset"
              hint="Leave-one-out: never the case being asked."
              checked={!!features.fewShot}
              onChange={(v) => setFeatures({ ...features, fewShot: v })}
            />
            <div className="switch">
              <span className="grow">
                <span className="label">SQL candidates (vote)</span>
                <span className="hint" style={{ display: 'block' }}>
                  Several drafts, majority result wins. Costs that many times more.
                </span>
              </span>
              <Segmented
                label="SQL candidates"
                value={features.candidates ?? 1}
                options={[1, 3, 5].map((n) => ({ value: n, label: String(n) }))}
                onChange={(n) => setFeatures({ ...features, candidates: n })}
              />
            </div>
            <Switch
              label="Also write answers"
              hint="Generates the prose answer and checks it is in the question's language (about 2× the calls)."
              checked={answers}
              onChange={setAnswers}
            />
          </details>
        </div>
      </div>

      <aside className="card card-pad sticky" aria-label="Run summary">
        <h2 className="card-title">Run summary</h2>
        <div className="stat" style={{ margin: '12px 0' }}>
          <span className="muted small">Case runs</span>
          <span className="stat-value num">{totalRuns.toLocaleString()}</span>
          <span className="hint num">
            {selected.length} cases × {repeats} repeat{repeats > 1 ? 's' : ''} × {models.length} model{models.length === 1 ? '' : 's'}
          </span>
        </div>
        <div className="stat" style={{ margin: '12px 0' }}>
          <span className="muted small">Estimated cost</span>
          <span className="stat-value num">{models.length ? (estimate.total !== undefined ? `≈ ${usd(estimate.total)}` : 'unknown') : '—'}</span>
          <span className="hint">
            {usageFrom ? 'From token use in this dataset’s last run.' : 'Assumes ~8K prompt tokens (half cached) per case.'}
            {models.length > 0 && estimate.total === undefined ? ' A selected model has no public price.' : ''}
          </span>
        </div>
        {models.length > 0 && (
          <div className="stat" style={{ margin: '12px 0' }}>
            <span className="muted small">Estimated time</span>
            <span className="stat-value num">≈ {minutes < 1 ? '< 1' : Math.round(minutes)} min</span>
          </div>
        )}
        {overCap && (
          <Banner kind="warn">
            Over the server limit of {config.maxCaseRuns.toLocaleString()} case runs (BENCH_MAX_CASE_RUNS).
          </Banner>
        )}
        <button
          type="button"
          className="btn btn-primary btn-lg"
          style={{ width: '100%' }}
          disabled={!models.length || !selected.length || overCap || starting}
          onClick={start}
        >
          {starting ? <span className="spinner" /> : <Icon name="play" size={14} />} Start benchmark
        </button>
        <p className="hint" style={{ marginBottom: 0 }}>
          Runs on the server; you can close this tab and come back from History. Answer caches are off.
        </p>
      </aside>
    </div>
  );
}
