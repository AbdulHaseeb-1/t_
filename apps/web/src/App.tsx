import { useEffect, useState } from 'react';
import { History } from './components/History';
import { NewRun } from './components/NewRun';
import { Playground } from './components/Playground';
import { RunPage } from './components/RunPage';
import { Banner, Icon, Spinner } from './components/ui';
import { api, ApiError, getApiKey, setApiKey } from './lib/api';
import { useRoute, useStored } from './lib/hooks';
import type { BenchConfig, DatasetInfo, ModelCatalog, StartRun } from './lib/types';

interface Loaded {
  config: BenchConfig;
  catalog: ModelCatalog;
  datasets: DatasetInfo[];
}

type Theme = 'system' | 'light' | 'dark';

export function App() {
  const [route, go] = useRoute();
  const [data, setData] = useState<Loaded>();
  const [error, setError] = useState<ApiError | Error>();
  const [attempt, setAttempt] = useState(0);
  const [prefill, setPrefill] = useState<StartRun>();
  const [theme, setTheme] = useStored<Theme>('bench.theme', 'system');

  useEffect(() => {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    let live = true;
    setError(undefined);
    Promise.all([api.config(), api.models(), api.datasets()]).then(
      ([config, catalog, datasets]) => live && setData({ config, catalog, datasets }),
      (e: Error) => live && setError(e),
    );
    return () => {
      live = false;
    };
  }, [attempt]);

  const [page, arg] = route;
  const tabs: [string, string, string][] = [
    ['new', 'New benchmark', 'New'],
    ['playground', 'Playground', 'Playground'],
    ['history', 'History', 'History'],
  ];
  const nextTheme: Record<Theme, Theme> = { system: 'dark', dark: 'light', light: 'system' };

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="#/new" style={{ textDecoration: 'none' }}>
            <span className="brand-mark" aria-hidden>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
              </svg>
            </span>
            <span className="brand-text">Model Bench</span>
          </a>
          <nav className="tabs" aria-label="Pages">
            {tabs.map(([key, label, short]) => (
              <a key={key} className="tab" href={`#/${key}`} aria-current={page === key || (key === 'history' && page === 'run') ? 'page' : undefined}>
                <span className="tab-long">{label}</span>
                <span className="tab-short">{short}</span>
              </a>
            ))}
          </nav>
          <span className="spacer" />
          {data && (
            <span className="badge" title="Database the benchmark runs against">
              {data.config.engine === 'duckdb' ? 'DuckDB (.mdf)' : `SQL Server · ${data.config.database}`}
            </span>
          )}
          <button type="button" className="icon-btn" aria-label={`Theme: ${theme}`} title={`Theme: ${theme}`} onClick={() => setTheme(nextTheme[theme])}>
            <Icon name={theme === 'dark' ? 'moon' : 'sun'} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="API key"
            title="API key"
            onClick={() => {
              const key = window.prompt('Server API key (x-api-key). Leave empty if the server has none.', getApiKey());
              if (key !== null) {
                setApiKey(key.trim());
                setAttempt((a) => a + 1);
              }
            }}
          >
            <Icon name="key" />
          </button>
        </div>
      </header>

      <main className="page">
        {error ? (
          <Gate error={error} onRetry={() => setAttempt((a) => a + 1)} />
        ) : !data ? (
          <Spinner label="Connecting to the server…" />
        ) : page === 'run' && arg ? (
          <RunPage
            key={arg}
            id={arg}
            onRerun={(req) => {
              setPrefill(req);
              go('new');
            }}
          />
        ) : page === 'playground' ? (
          <Playground config={data.config} catalog={data.catalog.models} />
        ) : page === 'history' ? (
          <History onOpen={(id) => go(`run/${encodeURIComponent(id)}`)} />
        ) : (
          <>
            <h1 className="page-title">New benchmark</h1>
            <p className="page-sub">Run a question set through several models and compare accuracy, speed and cost on your own database.</p>
            {data.catalog.errors.length > 0 && <Banner kind="warn">Some models could not be listed: {data.catalog.errors.join('; ')}</Banner>}
            <NewRun
              key={prefill ? JSON.stringify(prefill) : 'blank'}
              config={data.config}
              catalog={data.catalog.models}
              datasets={data.datasets}
              prefill={prefill}
              onStarted={(id) => {
                setPrefill(undefined);
                go(`run/${encodeURIComponent(id)}`);
              }}
            />
          </>
        )}
      </main>
    </>
  );
}

function Gate({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const status = error instanceof ApiError ? error.status : 0;
  const [key, setKey] = useState(getApiKey());
  if (status === 401) {
    return (
      <div className="card card-pad" style={{ maxWidth: 460 }}>
        <h1 className="page-title">API key needed</h1>
        <p className="page-sub">This server requires the same key the app uses (API_KEY). It is kept in this browser only.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setApiKey(key.trim());
            onRetry();
          }}
        >
          <input className="input" type="password" autoFocus placeholder="x-api-key" aria-label="API key" value={key} onChange={(e) => setKey(e.target.value)} />
          <button type="submit" className="btn btn-primary" style={{ marginTop: 12 }}>
            Continue
          </button>
        </form>
      </div>
    );
  }
  return (
    <div style={{ maxWidth: 640 }}>
      <Banner>
        {status === 404 ? (
          <>
            The benchmark is turned off on this server. Set <span className="mono">BENCH_ENABLED=true</span> in its environment and restart it.
          </>
        ) : (
          <>Could not reach the server: {error.message}</>
        )}
      </Banner>
      <button type="button" className="btn" onClick={onRetry}>
        <Icon name="refresh" size={14} /> Try again
      </button>
    </div>
  );
}
