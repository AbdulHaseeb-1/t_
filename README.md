# db-intelligence

Ask questions of a SQL Server database in plain language and get correct numbers back quickly and cheaply.

```
apps/
  server/   NestJS 12 + Fastify API: question -> SQL -> answer, voice and photo input
  mobile/   Ask Data: Expo SDK 57 app (Android APK, iOS, web), Urdu-first
  web/      placeholder for a separate web frontend (the mobile app also builds for web)
infra/
  docker-compose.yml               SQL Server 2022 (+ optional API container)
  mssql/attach.sh                  attaches MDS_EPD_SQL16.mdf and creates a read-only login
  mssql/harden.sql                 denies credential columns to that login
  mssql/mds-epd.env.example        tuned server settings for MDS_EPD
  mssql/mds-epd.schema-notes.json  curated table/column notes for MDS_EPD
docs/
  CONNECT-DATABASE.md              phone -> server -> your SQL Server, step by step
```

**Connecting the app to your database:** see [docs/CONNECT-DATABASE.md](docs/CONNECT-DATABASE.md).

## Two ways to reach the data

| `DB_ENGINE` | Source | How |
|---|---|---|
| `mssql` (default) | Live SQL Server | read-only login, rolled-back transactions |
| `duckdb` | A copy of the `.mdf` file, **no SQL Server needed** | built-in MDF reader -> read-only DuckDB file |

```
database.mdf --> MDF reader (apps/server/src/mdf) --> DuckDB (read-only) --> AI writes SELECT --> guard --> results --> answer
```

The MDF reader parses SQL Server's on-disk format directly. It walks the boot page and system catalog, follows IAM allocation maps, decodes records and reassembles off-row LOB data. It recovers tables, primary and foreign keys and the physical column map (dropped columns, metadata-only defaults), and recomputes non-persisted computed columns in exact decimal arithmetic. Supported: SQL Server 2016+ single-file databases without table compression, and all common column types.

**Verification.** On MDS_EPD, all 81 tables and 376,124 rows are byte-identical to SQL Server's own output. A torture-test database (`infra/mssql/mdf-fixture.sql`: every type and edge value, 1 MB LOBs, row overflow, forwarded heap rows, dropped/added columns) is committed as a 470 KB fixture with SQL Server's rendering as golden output. `pnpm test` checks the reader against it with no SQL Server required.

**Read-only by construction.** The `.mdf` is opened `O_RDONLY` (its hash is unchanged after conversion). DuckDB runs with `access_mode=READ_ONLY`, `enable_external_access=false` and locked configuration. The SQL guard additionally rejects file, network, extension and dynamic-SQL functions. Engine-level refusals are tested with the guard removed.

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
| POST | `/query/ask` | `{question, context?: [{question, sql}] (≤4 earlier turns), answer?=true, maxRows?, tier?='fast', noCache?}` → SQL, rows, answer, usage | 0–2 calls |
| POST | `/query/analyze` | `{question, tier?, maxSteps?}` → multi-step analysis with tool trace | bounded loop |
| POST | `/query/sql` | `{sql, maxRows?}` → run read-only SQL directly | none |
| GET | `/schema` | tables/views with row counts | none |
| GET | `/schema/tables/:id` | columns, keys, descriptions for `schema.table` | none |
| GET | `/schema/context?q=` | exactly what the LLM would see for a question | none |
| POST | `/schema/refresh` | re-introspect after DDL changes; `duckdb`: re-convert a newer `.mdf` and swap without restart | none |
| GET | `/llm` | mode, models, breaker state, token + USD totals | none |
| PUT | `/llm/mode` | `{mode: auto\|openai\|openrouter, fallbackOrder?}` at runtime | none |
| GET/DELETE | `/query/cache` | cache stats / clear | none |
| GET/POST/DELETE | `/query/examples` | verified question→SQL pairs (few-shot library; SQL must run) | none |
| GET | `/health` | DB + LLM status (no API key needed) | none |

Every `/query/ask` and `/query/analyze` response includes `usage` (prompt/cached/completion tokens, `costUsd`, models, and a per-call breakdown tagged `sql`, `answer`, `recheck`, `translate`, `transcribe`, `vision` or `agent`) and `timings` (`llmMs`, `dbMs`, `mediaMs`). `/query/ask` also reports the `schema` context sent (whole schema or retrieved tables, with its token size) and the conversation `context` (earlier turns, engine).

## Speech to text

Voice questions are transcribed before they are answered. The provider is chosen by `TRANSCRIBE_PROVIDER`:

| Setting | Provider order | Notes |
|---|---|---|
| `auto` (default) | Gemini if `GEMINI_API_KEY` is set, then OpenAI | the other provider is the automatic fallback |
| `gemini` / `openai` | that one first | |

- **`gemini-3.5-flash-lite`** (default `GEMINI_TRANSCRIBE_MODEL`): about $0.001 per minute of audio (1,920 audio tokens at $0.30/M plus the transcript at $2.50/M). It is prompted to write Urdu speech in Urdu script (never Hindi Devanagari), to keep English business words and numbers as spoken, and not to translate.
- **`gemini-3.8-flash`**: more accurate on noisy audio, about $0.0065 per minute.
- **`gemini-3.5-transcribe`**: Google's dedicated speech model. Not the default, because Urdu is not among its supported languages.
- **OpenAI `gpt-4o-transcribe`**: used when no Gemini key is set, and as the fallback. About $0.006 per minute.

The provider and model that transcribed a question are returned as `speech` and appear in the app's answer details.

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

## Accuracy on the real database (MDS_EPD)

40 questions in English, Urdu and Roman Urdu, with hand-verified gold SQL (`eval/datasets/mds-epd.json`), scored as execution accuracy with 3 runs each:

| Stage | Accuracy | Fix |
|---|---|---|
| first run | 95.6% | none |
| reasoning-token headroom | 97.1% | escalated calls no longer spend the whole output budget thinking and return empty SQL |
| composite keys + named-table retrieval | 98.0% | `PK(area_id, town_id)` rendered explicitly; a table named in the question is always retrieved |
| schema notes + report views hidden | **100%** | `SCHEMA_NOTES_FILE` explains grain ("one row per invoice line"); `uv*` report views that repeat header totals are excluded |

Cost is about $0.00012 per question. Schema notes are the cheapest accuracy lever for any legacy database: one sentence per misunderstood table.

Regression check after these changes on the synthetic retail sets: English 98.3% ± 1.2 (3 runs), Urdu 97.9% (2 runs). Both are within noise of the ablation below. One broader rule tried along the way ("prefer base tables over views") cost 3 points on retail, where a curated per-order view is the correct source, so it was narrowed to the grain rule that holds everywhere.

## Accuracy (measured, not assumed)

`pnpm --filter server eval` runs the real pipeline against a 40-question dataset on a synthetic retail database. Each run is scored by **execution accuracy**: the generated SQL must return the same rows as a hand-verified gold query. See [apps/server/eval/README.md](apps/server/eval/README.md).

Final ablation on `gpt-6-luna` (40 questions × 3 repeats per variant):

| Variant | Accuracy | First try | p50 / p95 | $ per correct answer |
|---|---|---|---|---|
| baseline (no accuracy features) | 90.8% ± 2.4 | 85.8% | 1.3 / 2.2 s | $0.000125 |
| + schema value hints | 97.5% | 90.8% | 1.3 / 2.4 s | $0.000056 |
| + empty-result recheck | 90.0% | 82.5% | 1.3 / 3.0 s | $0.000120 |
| + few-shot examples | 92.5% | 87.5% | 1.2 / 2.2 s | $0.000091 |
| + 3-candidate voting | 90.8% | 85.8% | 1.3 / 2.4 s | $0.000315 |
| **default: hints + recheck** | **99.2% ± 1.2** | **94.2%** | **1.3 / 2.3 s** | **$0.000053** |

Why the defaults are what they are:

- **Value hints** are the largest single gain. They also cut cost by about 55%, because correct filters need no repair rounds.
- The **empty-result recheck** does little alone, but fixes hierarchy and join-level mistakes on top of hints.
- **Voting** tripled the cost for no measurable gain, so `ASK_SQL_CANDIDATES=1`.
- **Few-shot** showed no significant gain here, so it is off by default. Enable it once you have curated examples, and confirm with the eval.

Fast-tier reasoning effort (4-question pilot): `none` was about 2.5× faster and 2.4× cheaper than the model's default at equal accuracy, so it is the shipped setting. The recheck and escalations use the same model at `medium` reasoning.

The server adapts to model quirks at runtime. When a model rejects an optional parameter (for example `temperature` on reasoning models), the server drops it for that model and retries. Tool calls use `reasoning_effort: none` when a model requires it. Without a fallback provider, rate limits are waited out using `retry-after`.

## Safety model (defence in depth)

1. Connect as a `db_datareader` login (created by `attach.sh`), so writes are refused by SQL Server itself. `harden.sql` also denies credential columns to it.
2. SQL guard: one statement, `SELECT`/`WITH` only, T-SQL-aware deny-list applied after removing strings and comments. Sensitive columns (`DB_DENY_COLUMNS`: passwords, tokens, CNIC/SSN) are hidden from the model and rejected by name, and `SELECT *` is refused so they cannot leak through a wildcard.
3. Value hints only sample categorical code columns. Name-like columns and values that look like phones, e-mails or coordinates are never sent to the model.
4. Execution inside a transaction that is always rolled back, with `SET ROWCOUNT` cap and request timeout.
5. `API_KEY` header auth, rate limiting (stricter on `/query/analyze`), helmet, and secrets redacted from logs.

## Development

```bash
pnpm test          # unit tests (no DB, no network)
pnpm test:e2e      # full stack against SQL Server; needs E2E_DB_HOST / E2E_DB_PASSWORD
pnpm lint && pnpm typecheck && pnpm build
```

The e2e suite creates a synthetic `E2E_Shop` database and uses a local fake OpenAI server, so it never touches real data or paid APIs. CI runs everything against a SQL Server service container.

Toolchain: Node 22, pnpm 10, NestJS 12, Fastify 5, TypeScript 6.0 (the Nest CLI does not yet support TypeScript 7.0, which ships without the compiler API), Vitest 5, oxlint, openai SDK 7, mssql 12, zod 4.
