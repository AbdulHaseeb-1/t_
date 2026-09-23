# Evaluation: retail

40 cases × 1 repeat(s) × 1 variant(s) on `Eval_Retail` · models: openai:gpt-6-luna · 2026-09-23T19:02:27.658Z · 18s

Accuracy is **execution accuracy**: the generated SQL must return the same rows as the gold query (column names/order and extra columns ignored; row order checked only for ordered questions).

## Summary

| Variant | Accuracy | ± sd | First try | pass@k | pass^k | Stable | p50 | p95 | $/question | $/correct | LLM calls |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **default** | 95.0% | 0.0 | 90.0% | 95.0% | 95.0% | 100.0% | 1.6s | 2.3s | $0.00014 | $0.00015 | 42 |

## Accuracy by difficulty

| difficulty | n | default |
|---|---:|---:|
| easy | 15 | 100.0% |
| hard | 9 | 88.9% |
| medium | 16 | 93.8% |

## Accuracy by tag

| tag | n | default |
|---|---:|---:|
| aggregation | 6 | 100.0% |
| anti-join | 2 | 100.0% |
| date | 9 | 88.9% |
| derived-metric | 1 | 100.0% |
| distinct | 1 | 100.0% |
| filter | 2 | 100.0% |
| having | 2 | 100.0% |
| hierarchy | 1 | 0.0% |
| integer-division | 1 | 100.0% |
| join | 5 | 80.0% |
| multi-hop | 5 | 80.0% |
| null-handling | 3 | 100.0% |
| percentage | 3 | 100.0% |
| pivot | 1 | 100.0% |
| ranking | 5 | 100.0% |
| self-join | 4 | 100.0% |
| ties | 3 | 100.0% |
| time-series | 2 | 100.0% |
| top-n-per-group | 1 | 100.0% |
| unanswerable | 2 | 100.0% |
| units | 1 | 100.0% |
| value-mapping | 12 | 100.0% |
| view | 1 | 100.0% |
| window | 3 | 100.0% |

## Failure categories

| Variant | wrong_columns | wrong_rows |
|---|---:|---:|
| default | 1 | 1 |

## Rescues (correct only because of a recovery step)

| Variant | Repair loop | Empty-result recheck | Smart-tier escalation | Vote overruled a candidate |
|---|---:|---:|---:|---:|
| default | 0 | 0 | 2 | 2 |

## Failures

| Variant | Case | Category | Question | Detail |
|---|---|---|---|---|
| default | `q17` | wrong_rows | What is total net revenue for each top-level product category (the categories that have no parent)? | expected 3 rows, got 0 |
| default | `q35` | wrong_columns | How many units of discontinued products were sold in 2025? | no column matches "Units" |
