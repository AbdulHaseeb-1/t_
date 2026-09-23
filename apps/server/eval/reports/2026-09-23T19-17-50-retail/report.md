# Evaluation: retail

40 cases × 3 repeat(s) × 2 variant(s) on `Eval_Retail` · models: openai:gpt-6-luna · 2026-09-23T19:17:50.834Z · 125s

Accuracy is **execution accuracy**: the generated SQL must return the same rows as the gold query (column names/order and extra columns ignored; row order checked only for ordered questions).

## Summary

| Variant | Accuracy | ± sd | First try | pass@k | pass^k | Stable | p50 | p95 | $/question | $/correct | LLM calls |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **default** | 98.3% | 2.4 | 91.7% | 100.0% | 95.0% | 95.0% | 1.2s | 2.2s | $0.00006 | $0.00006 | 129 |
| **default+few-shot** | 99.2% | 1.2 | 92.5% | 100.0% | 97.5% | 97.5% | 1.2s | 2.4s | $0.00010 | $0.00010 | 129 |

Variant settings:

- **default+few-shot**: `ASK_FEWSHOT_K=3` `EVAL_FEWSHOT=dataset`

## Accuracy by difficulty

| difficulty | n | default | default+few-shot |
|---|---:|---:|---:|
| easy | 15 | 100.0% | 100.0% |
| hard | 9 | 92.6% | 96.3% |
| medium | 16 | 100.0% | 100.0% |

## Accuracy by tag

| tag | n | default | default+few-shot |
|---|---:|---:|---:|
| aggregation | 6 | 100.0% | 100.0% |
| anti-join | 2 | 100.0% | 100.0% |
| date | 9 | 100.0% | 100.0% |
| derived-metric | 1 | 100.0% | 100.0% |
| distinct | 1 | 100.0% | 100.0% |
| filter | 2 | 100.0% | 100.0% |
| having | 2 | 100.0% | 100.0% |
| hierarchy | 1 | 66.7% | 66.7% |
| integer-division | 1 | 100.0% | 100.0% |
| join | 5 | 100.0% | 100.0% |
| multi-hop | 5 | 86.7% | 93.3% |
| null-handling | 3 | 100.0% | 100.0% |
| percentage | 3 | 100.0% | 100.0% |
| pivot | 1 | 100.0% | 100.0% |
| ranking | 5 | 100.0% | 100.0% |
| self-join | 4 | 100.0% | 100.0% |
| ties | 3 | 100.0% | 100.0% |
| time-series | 2 | 100.0% | 100.0% |
| top-n-per-group | 1 | 100.0% | 100.0% |
| unanswerable | 2 | 100.0% | 100.0% |
| units | 1 | 100.0% | 100.0% |
| value-mapping | 12 | 97.2% | 100.0% |
| view | 1 | 100.0% | 100.0% |
| window | 3 | 100.0% | 100.0% |

## Failure categories

| Variant | wrong_columns | wrong_rows |
|---|---:|---:|
| default | 1 | 1 |
| default+few-shot | 0 | 1 |

## Rescues (correct only because of a recovery step)

| Variant | Repair loop | Empty-result recheck | Smart-tier escalation | Vote overruled a candidate |
|---|---:|---:|---:|---:|
| default | 1 | 1 | 7 | 8 |
| default+few-shot | 0 | 2 | 8 | 8 |

## Failures

| Variant | Case | Category | Question | Detail |
|---|---|---|---|---|
| default #3 | `q17` | wrong_rows | What is total net revenue for each top-level product category (the categories that have no parent)? | expected 3 rows, got 0 |
| default #3 | `q27` | wrong_columns | What was net revenue from customers in Dubai for laptops in 2025? | no column matches "NetRevenue" |
| default+few-shot | `q17` | wrong_rows | What is total net revenue for each top-level product category (the categories that have no parent)? | expected 3 rows, got 0 |
