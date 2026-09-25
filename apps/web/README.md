# Model Bench (web)

A browser tool for choosing the model behind the app. It runs a question set with verified answers through several models, using the same pipeline the app uses, and compares **accuracy, speed and cost** on your own database.

It is web-only (React + Vite) and is served by the API server at **`/bench`**.

## Start it

```bash
pnpm --filter web build                  # builds apps/web/dist
# in the server's environment (.env):
BENCH_ENABLED=true
pnpm --filter server start:prod          # then open http://localhost:3000/bench
```

- **Off by default.** Every run spends API credits. When `BENCH_ENABLED` is not `true`, the API returns 404 and the page is not served.
- **Same protection as the app.** If `API_KEY` is set, the page asks for it once and keeps it in that browser only.
- **Development:** `pnpm bench` starts Vite on :5173 with hot reload and proxies `/bench/api` to `BENCH_API` (default `http://localhost:3000`).

## What it does

**New benchmark**
1. Pick a **dataset** from `apps/server/eval/datasets`. Each case has a gold SQL query, and its result is the ground truth. Datasets whose gold SQL is T-SQL-only are disabled on a DuckDB (`.mdf`) server.
2. Narrow it by **topic** or **difficulty**.
3. Pick up to **six models**:
   - Search covers the OpenAI account's chat models and OpenRouter's full catalog, with price per 1M tokens, context size and reasoning support.
   - Each model has its own reasoning effort.
   - Models without a configured key are listed but disabled.
4. Set:
   - repeats (stability)
   - parallel requests
   - the pipeline features (value hints, empty-result re-check, few-shot, SQL voting, answer writing), which are applied to every model alike
5. The summary shows case runs, **estimated cost** (calibrated on the dataset's last run when there is one) and estimated time.

**Results** (live while the run is in progress)
- **Headline cards:** most accurate, best value (the cheapest model within 2 points of the top), fastest, total spend.
- **Leaderboard columns:**
  - accuracy, with its **95% Wilson confidence interval**
  - first-try accuracy
  - always-right and stable (with repeats)
  - median and p95 time
  - $ per question and $ per correct answer
  - tokens per question
  - provider errors
  - Sortable; the best value in each column is in bold.
- **Accuracy vs cost** (log scale), with a dashed **Pareto frontier**: the models nothing else beats on both accuracy and cost.
- **Time per question:** median and p95 per model.
- **Accuracy by difficulty and topic**, and **how each model fails** (wrong rows or values, missing column, SQL error, false refusal…), plus what each model fixes and breaks compared with the first model.
- **Case matrix:** every case against every model. Filter to *models disagree*, *any failure* or *all wrong*; an all-wrong case often means a bad gold query or a missing schema note. Click a case to see the gold SQL and rows next to each model's SQL, rows, error, time, tokens and cost.
- **Export:** JSON or CSV. **Run again** repeats the same setup, including the exact cases.

**Playground:** one question, up to six models, side by side: answer, SQL, first rows, time, tokens and cost. With no gold answer, it reports which models **returned the same data**.

**History:** every saved run, from this page and from `pnpm eval` alike, stored in `eval/reports/<run>/results.json`.

## How a run is scored

The bench calls the same engine as the CLI harness (`apps/server/src/eval/engine.ts`):

- **Gold queries run first.** Any gold failure stops the run with the reason.
- **Each model runs every case through the production ask pipeline**, with caches off.
- **A case is correct only when the model's result matches gold:**
  - same rows
  - columns matched by value
  - order checked only when the case says so
- **Rate limits, provider 5xx and timeouts** are retried with back-off and excluded from accuracy (shown as provider errors). A model that rejects a request outright (HTTP 400, unknown model) fails that case.
- **One model per variant, for both tiers:** escalation stays on the same model, so each score belongs to exactly one model.

## Tests

```bash
pnpm --filter web test        # scoring maths: Wilson CI, Pareto frontier, case matrix, cost estimate, formats
pnpm --filter web test:e2e    # drives the UI against a live server (BENCH_URL, PW_CHROMIUM, BENCH_MODELS)
```

The server side is covered by `apps/server/src/bench/bench.service.spec.ts`. It builds a real DuckDB file from the MDF fixture and uses two fake models, one right and one wrong, to test scoring, saving, history, cancelling, the spend cap and the playground's agreement check.
