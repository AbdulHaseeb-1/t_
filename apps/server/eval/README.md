# Evaluation harness

Measures how often `/query/ask` returns the **right data**, what it costs, and how fast it is. It runs the real production services (`AskService`, `LlmService`, `SchemaCatalogService`) once per configuration variant.

```bash
pnpm eval                                  # current .env settings, retail dataset
pnpm eval --preset ablation --repeat 3     # every accuracy feature alone + combined, 3x each
pnpm eval --variant fast:LLM_REASONING_EFFORT_FAST=none --variant low:LLM_REASONING_EFFORT_FAST=low
pnpm eval --filter 'q1[0-9]|ties'          # subset by case id or tag
pnpm eval --check                          # validate gold SQL only (no LLM calls, no cost)
pnpm eval --seed                           # (re)create the fixture database first
```

Each run writes `eval/reports/<timestamp>-<dataset>/`:

| File | For |
|---|---|
| `report.html` | Interactive scorecard: variant comparison, accuracy by capability, failure causes, flips vs baseline, and every case with gold vs generated SQL and results side by side |
| `report.md` | The same numbers as Markdown for PRs and chat |
| `results.json` | Raw per-case records for your own analysis |

## How scoring works

**Execution accuracy.** The generated SQL is executed and its result is compared with the gold query's result:

- Column names and column order are ignored, and extra columns are allowed. Columns are aligned by value, then whole rows are compared, so values from different rows can never produce a false match.
- Row count must match exactly. Row order is checked only when the case sets `"ordered": true`.
- Numbers match within 0.01 absolute or 0.01% relative. Text is compared trimmed and case-insensitively, midnight datetimes equal dates, and booleans equal 0/1.
- `"expect": "refusal"` cases pass only when the system declines to answer.

Failures are categorized as `wrong_values`, `wrong_rows`, `wrong_columns`, `wrong_order`, `false_refusal`, `missed_refusal`, `sql_error`, `unsafe_sql` or `llm_error`, so you can see *why* accuracy moved, not just that it moved.

Metrics per variant:

- accuracy (mean ± sd across repeats)
- first-try accuracy
- pass@k and pass^k
- stability across repeats
- rescues credited to each recovery step
- p50/p95 latency
- cost per question and per **correct** answer

## Accuracy features (each can be switched on or off)

| Setting | Default | What it does |
|---|---|---|
| `SCHEMA_VALUE_HINTS` | `true` | Samples the stored values of low-cardinality text columns (`Status {Delivered\|Cancelled…}`) so filters use real codes. Columns whose names suggest personal data are never sampled (`SCHEMA_VALUE_HINTS_EXCLUDE`). |
| `ASK_EMPTY_RESULT_RECHECK` | `true` | A filtered or joined query that returns 0 rows gets one smart-tier re-check of its literals, dates and join paths. |
| `ASK_FEWSHOT_K` | `3` | Injects the most similar verified question→SQL pairs from `EXAMPLES_FILE` (managed via `POST /query/examples`). |
| `ASK_SQL_CANDIDATES` | `1` | Self-consistency: N parallel candidates, and the result most of them agree on wins. |

In the ablation, `few-shot` uses the dataset's own gold queries as the example library with **leave-one-out**, so a question never sees its own answer. That simulates a mature library of verified queries. It measures the benefit of similar examples existing, not of exact answers.

## Writing a dataset for your own database

1. Copy `datasets/retail.json` and set `name`, `database` and `cases` (drop `fixture`; your database already exists).
2. Write **20–50 real questions** your users ask, each with a gold SQL you have verified by hand. Cover each capability you care about (tags are free-form).
3. **Make every question unambiguous about its answer.** Name the metric definition ("net revenue = quantity × price × (1 − discount)"), the units ("as a percentage 0–100") and the shape ("month number and count"). An ambiguous question measures the dataset, not the system.
4. Run `pnpm eval --dataset eval/datasets/<yours>.json --check`. It flags gold queries that fail, return no rows, or hit the row cap.
5. Run `pnpm eval --dataset ... --repeat 3`. Treat changes smaller than about ±2 sd as noise.

For the MDS_EPD database, restrict the schema first (e.g. `SCHEMA_INCLUDE=mdm.viw_*`) and write gold SQL against the same views the model will see.

## Cost of a run

The retail dataset costs about $0.006 per 40-question pass on `gpt-6-luna`, so a full ablation (7 variants × 3 repeats) costs about $0.15.
