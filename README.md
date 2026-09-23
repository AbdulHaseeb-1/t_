# db-intelligence

Ask questions of a SQL Server database in plain language and get correct numbers back quickly and cheaply.

```
apps/
  server/   NestJS 12 + Fastify API (this is the product today)
  web/      frontend placeholder (intentionally empty)
infra/
  docker-compose.yml     SQL Server 2022 (+ optional API container)
  mssql/attach.sh        attaches MDS_EPD_SQL16.mdf and creates a read-only login
```

## How a question is answered

```
POST /query/ask {"question": "..."}
  │
  ├─ answer cache hit? ───────────────► return (0 LLM calls, 0 DB)
  ├─ SQL cache hit? ──► run SQL ───────► return (0 LLM calls, fresh data)
  │
  ├─ schema context   lexical retrieval, compact 1-line-per-table format,
  │                   whole schema if small (stable prefix => provider cache)
  ├─ LLM (fast tier)  one call -> one T-SQL SELECT
  ├─ SQL guard        read-only policy, single statement, deny-list
  ├─ execute          row cap, timeout, always-rolled-back transaction
  ├─ on error         feed error back, retry (last retry escalates to smart tier)
  └─ LLM (fast tier)  phrase answer from TSV sample + column stats
                      (skipped entirely for single-value results)
```

Typical cost is two small-model calls per new question and nothing for repeats. `POST /query/analyze` is a bounded tool-calling agent for questions a single query cannot answer. It runs independent queries in parallel.

## Quick start

```bash
cp .env.example .env              # set passwords + at least one LLM key
cp /path/to/MDS_EPD_SQL16.mdf infra/mssql/data/
./infra/mssql/attach.sh           # starts SQL Server 2022, attaches, creates reader login
pnpm install
pnpm dev                          # http://localhost:3000
```

Only the `.mdf` is needed. The log file is rebuilt on attach.

## API

| Method | Path | Purpose | LLM cost |
|---|---|---|---|
| POST | `/query/ask` | `{question, answer?=true, maxRows?, tier?='fast', noCache?}` → SQL, rows, answer, usage | 0–2 calls |
| POST | `/query/analyze` | `{question, tier?, maxSteps?}` → multi-step analysis with tool trace | bounded loop |
| POST | `/query/sql` | `{sql, maxRows?}` → run read-only SQL directly | none |
| GET | `/schema` | tables/views with row counts | none |
| GET | `/schema/tables/:id` | columns, keys, descriptions for `schema.table` | none |
| GET | `/schema/context?q=` | exactly what the LLM would see for a question | none |
| POST | `/schema/refresh` | re-introspect after DDL changes | none |
| GET | `/llm` | mode, models, breaker state, token + USD totals | none |
| PUT | `/llm/mode` | `{mode: auto\|openai\|openrouter, fallbackOrder?}` at runtime | none |
| GET/DELETE | `/query/cache` | cache stats / clear | none |
| GET | `/health` | DB + LLM status (no API key needed) | none |

Every `/query/ask` and `/query/analyze` response includes `usage` (calls, prompt/cached/completion tokens, `costUsd`, models) and `timings`.

## LLM providers

Both providers use one OpenAI-compatible code path.

- **`LLM_PROVIDER=auto`**: tries `LLM_FALLBACK_ORDER` and fails over on 429, 5xx, timeouts or auth errors. A circuit breaker skips a failing provider for `LLM_BREAKER_COOLDOWN_MS`, so an outage does not add a timeout to every request.
- **`openai` / `openrouter`**: pins one provider. Switch at runtime with `PUT /llm/mode`.
- **Two tiers per provider**: `*_MODEL_FAST` does all routine work and `*_MODEL_SMART` is used only for escalation. Models are set in config, not code.
- **Cost reporting**: OpenRouter returns the exact cost per call. OpenAI-direct cost is estimated from OpenRouter's public price catalog.

## Cost & latency levers (already built in)

1. **Cheap model by default, escalation only on failure.**
2. **Prompt-prefix caching.** Rules and schema come first and the question last, and `prompt_cache_key` is keyed by schema hash. Repeat input tokens bill at the cached rate.
3. **Compact schema.** One line per table, roughly 3–5× fewer tokens than DDL. Large schemas send only the lexically relevant tables plus their foreign-key neighbours, and a names-only index of the rest.
4. **Compact results.** Results go to the model as TSV (about half the tokens of JSON), sampled to `ASK_ANSWER_MAX_ROWS`, with min/max/sum/avg over *all* rows.
5. **Two-level cache.** Question → SQL (24h) gives live data with zero tokens. Question → answer (120s) touches neither the model nor the DB.
6. **Zero-LLM paths.** `/query/sql` and scalar answers skip the model.
7. **`answer: false`** returns data only, which halves calls when a UI renders the table itself.

## Measured on `gpt-6-luna` (synthetic sample DB)

| Reasoning effort (fast tier) | Avg latency | Avg cost / question | Correct |
|---|---|---|---|
| provider default | 6.1 s | $0.000319 | 4/4 (one needed a repair loop) |
| low | 3.8 s | $0.000183 | 4/4 |
| **none** (shipped default) | **2.4 s** | **$0.000134** | **4/4** |

That is about **7,500 new questions per $1**; repeats are free. Escalation reuses the same model with `medium` reasoning, and it is used only after failed attempts or a fast-tier refusal.

The server adapts to model quirks at runtime. If a model rejects an optional parameter such as `temperature` on reasoning models, the server drops it for that model and retries. Tool calls use `reasoning_effort: none` when a model requires it.

## Safety model (defence in depth)

1. Connect as a `db_datareader` login (created by `attach.sh`), so writes are refused by SQL Server itself.
2. SQL guard: one statement, `SELECT`/`WITH` only, T-SQL-aware deny-list applied after removing strings and comments.
3. Execution inside a transaction that is always rolled back, with `SET ROWCOUNT` cap and request timeout.
4. `API_KEY` header auth, rate limiting (stricter on `/query/analyze`), helmet, and secrets redacted from logs.

## Development

```bash
pnpm test          # unit tests (no DB, no network)
pnpm test:e2e      # full stack against SQL Server; needs E2E_DB_HOST / E2E_DB_PASSWORD
pnpm lint && pnpm typecheck && pnpm build
```

The e2e suite creates a synthetic `E2E_Shop` database and uses a local fake OpenAI server, so it never touches real data or paid APIs. CI runs everything against a SQL Server service container.

Toolchain: Node 22, pnpm 10, NestJS 12, Fastify 5, TypeScript 6.0 (the Nest CLI does not yet support TypeScript 7.0, which ships without the compiler API), Vitest 5, oxlint, openai SDK 7, mssql 12, zod 4.
