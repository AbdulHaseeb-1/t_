# Evaluation: retail

2 cases × 3 repeat(s) × 1 variant(s) on `Eval_Retail` · models: openai:gpt-6-luna · 2026-09-23T19:03:23.417Z · 9s

Accuracy is **execution accuracy**: the generated SQL must return the same rows as the gold query (column names/order and extra columns ignored; row order checked only for ordered questions).

## Summary

| Variant | Accuracy | ± sd | First try | pass@k | pass^k | Stable | p50 | p95 | $/question | $/correct | LLM calls |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **default** | 50.0% | 0.0 | 50.0% | 50.0% | 50.0% | 100.0% | 1.8s | 3.2s | $0.00013 | $0.00025 | 9 |

## Accuracy by difficulty

| difficulty | n | default |
|---|---:|---:|
| hard | 1 | 0.0% |
| medium | 1 | 100.0% |

## Accuracy by tag

| tag | n | default |
|---|---:|---:|
| date | 1 | 100.0% |
| hierarchy | 1 | 0.0% |
| join | 1 | 100.0% |
| multi-hop | 1 | 0.0% |

## Failure categories

| Variant | wrong_rows |
|---|---:|
| default | 3 |

## Rescues (correct only because of a recovery step)

| Variant | Repair loop | Empty-result recheck | Smart-tier escalation | Vote overruled a candidate |
|---|---:|---:|---:|---:|
| default | 0 | 0 | 0 | 0 |

## Failures

| Variant | Case | Category | Question | Detail |
|---|---|---|---|---|
| default | `q17` | wrong_rows | What is total net revenue for each top-level product category (the categories that have no parent)? | expected 3 rows, got 0 |
| default #2 | `q17` | wrong_rows | What is total net revenue for each top-level product category (the categories that have no parent)? | expected 3 rows, got 0 |
| default #3 | `q17` | wrong_rows | What is total net revenue for each top-level product category (the categories that have no parent)? | expected 3 rows, got 8 |
