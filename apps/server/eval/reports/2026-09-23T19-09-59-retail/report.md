# Evaluation: retail

40 cases × 3 repeat(s) × 7 variant(s) on `Eval_Retail` · models: openai:gpt-6-luna · 2026-09-23T19:09:59.481Z · 424s

Accuracy is **execution accuracy**: the generated SQL must return the same rows as the gold query (column names/order and extra columns ignored; row order checked only for ordered questions).

## Summary

| Variant | Accuracy | ± sd | First try | pass@k | pass^k | Stable | p50 | p95 | $/question | $/correct | LLM calls |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **baseline** | 88.3% | 2.4 | 83.3% | 92.5% | 82.5% | 90.0% | 1.1s | 1.9s | $0.00014 | $0.00016 | 126 |
| **value-hints** | 96.7% | 1.2 | 91.7% | 97.5% | 95.0% | 97.5% | 1.1s | 2.1s | $0.00005 | $0.00005 | 126 |
| **empty-recheck** | 87.5% | 2.0 | 81.7% | 92.5% | 82.5% | 90.0% | 1.2s | 2.2s | $0.00015 | $0.00017 | 129 |
| **few-shot** | 88.3% | 1.2 | 85.8% | 90.0% | 87.5% | 97.5% | 1.1s | 2.0s | $0.00005 | $0.00006 | 123 |
| **vote-3** | 89.2% | 3.1 | 84.2% | 95.0% | 85.0% | 90.0% | 1.4s | 2.6s | $0.00041 | $0.00046 | 366 |
| **default** | 97.5% | 2.0 | 90.0% | 100.0% | 95.0% | 95.0% | 1.1s | 2.4s | $0.00006 | $0.00006 | 129 |
| **default+few-shot** | 95.0% | 0.0 | 89.2% | 100.0% | 87.5% | 87.5% | 1.1s | 2.2s | $0.00007 | $0.00007 | 128 |

Variant settings:

- **baseline**: `SCHEMA_VALUE_HINTS=false` `ASK_EMPTY_RESULT_RECHECK=false` `ASK_FEWSHOT_K=0` `ASK_SQL_CANDIDATES=1`
- **value-hints**: `SCHEMA_VALUE_HINTS=true` `ASK_EMPTY_RESULT_RECHECK=false` `ASK_FEWSHOT_K=0`
- **empty-recheck**: `SCHEMA_VALUE_HINTS=false` `ASK_EMPTY_RESULT_RECHECK=true` `ASK_FEWSHOT_K=0`
- **few-shot**: `SCHEMA_VALUE_HINTS=false` `ASK_EMPTY_RESULT_RECHECK=false` `ASK_FEWSHOT_K=3` `EVAL_FEWSHOT=dataset`
- **vote-3**: `SCHEMA_VALUE_HINTS=false` `ASK_EMPTY_RESULT_RECHECK=false` `ASK_FEWSHOT_K=0` `ASK_SQL_CANDIDATES=3`
- **default+few-shot**: `ASK_FEWSHOT_K=3` `EVAL_FEWSHOT=dataset`

## Accuracy by difficulty

| difficulty | n | baseline | value-hints | empty-recheck | few-shot | vote-3 | default | default+few-shot |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| easy | 15 | 93.3% | 100.0% | 93.3% | 86.7% | 93.3% | 100.0% | 97.8% |
| hard | 9 | 81.5% | 85.2% | 81.5% | 81.5% | 85.2% | 92.6% | 88.9% |
| medium | 16 | 87.5% | 100.0% | 85.4% | 93.8% | 87.5% | 97.9% | 95.8% |

## Accuracy by tag

| tag | n | baseline | value-hints | empty-recheck | few-shot | vote-3 | default | default+few-shot |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| aggregation | 6 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| anti-join | 2 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| date | 9 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| derived-metric | 1 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| distinct | 1 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| filter | 2 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| having | 2 | 83.3% | 100.0% | 83.3% | 100.0% | 83.3% | 83.3% | 66.7% |
| hierarchy | 1 | 0.0% | 0.0% | 33.3% | 0.0% | 33.3% | 100.0% | 66.7% |
| integer-division | 1 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| join | 5 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| multi-hop | 5 | 66.7% | 73.3% | 66.7% | 66.7% | 73.3% | 86.7% | 80.0% |
| null-handling | 3 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| percentage | 3 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| pivot | 1 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| ranking | 5 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| self-join | 4 | 83.3% | 100.0% | 75.0% | 100.0% | 83.3% | 100.0% | 100.0% |
| ties | 3 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| time-series | 2 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| top-n-per-group | 1 | 66.7% | 66.7% | 33.3% | 33.3% | 100.0% | 33.3% | 66.7% |
| unanswerable | 2 | 100.0% | 100.0% | 100.0% | 50.0% | 100.0% | 100.0% | 83.3% |
| units | 1 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| value-mapping | 12 | 75.0% | 100.0% | 72.2% | 83.3% | 72.2% | 100.0% | 97.2% |
| view | 1 | 0.0% | 100.0% | 0.0% | 0.0% | 0.0% | 100.0% | 100.0% |
| window | 3 | 88.9% | 88.9% | 77.8% | 77.8% | 100.0% | 77.8% | 88.9% |

## Failure categories

| Variant | missed_refusal | wrong_columns | wrong_rows |
|---|---:|---:|---:|
| baseline | 0 | 7 | 7 |
| value-hints | 0 | 0 | 4 |
| empty-recheck | 0 | 7 | 8 |
| few-shot | 3 | 6 | 5 |
| vote-3 | 0 | 8 | 5 |
| default | 0 | 0 | 3 |
| default+few-shot | 1 | 1 | 4 |

## Rescues (correct only because of a recovery step)

| Variant | Repair loop | Empty-result recheck | Smart-tier escalation | Vote overruled a candidate |
|---|---:|---:|---:|---:|
| baseline | 0 | 0 | 6 | 6 |
| value-hints | 0 | 0 | 6 | 6 |
| empty-recheck | 0 | 1 | 7 | 7 |
| few-shot | 0 | 0 | 3 | 3 |
| vote-3 | 0 | 0 | 6 | 11 |
| default | 0 | 3 | 9 | 9 |
| default+few-shot | 0 | 2 | 7 | 7 |

## Changes vs `baseline`

- ✅ fixed in **value-hints**: `q15` List every sales rep's full name together with their manager's full name.
- ✅ fixed in **value-hints**: `q25` What is the total amount paid using digital wallets?
- ✅ fixed in **value-hints**: `q28` What is the average net revenue per order for in-store orders?
- ❌ broken in **empty-recheck**: `q19` For each region, which sales rep generated the highest net revenue? Show region name, rep name and net revenue.
- ✅ fixed in **few-shot**: `q15` List every sales rep's full name together with their manager's full name.
- ❌ broken in **few-shot**: `q19` For each region, which sales rep generated the highest net revenue? Show region name, rep name and net revenue.
- ❌ broken in **few-shot**: `q39` What is the average age of our customers?
- ❌ broken in **vote-3**: `q27` What was net revenue from customers in Dubai for laptops in 2025?
- ✅ fixed in **default**: `q15` List every sales rep's full name together with their manager's full name.
- ✅ fixed in **default**: `q17` What is total net revenue for each top-level product category (the categories that have no parent)?
- ❌ broken in **default**: `q19` For each region, which sales rep generated the highest net revenue? Show region name, rep name and net revenue.
- ✅ fixed in **default**: `q25` What is the total amount paid using digital wallets?
- ✅ fixed in **default**: `q28` What is the average net revenue per order for in-store orders?
- ✅ fixed in **default+few-shot**: `q15` List every sales rep's full name together with their manager's full name.
- ✅ fixed in **default+few-shot**: `q17` What is total net revenue for each top-level product category (the categories that have no parent)?
- ✅ fixed in **default+few-shot**: `q25` What is the total amount paid using digital wallets?
- ❌ broken in **default+few-shot**: `q26` How many orders were paid in more than one payment?
- ✅ fixed in **default+few-shot**: `q28` What is the average net revenue per order for in-store orders?

## Failures

| Variant | Case | Category | Question | Detail |
|---|---|---|---|---|
| baseline | `q15` | wrong_rows | List every sales rep's full name together with their manager's full name. | expected 20 rows, got 25 |
| baseline | `q17` | wrong_rows | What is total net revenue for each top-level product category (the categories that have no parent)? | expected 3 rows, got 0 |
| baseline | `q25` | wrong_columns | What is the total amount paid using digital wallets? | no column matches "Paid" |
| baseline | `q28` | wrong_columns | What is the average net revenue per order for in-store orders? | no column matches "AvgOrderRevenue" |
| baseline #2 | `q15` | wrong_rows | List every sales rep's full name together with their manager's full name. | expected 20 rows, got 25 |
| baseline #2 | `q17` | wrong_rows | What is total net revenue for each top-level product category (the categories that have no parent)? | expected 3 rows, got 0 |
| baseline #2 | `q25` | wrong_columns | What is the total amount paid using digital wallets? | no column matches "Paid" |
| baseline #2 | `q28` | wrong_columns | What is the average net revenue per order for in-store orders? | no column matches "AvgOrderRevenue" |
| baseline #3 | `q17` | wrong_rows | What is total net revenue for each top-level product category (the categories that have no parent)? | expected 3 rows, got 0 |
| baseline #3 | `q19` | wrong_rows | For each region, which sales rep generated the highest net revenue? Show region name, rep name and net revenue. | expected 4 rows, got 10 |
| baseline #3 | `q25` | wrong_columns | What is the total amount paid using digital wallets? | no column matches "Paid" |
| baseline #3 | `q26` | wrong_rows | How many orders were paid in more than one payment? | expected 1 rows, got 337 |
| baseline #3 | `q27` | wrong_columns | What was net revenue from customers in Dubai for laptops in 2025? | no column matches "NetRevenue" |
| baseline #3 | `q28` | wrong_columns | What is the average net revenue per order for in-store orders? | no column matches "AvgOrderRevenue" |
| value-hints | `q17` | wrong_rows | What is total net revenue for each top-level product category (the categories that have no parent)? | expected 3 rows, got 0 |
| value-hints | `q19` | wrong_rows | For each region, which sales rep generated the highest net revenue? Show region name, rep name and net revenue. | expected 4 rows, got 10 |
| value-hints #2 | `q17` | wrong_rows | What is total net revenue for each top-level product category (the categories that have no parent)? | expected 3 rows, got 0 |
| value-hints #3 | `q17` | wrong_rows | What is total net revenue for each top-level product category (the categories that have no parent)? | expected 3 rows, got 0 |
| empty-recheck | `q15` | wrong_rows | List every sales rep's full name together with their manager's full name. | expected 20 rows, got 25 |
| empty-recheck | `q17` | wrong_rows | What is total net revenue for each top-level product category (the categories that have no parent)? | expected 3 rows, got 0 |
| empty-recheck | `q19` | wrong_rows | For each region, which sales rep generated the highest net revenue? Show region name, rep name and net revenue. | expected 4 rows, got 10 |
| empty-recheck | `q25` | wrong_columns | What is the total amount paid using digital wallets? | no column matches "Paid" |
| empty-recheck | `q28` | wrong_columns | What is the average net revenue per order for in-store orders? | no column matches "AvgOrderRevenue" |
| empty-recheck #2 | `q15` | wrong_rows | List every sales rep's full name together with their manager's full name. | expected 20 rows, got 25 |
| empty-recheck #2 | `q25` | wrong_columns | What is the total amount paid using digital wallets? | no column matches "Paid" |
| empty-recheck #2 | `q27` | wrong_columns | What was net revenue from customers in Dubai for laptops in 2025? | no column matches "NetRevenue" |
| empty-recheck #2 | `q28` | wrong_columns | What is the average net revenue per order for in-store orders? | no column matches "AvgOrderRevenue" |
| empty-recheck #3 | `q15` | wrong_rows | List every sales rep's full name together with their manager's full name. | expected 20 rows, got 25 |
| empty-recheck #3 | `q17` | wrong_rows | What is total net revenue for each top-level product category (the categories that have no parent)? | expected 3 rows, got 0 |
| empty-recheck #3 | `q19` | wrong_rows | For each region, which sales rep generated the highest net revenue? Show region name, rep name and net revenue. | expected 4 rows, got 10 |
| empty-recheck #3 | `q25` | wrong_columns | What is the total amount paid using digital wallets? | no column matches "Paid" |
| empty-recheck #3 | `q26` | wrong_rows | How many orders were paid in more than one payment? | expected 1 rows, got 337 |
| empty-recheck #3 | `q28` | wrong_columns | What is the average net revenue per order for in-store orders? | no column matches "AvgOrderRevenue" |
| few-shot | `q17` | wrong_rows | What is total net revenue for each top-level product category (the categories that have no parent)? | expected 3 rows, got 0 |
| few-shot | `q19` | wrong_rows | For each region, which sales rep generated the highest net revenue? Show region name, rep name and net revenue. | expected 4 rows, got 10 |
| few-shot | `q25` | wrong_columns | What is the total amount paid using digital wallets? | no column matches "Paid" |
| few-shot | `q28` | wrong_columns | What is the average net revenue per order for in-store orders? | no column matches "AvgOrderRevenue" |
| few-shot | `q39` | missed_refusal | What is the average age of our customers? | answered a question the schema cannot support |
| few-shot #2 | `q17` | wrong_rows | What is total net revenue for each top-level product category (the categories that have no parent)? | expected 3 rows, got 0 |
| few-shot #2 | `q19` | wrong_rows | For each region, which sales rep generated the highest net revenue? Show region name, rep name and net revenue. | expected 4 rows, got 10 |
| few-shot #2 | `q25` | wrong_columns | What is the total amount paid using digital wallets? | no column matches "Paid" |
| few-shot #2 | `q28` | wrong_columns | What is the average net revenue per order for in-store orders? | no column matches "AvgOrderRevenue" |
| few-shot #2 | `q39` | missed_refusal | What is the average age of our customers? | answered a question the schema cannot support |
| few-shot #3 | `q17` | wrong_rows | What is total net revenue for each top-level product category (the categories that have no parent)? | expected 3 rows, got 0 |
| few-shot #3 | `q25` | wrong_columns | What is the total amount paid using digital wallets? | no column matches "Paid" |
| few-shot #3 | `q28` | wrong_columns | What is the average net revenue per order for in-store orders? | no column matches "AvgOrderRevenue" |
| few-shot #3 | `q39` | missed_refusal | What is the average age of our customers? | answered a question the schema cannot support |
| vote-3 | `q15` | wrong_rows | List every sales rep's full name together with their manager's full name. | expected 20 rows, got 25 |
| vote-3 | `q25` | wrong_columns | What is the total amount paid using digital wallets? | no column matches "Paid" |
| vote-3 | `q27` | wrong_columns | What was net revenue from customers in Dubai for laptops in 2025? | no column matches "NetRevenue" |
| vote-3 | `q28` | wrong_columns | What is the average net revenue per order for in-store orders? | no column matches "AvgOrderRevenue" |
| vote-3 #2 | `q17` | wrong_rows | What is total net revenue for each top-level product category (the categories that have no parent)? | expected 3 rows, got 0 |
| vote-3 #2 | `q25` | wrong_columns | What is the total amount paid using digital wallets? | no column matches "Paid" |
| vote-3 #2 | `q28` | wrong_columns | What is the average net revenue per order for in-store orders? | no column matches "AvgOrderRevenue" |
| vote-3 #3 | `q15` | wrong_rows | List every sales rep's full name together with their manager's full name. | expected 20 rows, got 25 |
| vote-3 #3 | `q17` | wrong_rows | What is total net revenue for each top-level product category (the categories that have no parent)? | expected 3 rows, got 0 |
| vote-3 #3 | `q25` | wrong_columns | What is the total amount paid using digital wallets? | no column matches "Paid" |
| vote-3 #3 | `q26` | wrong_rows | How many orders were paid in more than one payment? | expected 1 rows, got 337 |
| vote-3 #3 | `q27` | wrong_columns | What was net revenue from customers in Dubai for laptops in 2025? | no column matches "NetRevenue" |
| vote-3 #3 | `q28` | wrong_columns | What is the average net revenue per order for in-store orders? | no column matches "AvgOrderRevenue" |
| default | `q19` | wrong_rows | For each region, which sales rep generated the highest net revenue? Show region name, rep name and net revenue. | expected 4 rows, got 10 |
| default | `q26` | wrong_rows | How many orders were paid in more than one payment? | expected 1 rows, got 337 |
| default #2 | `q19` | wrong_rows | For each region, which sales rep generated the highest net revenue? Show region name, rep name and net revenue. | expected 4 rows, got 10 |
| default+few-shot | `q19` | wrong_rows | For each region, which sales rep generated the highest net revenue? Show region name, rep name and net revenue. | expected 4 rows, got 10 |
| default+few-shot | `q26` | wrong_rows | How many orders were paid in more than one payment? | expected 1 rows, got 337 |
| default+few-shot #2 | `q17` | wrong_rows | What is total net revenue for each top-level product category (the categories that have no parent)? | expected 3 rows, got 0 |
| default+few-shot #2 | `q39` | missed_refusal | What is the average age of our customers? | answered a question the schema cannot support |
| default+few-shot #3 | `q26` | wrong_rows | How many orders were paid in more than one payment? | expected 1 rows, got 337 |
| default+few-shot #3 | `q27` | wrong_columns | What was net revenue from customers in Dubai for laptops in 2025? | no column matches "NetRevenue" |
