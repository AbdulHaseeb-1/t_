# Evaluation: retail

1 cases × 4 repeat(s) × 1 variant(s) on `Eval_Retail` · models: openai:gpt-6-luna · 2026-09-23T19:04:02.653Z · 39s

Accuracy is **execution accuracy**: the generated SQL must return the same rows as the gold query (column names/order and extra columns ignored; row order checked only for ordered questions).

## Summary

| Variant | Accuracy | ± sd | First try | pass@k | pass^k | Stable | p50 | p95 | $/question | $/correct | LLM calls |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **default** | 75.0% | 43.3 | 0.0% | 100.0% | 0.0% | 0.0% | 9.8s | 11.0s | $0.00046 | $0.00061 | 8 |

## Accuracy by difficulty

| difficulty | n | default |
|---|---:|---:|
| hard | 1 | 75.0% |

## Accuracy by tag

| tag | n | default |
|---|---:|---:|
| hierarchy | 1 | 75.0% |
| multi-hop | 1 | 75.0% |

## Failure categories

| Variant | wrong_rows |
|---|---:|
| default | 1 |

## Rescues (correct only because of a recovery step)

| Variant | Repair loop | Empty-result recheck | Smart-tier escalation | Vote overruled a candidate |
|---|---:|---:|---:|---:|
| default | 0 | 3 | 3 | 3 |

## Failures

| Variant | Case | Category | Question | Detail |
|---|---|---|---|---|
| default | `q17` | wrong_rows | What is total net revenue for each top-level product category (the categories that have no parent)? | expected 3 rows, got 0 |
