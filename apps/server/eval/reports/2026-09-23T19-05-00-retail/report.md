# Evaluation: retail

40 cases × 3 repeat(s) × 7 variant(s) on `Eval_Retail` · models: openai:gpt-6-luna · 2026-09-23T19:05:00.931Z · 212s

Accuracy is **execution accuracy**: the generated SQL must return the same rows as the gold query (column names/order and extra columns ignored; row order checked only for ordered questions).

## Summary

| Variant | Accuracy | ± sd | First try | pass@k | pass^k | Stable | p50 | p95 | $/question | $/correct | LLM calls |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **baseline** | 88.3% | 3.1 | 83.3% | 92.5% | 85.0% | 92.5% | 1.3s | 2.1s | $0.00014 | $0.00016 | 126 |
| **value-hints** | 97.5% | 2.0 | 92.5% | 100.0% | 95.0% | 95.0% | 1.1s | 2.3s | $0.00005 | $0.00005 | 126 |
| **empty-recheck** | 92.5% | 2.0 | 85.8% | 95.0% | 90.0% | 95.0% | 1.4s | 3.3s | $0.00015 | $0.00016 | 129 |
| **few-shot** | 87.5% | 0.0 | 85.0% | 87.5% | 87.5% | 100.0% | 1.3s | 2.3s | $0.00008 | $0.00009 | 123 |
| **vote-3** | 53.3% | 31.8 | 51.7% | 90.0% | 10.0% | 10.0% | 1.0s | 2.2s | $0.00023 | $0.00043 | 209 |
| **default** | 23.3% | 7.2 | 23.3% | 57.5% | 0.0% | 40.0% | 0.5s | 2.4s | $0.00001 | $0.00005 | 30 |
| **default+few-shot** | 39.2% | 2.4 | 38.3% | 72.5% | 2.5% | 27.5% | 0.6s | 2.4s | $0.00005 | $0.00013 | 50 |

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
| easy | 15 | 93.3% | 100.0% | 93.3% | 86.7% | 57.8% | 22.2% | 35.6% |
| hard | 9 | 77.8% | 88.9% | 96.3% | 77.8% | 44.4% | 22.2% | 44.4% |
| medium | 16 | 89.6% | 100.0% | 89.6% | 93.8% | 54.2% | 25.0% | 39.6% |

## Accuracy by tag

| tag | n | baseline | value-hints | empty-recheck | few-shot | vote-3 | default | default+few-shot |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| aggregation | 6 | 100.0% | 100.0% | 100.0% | 100.0% | 66.7% | 33.3% | 22.2% |
| anti-join | 2 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 33.3% | 66.7% |
| date | 9 | 100.0% | 100.0% | 100.0% | 100.0% | 48.1% | 25.9% | 22.2% |
| derived-metric | 1 | 100.0% | 100.0% | 100.0% | 100.0% | 33.3% | 66.7% | 33.3% |
| distinct | 1 | 100.0% | 100.0% | 100.0% | 100.0% | 33.3% | 33.3% | 33.3% |
| filter | 2 | 100.0% | 100.0% | 100.0% | 100.0% | 66.7% | 0.0% | 50.0% |
| having | 2 | 100.0% | 100.0% | 100.0% | 100.0% | 66.7% | 16.7% | 0.0% |
| hierarchy | 1 | 0.0% | 33.3% | 66.7% | 0.0% | 0.0% | 0.0% | 0.0% |
| integer-division | 1 | 100.0% | 100.0% | 100.0% | 100.0% | 66.7% | 33.3% | 33.3% |
| join | 5 | 100.0% | 100.0% | 100.0% | 100.0% | 53.3% | 13.3% | 40.0% |
| multi-hop | 5 | 60.0% | 80.0% | 93.3% | 60.0% | 40.0% | 20.0% | 46.7% |
| null-handling | 3 | 100.0% | 100.0% | 100.0% | 100.0% | 66.7% | 22.2% | 22.2% |
| percentage | 3 | 100.0% | 100.0% | 100.0% | 100.0% | 77.8% | 44.4% | 77.8% |
| pivot | 1 | 100.0% | 100.0% | 100.0% | 100.0% | 66.7% | 0.0% | 0.0% |
| ranking | 5 | 100.0% | 100.0% | 100.0% | 100.0% | 46.7% | 26.7% | 53.3% |
| self-join | 4 | 83.3% | 100.0% | 83.3% | 100.0% | 33.3% | 33.3% | 33.3% |
| ties | 3 | 100.0% | 100.0% | 100.0% | 100.0% | 33.3% | 33.3% | 44.4% |
| time-series | 2 | 100.0% | 100.0% | 100.0% | 100.0% | 66.7% | 0.0% | 33.3% |
| top-n-per-group | 1 | 66.7% | 66.7% | 100.0% | 0.0% | 33.3% | 0.0% | 66.7% |
| unanswerable | 2 | 100.0% | 100.0% | 100.0% | 50.0% | 33.3% | 0.0% | 16.7% |
| units | 1 | 100.0% | 100.0% | 100.0% | 100.0% | 66.7% | 66.7% | 66.7% |
| value-mapping | 12 | 72.2% | 100.0% | 77.8% | 83.3% | 47.2% | 25.0% | 47.2% |
| view | 1 | 0.0% | 100.0% | 0.0% | 0.0% | 0.0% | 33.3% | 66.7% |
| window | 3 | 88.9% | 88.9% | 100.0% | 66.7% | 55.6% | 11.1% | 77.8% |

## Failure categories

| Variant | llm_error | missed_refusal | wrong_columns | wrong_rows |
|---|---:|---:|---:|---:|
| baseline | 0 | 0 | 8 | 6 |
| value-hints | 0 | 0 | 0 | 3 |
| empty-recheck | 0 | 0 | 6 | 3 |
| few-shot | 0 | 3 | 6 | 6 |
| vote-3 | 51 | 0 | 2 | 3 |
| default | 90 | 0 | 0 | 2 |
| default+few-shot | 71 | 0 | 1 | 1 |

## Rescues (correct only because of a recovery step)

| Variant | Repair loop | Empty-result recheck | Smart-tier escalation | Vote overruled a candidate |
|---|---:|---:|---:|---:|
| baseline | 0 | 0 | 6 | 6 |
| value-hints | 0 | 0 | 6 | 6 |
| empty-recheck | 0 | 2 | 8 | 8 |
| few-shot | 0 | 0 | 3 | 3 |
| vote-3 | 0 | 0 | 2 | 5 |
| default | 0 | 0 | 0 | 0 |
| default+few-shot | 0 | 0 | 1 | 1 |

## Changes vs `baseline`

- ✅ fixed in **value-hints**: `q15` List every sales rep's full name together with their manager's full name.
- ✅ fixed in **value-hints**: `q25` What is the total amount paid using digital wallets?
- ✅ fixed in **value-hints**: `q27` What was net revenue from customers in Dubai for laptops in 2025?
- ✅ fixed in **value-hints**: `q28` What is the average net revenue per order for in-store orders?
- ✅ fixed in **empty-recheck**: `q17` What is total net revenue for each top-level product category (the categories that have no parent)?
- ✅ fixed in **empty-recheck**: `q27` What was net revenue from customers in Dubai for laptops in 2025?
- ✅ fixed in **few-shot**: `q15` List every sales rep's full name together with their manager's full name.
- ❌ broken in **few-shot**: `q19` For each region, which sales rep generated the highest net revenue? Show region name, rep name and net revenue.
- ✅ fixed in **few-shot**: `q27` What was net revenue from customers in Dubai for laptops in 2025?
- ❌ broken in **few-shot**: `q39` What is the average age of our customers?
- ❌ broken in **vote-3**: `q07` What was net revenue by customer country code in 2025?
- ❌ broken in **vote-3**: `q09` Which month of 2024 had the most orders? Give the month number and order count.
- ❌ broken in **vote-3**: `q16` Which manager has the most direct reports? Give the manager's name and the number of direct reports.
- ❌ broken in **vote-3**: `q19` For each region, which sales rep generated the highest net revenue? Show region name, rep name and net revenue.
- ❌ broken in **vote-3**: `q22` How many distinct products were sold in December 2025?
- ✅ fixed in **vote-3**: `q27` What was net revenue from customers in Dubai for laptops in 2025?
- ❌ broken in **vote-3**: `q30` What is the gross margin for the Audio category, defined as net revenue minus product unit cost times quantity?
- ❌ broken in **vote-3**: `q34` Which customer referred the most other customers? Give their first name, last name and the number of referrals.
- ❌ broken in **vote-3**: `q35` How many units of discontinued products were sold in 2025, counting every order line regardless of order status?
- ❌ broken in **vote-3**: `q37` How many sales reps were hired before 2021?
- ❌ broken in **vote-3**: `q38` How many orders are still pending?
- ❌ broken in **vote-3**: `q39` What is the average age of our customers?
- ❌ broken in **vote-3**: `q40` Which supplier provides the most products?
- ❌ broken in **default**: `q01` How many customers do we have?
- ❌ broken in **default**: `q02` How many customers are based in Pakistan?
- ❌ broken in **default**: `q03` How many active corporate customers are there?
- ❌ broken in **default**: `q04` How many orders were cancelled in 2025?
- ❌ broken in **default**: `q05` What is the total gross sales across all order items, i.e. quantity times unit price before any discount?
- ❌ broken in **default**: `q06` What was total net revenue (quantity × unit price × (1 − discount)) from delivered orders placed in 2024?
- ❌ broken in **default**: `q07` What was net revenue by customer country code in 2025?
- ❌ broken in **default**: `q08` Which 5 products generated the most net revenue overall? Show product name and net revenue, highest first.
- ❌ broken in **default**: `q09` Which month of 2024 had the most orders? Give the month number and order count.
- ❌ broken in **default**: `q10` What is the average quantity per order line?
- ❌ broken in **default**: `q12` For each sales channel, what percentage of its orders were cancelled (0-100)?
- ❌ broken in **default**: `q13` How many customers have never placed an order?
- ❌ broken in **default**: `q14` List the names of products that have never been sold.
- ❌ broken in **default**: `q18` Which customers placed more than 40 orders? Give customer id and number of orders.
- ❌ broken in **default**: `q19` For each region, which sales rep generated the highest net revenue? Show region name, rep name and net revenue.
- ❌ broken in **default**: `q20` Show monthly net revenue for 2025 with a running total: month number, revenue and cumulative revenue, in month order.
- ❌ broken in **default**: `q21` Compare net revenue in 2024 and 2025 for each channel: show channel, 2024 revenue and 2025 revenue.
- ❌ broken in **default**: `q22` How many distinct products were sold in December 2025?
- ❌ broken in **default**: `q23` How many orders have no sales rep assigned?
- ❌ broken in **default**: `q24` How many orders took more than 3 days to ship, counting days from the order date to the shipped date?
- ❌ broken in **default**: `q26` How many orders were paid in more than one payment?
- ❌ broken in **default**: `q29` Who are our top 3 customers by lifetime net revenue? Show first name, last name and revenue.
- ❌ broken in **default**: `q33` How many customers were referred by another customer?
- ❌ broken in **default**: `q34` Which customer referred the most other customers? Give their first name, last name and the number of referrals.
- ❌ broken in **default**: `q35` How many units of discontinued products were sold in 2025, counting every order line regardless of order status?
- ❌ broken in **default**: `q36` What share of 2025 net revenue came from each customer region? Give region name and percentage (0-100).
- ❌ broken in **default**: `q37` How many sales reps were hired before 2021?
- ❌ broken in **default**: `q38` How many orders are still pending?
- ❌ broken in **default**: `q39` What is the average age of our customers?
- ❌ broken in **default**: `q40` Which supplier provides the most products?
- ❌ broken in **default+few-shot**: `q01` How many customers do we have?
- ❌ broken in **default+few-shot**: `q03` How many active corporate customers are there?
- ❌ broken in **default+few-shot**: `q04` How many orders were cancelled in 2025?
- ❌ broken in **default+few-shot**: `q05` What is the total gross sales across all order items, i.e. quantity times unit price before any discount?
- ❌ broken in **default+few-shot**: `q06` What was total net revenue (quantity × unit price × (1 − discount)) from delivered orders placed in 2024?
- ❌ broken in **default+few-shot**: `q07` What was net revenue by customer country code in 2025?
- ❌ broken in **default+few-shot**: `q09` Which month of 2024 had the most orders? Give the month number and order count.
- ❌ broken in **default+few-shot**: `q10` What is the average quantity per order line?
- ❌ broken in **default+few-shot**: `q18` Which customers placed more than 40 orders? Give customer id and number of orders.
- ❌ broken in **default+few-shot**: `q21` Compare net revenue in 2024 and 2025 for each channel: show channel, 2024 revenue and 2025 revenue.
- ❌ broken in **default+few-shot**: `q22` How many distinct products were sold in December 2025?
- ❌ broken in **default+few-shot**: `q24` How many orders took more than 3 days to ship, counting days from the order date to the shipped date?
- ✅ fixed in **default+few-shot**: `q25` What is the total amount paid using digital wallets?
- ❌ broken in **default+few-shot**: `q26` How many orders were paid in more than one payment?
- ✅ fixed in **default+few-shot**: `q28` What is the average net revenue per order for in-store orders?
- ❌ broken in **default+few-shot**: `q30` What is the gross margin for the Audio category, defined as net revenue minus product unit cost times quantity?
- ❌ broken in **default+few-shot**: `q32` How many customers signed up in each year? Show the year and the count.
- ❌ broken in **default+few-shot**: `q33` How many customers were referred by another customer?
- ❌ broken in **default+few-shot**: `q34` Which customer referred the most other customers? Give their first name, last name and the number of referrals.
- ❌ broken in **default+few-shot**: `q37` How many sales reps were hired before 2021?
- ❌ broken in **default+few-shot**: `q39` What is the average age of our customers?
- ❌ broken in **default+few-shot**: `q40` Which supplier provides the most products?

## Failures

| Variant | Case | Category | Question | Detail |
|---|---|---|---|---|
| baseline | `q15` | wrong_rows | List every sales rep's full name together with their manager's full name. | expected 20 rows, got 25 |
| baseline | `q17` | wrong_rows | What is total net revenue for each top-level product category (the categories that have no parent)? | expected 3 rows, got 0 |
| baseline | `q19` | wrong_rows | For each region, which sales rep generated the highest net revenue? Show region name, rep name and net revenue. | expected 4 rows, got 10 |
| baseline | `q25` | wrong_columns | What is the total amount paid using digital wallets? | no column matches "Paid" |
| baseline | `q27` | wrong_columns | What was net revenue from customers in Dubai for laptops in 2025? | no column matches "NetRevenue" |
| baseline | `q28` | wrong_columns | What is the average net revenue per order for in-store orders? | no column matches "AvgOrderRevenue" |
| baseline #2 | `q15` | wrong_rows | List every sales rep's full name together with their manager's full name. | expected 20 rows, got 25 |
| baseline #2 | `q17` | wrong_rows | What is total net revenue for each top-level product category (the categories that have no parent)? | expected 3 rows, got 0 |
| baseline #2 | `q25` | wrong_columns | What is the total amount paid using digital wallets? | no column matches "Paid" |
| baseline #2 | `q27` | wrong_columns | What was net revenue from customers in Dubai for laptops in 2025? | no column matches "NetRevenue" |
| baseline #2 | `q28` | wrong_columns | What is the average net revenue per order for in-store orders? | no column matches "AvgOrderRevenue" |
| baseline #3 | `q17` | wrong_rows | What is total net revenue for each top-level product category (the categories that have no parent)? | expected 3 rows, got 0 |
| baseline #3 | `q25` | wrong_columns | What is the total amount paid using digital wallets? | no column matches "Paid" |
| baseline #3 | `q28` | wrong_columns | What is the average net revenue per order for in-store orders? | no column matches "AvgOrderRevenue" |
| value-hints | `q17` | wrong_rows | What is total net revenue for each top-level product category (the categories that have no parent)? | expected 3 rows, got 0 |
| value-hints | `q19` | wrong_rows | For each region, which sales rep generated the highest net revenue? Show region name, rep name and net revenue. | expected 4 rows, got 10 |
| value-hints #2 | `q17` | wrong_rows | What is total net revenue for each top-level product category (the categories that have no parent)? | expected 3 rows, got 0 |
| empty-recheck | `q15` | wrong_rows | List every sales rep's full name together with their manager's full name. | expected 20 rows, got 25 |
| empty-recheck | `q17` | wrong_rows | What is total net revenue for each top-level product category (the categories that have no parent)? | expected 3 rows, got 0 |
| empty-recheck | `q25` | wrong_columns | What is the total amount paid using digital wallets? | no column matches "Paid" |
| empty-recheck | `q28` | wrong_columns | What is the average net revenue per order for in-store orders? | no column matches "AvgOrderRevenue" |
| empty-recheck #2 | `q25` | wrong_columns | What is the total amount paid using digital wallets? | no column matches "Paid" |
| empty-recheck #2 | `q28` | wrong_columns | What is the average net revenue per order for in-store orders? | no column matches "AvgOrderRevenue" |
| empty-recheck #3 | `q15` | wrong_rows | List every sales rep's full name together with their manager's full name. | expected 20 rows, got 25 |
| empty-recheck #3 | `q25` | wrong_columns | What is the total amount paid using digital wallets? | no column matches "Paid" |
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
| few-shot #3 | `q19` | wrong_rows | For each region, which sales rep generated the highest net revenue? Show region name, rep name and net revenue. | expected 4 rows, got 10 |
| few-shot #3 | `q25` | wrong_columns | What is the total amount paid using digital wallets? | no column matches "Paid" |
| few-shot #3 | `q28` | wrong_columns | What is the average net revenue per order for in-store orders? | no column matches "AvgOrderRevenue" |
| few-shot #3 | `q39` | missed_refusal | What is the average age of our customers? | answered a question the schema cannot support |
| vote-3 | `q15` | wrong_rows | List every sales rep's full name together with their manager's full name. | expected 20 rows, got 25 |
| vote-3 | `q17` | wrong_rows | What is total net revenue for each top-level product category (the categories that have no parent)? | expected 3 rows, got 0 |
| vote-3 | `q25` | wrong_columns | What is the total amount paid using digital wallets? | no column matches "Paid" |
| vote-3 | `q28` | wrong_columns | What is the average net revenue per order for in-store orders? | no column matches "AvgOrderRevenue" |
| vote-3 #2 | `q07` | llm_error | What was net revenue by customer country code in 2025? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 199185, |
| vote-3 #2 | `q09` | llm_error | Which month of 2024 had the most orders? Give the month number and order count. | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 199573, |
| vote-3 #2 | `q15` | llm_error | List every sales rep's full name together with their manager's full name. | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| vote-3 #2 | `q16` | llm_error | Which manager has the most direct reports? Give the manager's name and the number of direct reports. | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| vote-3 #2 | `q17` | llm_error | What is total net revenue for each top-level product category (the categories that have no parent)? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| vote-3 #2 | `q19` | wrong_rows | For each region, which sales rep generated the highest net revenue? Show region name, rep name and net revenue. | expected 4 rows, got 10 |
| vote-3 #2 | `q22` | llm_error | How many distinct products were sold in December 2025? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| vote-3 #2 | `q24` | llm_error | How many orders took more than 3 days to ship, counting days from the order date to the shipped date? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| vote-3 #2 | `q25` | llm_error | What is the total amount paid using digital wallets? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| vote-3 #2 | `q28` | llm_error | What is the average net revenue per order for in-store orders? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| vote-3 #2 | `q30` | llm_error | What is the gross margin for the Audio category, defined as net revenue minus product unit cost times quantity? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| vote-3 #2 | `q34` | llm_error | Which customer referred the most other customers? Give their first name, last name and the number of referrals. | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| vote-3 #2 | `q35` | llm_error | How many units of discontinued products were sold in 2025, counting every order line regardless of order status? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| vote-3 #2 | `q37` | llm_error | How many sales reps were hired before 2021? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| vote-3 #2 | `q38` | llm_error | How many orders are still pending? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| vote-3 #2 | `q39` | llm_error | What is the average age of our customers? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| vote-3 #2 | `q40` | llm_error | Which supplier provides the most products? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| vote-3 #3 | `q01` | llm_error | How many customers do we have? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| vote-3 #3 | `q02` | llm_error | How many customers are based in Pakistan? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| vote-3 #3 | `q03` | llm_error | How many active corporate customers are there? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| vote-3 #3 | `q04` | llm_error | How many orders were cancelled in 2025? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| vote-3 #3 | `q06` | llm_error | What was total net revenue (quantity × unit price × (1 − discount)) from delivered orders placed in 2024? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| vote-3 #3 | `q07` | llm_error | What was net revenue by customer country code in 2025? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| vote-3 #3 | `q08` | llm_error | Which 5 products generated the most net revenue overall? Show product name and net revenue, highest first. | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| vote-3 #3 | `q09` | llm_error | Which month of 2024 had the most orders? Give the month number and order count. | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| vote-3 #3 | `q10` | llm_error | What is the average quantity per order line? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| vote-3 #3 | `q12` | llm_error | For each sales channel, what percentage of its orders were cancelled (0-100)? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| vote-3 #3 | `q15` | llm_error | List every sales rep's full name together with their manager's full name. | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| vote-3 #3 | `q16` | llm_error | Which manager has the most direct reports? Give the manager's name and the number of direct reports. | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| vote-3 #3 | `q17` | llm_error | What is total net revenue for each top-level product category (the categories that have no parent)? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| vote-3 #3 | `q18` | llm_error | Which customers placed more than 40 orders? Give customer id and number of orders. | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| vote-3 #3 | `q19` | llm_error | For each region, which sales rep generated the highest net revenue? Show region name, rep name and net revenue. | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| vote-3 #3 | `q20` | llm_error | Show monthly net revenue for 2025 with a running total: month number, revenue and cumulative revenue, in month order. | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| vote-3 #3 | `q21` | llm_error | Compare net revenue in 2024 and 2025 for each channel: show channel, 2024 revenue and 2025 revenue. | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| vote-3 #3 | `q22` | llm_error | How many distinct products were sold in December 2025? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| vote-3 #3 | `q23` | llm_error | How many orders have no sales rep assigned? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| vote-3 #3 | `q25` | llm_error | What is the total amount paid using digital wallets? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| vote-3 #3 | `q26` | llm_error | How many orders were paid in more than one payment? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| vote-3 #3 | `q27` | llm_error | What was net revenue from customers in Dubai for laptops in 2025? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 199710, |
| vote-3 #3 | `q28` | llm_error | What is the average net revenue per order for in-store orders? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 199471, |
| vote-3 #3 | `q29` | llm_error | Who are our top 3 customers by lifetime net revenue? Show first name, last name and revenue. | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 199395, |
| vote-3 #3 | `q30` | llm_error | What is the gross margin for the Audio category, defined as net revenue minus product unit cost times quantity? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| vote-3 #3 | `q31` | llm_error | How many order lines had a 20% discount? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| vote-3 #3 | `q32` | llm_error | How many customers signed up in each year? Show the year and the count. | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| vote-3 #3 | `q33` | llm_error | How many customers were referred by another customer? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| vote-3 #3 | `q34` | llm_error | Which customer referred the most other customers? Give their first name, last name and the number of referrals. | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| vote-3 #3 | `q35` | llm_error | How many units of discontinued products were sold in 2025, counting every order line regardless of order status? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| vote-3 #3 | `q36` | llm_error | What share of 2025 net revenue came from each customer region? Give region name and percentage (0-100). | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| vote-3 #3 | `q37` | llm_error | How many sales reps were hired before 2021? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| vote-3 #3 | `q38` | llm_error | How many orders are still pending? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 199753, |
| vote-3 #3 | `q39` | llm_error | What is the average age of our customers? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| vote-3 #3 | `q40` | llm_error | Which supplier provides the most products? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default | `q01` | llm_error | How many customers do we have? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default | `q02` | llm_error | How many customers are based in Pakistan? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default | `q03` | llm_error | How many active corporate customers are there? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default | `q04` | llm_error | How many orders were cancelled in 2025? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default | `q05` | llm_error | What is the total gross sales across all order items, i.e. quantity times unit price before any discount? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default | `q06` | llm_error | What was total net revenue (quantity × unit price × (1 − discount)) from delivered orders placed in 2024? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default | `q07` | llm_error | What was net revenue by customer country code in 2025? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default | `q08` | llm_error | Which 5 products generated the most net revenue overall? Show product name and net revenue, highest first. | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default | `q09` | llm_error | Which month of 2024 had the most orders? Give the month number and order count. | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default | `q14` | llm_error | List the names of products that have never been sold. | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default | `q15` | llm_error | List every sales rep's full name together with their manager's full name. | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default | `q16` | llm_error | Which manager has the most direct reports? Give the manager's name and the number of direct reports. | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default | `q17` | llm_error | What is total net revenue for each top-level product category (the categories that have no parent)? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default | `q18` | llm_error | Which customers placed more than 40 orders? Give customer id and number of orders. | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default | `q19` | llm_error | For each region, which sales rep generated the highest net revenue? Show region name, rep name and net revenue. | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default | `q20` | llm_error | Show monthly net revenue for 2025 with a running total: month number, revenue and cumulative revenue, in month order. | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default | `q21` | llm_error | Compare net revenue in 2024 and 2025 for each channel: show channel, 2024 revenue and 2025 revenue. | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default | `q22` | llm_error | How many distinct products were sold in December 2025? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default | `q24` | llm_error | How many orders took more than 3 days to ship, counting days from the order date to the shipped date? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default | `q25` | llm_error | What is the total amount paid using digital wallets? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default | `q26` | llm_error | How many orders were paid in more than one payment? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default | `q27` | llm_error | What was net revenue from customers in Dubai for laptops in 2025? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default | `q29` | llm_error | Who are our top 3 customers by lifetime net revenue? Show first name, last name and revenue. | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default | `q30` | llm_error | What is the gross margin for the Audio category, defined as net revenue minus product unit cost times quantity? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default | `q33` | llm_error | How many customers were referred by another customer? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default | `q34` | llm_error | Which customer referred the most other customers? Give their first name, last name and the number of referrals. | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default | `q35` | llm_error | How many units of discontinued products were sold in 2025, counting every order line regardless of order status? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default | `q36` | llm_error | What share of 2025 net revenue came from each customer region? Give region name and percentage (0-100). | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default | `q38` | llm_error | How many orders are still pending? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default | `q39` | llm_error | What is the average age of our customers? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default | `q40` | llm_error | Which supplier provides the most products? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default #2 | `q02` | llm_error | How many customers are based in Pakistan? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default #2 | `q03` | llm_error | How many active corporate customers are there? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default #2 | `q05` | llm_error | What is the total gross sales across all order items, i.e. quantity times unit price before any discount? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default #2 | `q06` | llm_error | What was total net revenue (quantity × unit price × (1 − discount)) from delivered orders placed in 2024? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default #2 | `q09` | llm_error | Which month of 2024 had the most orders? Give the month number and order count. | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default #2 | `q10` | llm_error | What is the average quantity per order line? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default #2 | `q12` | llm_error | For each sales channel, what percentage of its orders were cancelled (0-100)? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default #2 | `q13` | llm_error | How many customers have never placed an order? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default #2 | `q14` | llm_error | List the names of products that have never been sold. | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default #2 | `q17` | llm_error | What is total net revenue for each top-level product category (the categories that have no parent)? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default #2 | `q18` | llm_error | Which customers placed more than 40 orders? Give customer id and number of orders. | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default #2 | `q19` | wrong_rows | For each region, which sales rep generated the highest net revenue? Show region name, rep name and net revenue. | expected 4 rows, got 10 |
| default #2 | `q20` | llm_error | Show monthly net revenue for 2025 with a running total: month number, revenue and cumulative revenue, in month order. | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default #2 | `q21` | llm_error | Compare net revenue in 2024 and 2025 for each channel: show channel, 2024 revenue and 2025 revenue. | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default #2 | `q22` | llm_error | How many distinct products were sold in December 2025? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default #2 | `q23` | llm_error | How many orders have no sales rep assigned? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default #2 | `q27` | llm_error | What was net revenue from customers in Dubai for laptops in 2025? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default #2 | `q28` | llm_error | What is the average net revenue per order for in-store orders? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default #2 | `q29` | llm_error | Who are our top 3 customers by lifetime net revenue? Show first name, last name and revenue. | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default #2 | `q31` | llm_error | How many order lines had a 20% discount? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 199768, |
| default #2 | `q33` | llm_error | How many customers were referred by another customer? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default #2 | `q35` | llm_error | How many units of discontinued products were sold in 2025, counting every order line regardless of order status? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default #2 | `q36` | llm_error | What share of 2025 net revenue came from each customer region? Give region name and percentage (0-100). | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default #2 | `q37` | llm_error | How many sales reps were hired before 2021? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default #2 | `q38` | llm_error | How many orders are still pending? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default #2 | `q39` | llm_error | What is the average age of our customers? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default #2 | `q40` | llm_error | Which supplier provides the most products? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default #3 | `q01` | llm_error | How many customers do we have? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default #3 | `q02` | llm_error | How many customers are based in Pakistan? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default #3 | `q03` | llm_error | How many active corporate customers are there? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default #3 | `q04` | llm_error | How many orders were cancelled in 2025? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default #3 | `q05` | llm_error | What is the total gross sales across all order items, i.e. quantity times unit price before any discount? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default #3 | `q06` | llm_error | What was total net revenue (quantity × unit price × (1 − discount)) from delivered orders placed in 2024? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default #3 | `q07` | llm_error | What was net revenue by customer country code in 2025? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default #3 | `q08` | llm_error | Which 5 products generated the most net revenue overall? Show product name and net revenue, highest first. | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default #3 | `q09` | llm_error | Which month of 2024 had the most orders? Give the month number and order count. | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default #3 | `q10` | llm_error | What is the average quantity per order line? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default #3 | `q11` | llm_error | What percentage of all orders were placed through the web channel? Answer as a number between 0 and 100. | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default #3 | `q12` | llm_error | For each sales channel, what percentage of its orders were cancelled (0-100)? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default #3 | `q13` | llm_error | How many customers have never placed an order? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default #3 | `q15` | llm_error | List every sales rep's full name together with their manager's full name. | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default #3 | `q17` | llm_error | What is total net revenue for each top-level product category (the categories that have no parent)? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default #3 | `q18` | llm_error | Which customers placed more than 40 orders? Give customer id and number of orders. | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default #3 | `q19` | wrong_rows | For each region, which sales rep generated the highest net revenue? Show region name, rep name and net revenue. | expected 4 rows, got 10 |
| default #3 | `q20` | llm_error | Show monthly net revenue for 2025 with a running total: month number, revenue and cumulative revenue, in month order. | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default #3 | `q21` | llm_error | Compare net revenue in 2024 and 2025 for each channel: show channel, 2024 revenue and 2025 revenue. | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default #3 | `q23` | llm_error | How many orders have no sales rep assigned? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default #3 | `q24` | llm_error | How many orders took more than 3 days to ship, counting days from the order date to the shipped date? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default #3 | `q25` | llm_error | What is the total amount paid using digital wallets? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default #3 | `q26` | llm_error | How many orders were paid in more than one payment? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default #3 | `q27` | llm_error | What was net revenue from customers in Dubai for laptops in 2025? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default #3 | `q28` | llm_error | What is the average net revenue per order for in-store orders? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default #3 | `q29` | llm_error | Who are our top 3 customers by lifetime net revenue? Show first name, last name and revenue. | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default #3 | `q32` | llm_error | How many customers signed up in each year? Show the year and the count. | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default #3 | `q33` | llm_error | How many customers were referred by another customer? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default #3 | `q34` | llm_error | Which customer referred the most other customers? Give their first name, last name and the number of referrals. | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default #3 | `q35` | llm_error | How many units of discontinued products were sold in 2025, counting every order line regardless of order status? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default #3 | `q37` | llm_error | How many sales reps were hired before 2021? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default #3 | `q38` | llm_error | How many orders are still pending? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default #3 | `q39` | llm_error | What is the average age of our customers? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default #3 | `q40` | llm_error | Which supplier provides the most products? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot | `q01` | llm_error | How many customers do we have? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot | `q05` | llm_error | What is the total gross sales across all order items, i.e. quantity times unit price before any discount? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot | `q06` | llm_error | What was total net revenue (quantity × unit price × (1 − discount)) from delivered orders placed in 2024? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot | `q07` | llm_error | What was net revenue by customer country code in 2025? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot | `q09` | llm_error | Which month of 2024 had the most orders? Give the month number and order count. | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot | `q10` | llm_error | What is the average quantity per order line? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot | `q11` | llm_error | What percentage of all orders were placed through the web channel? Answer as a number between 0 and 100. | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot | `q12` | llm_error | For each sales channel, what percentage of its orders were cancelled (0-100)? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot | `q16` | llm_error | Which manager has the most direct reports? Give the manager's name and the number of direct reports. | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot | `q17` | llm_error | What is total net revenue for each top-level product category (the categories that have no parent)? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot | `q18` | llm_error | Which customers placed more than 40 orders? Give customer id and number of orders. | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot | `q21` | llm_error | Compare net revenue in 2024 and 2025 for each channel: show channel, 2024 revenue and 2025 revenue. | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot | `q23` | llm_error | How many orders have no sales rep assigned? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot | `q24` | llm_error | How many orders took more than 3 days to ship, counting days from the order date to the shipped date? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot | `q25` | llm_error | What is the total amount paid using digital wallets? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot | `q26` | llm_error | How many orders were paid in more than one payment? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot | `q27` | llm_error | What was net revenue from customers in Dubai for laptops in 2025? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot | `q28` | llm_error | What is the average net revenue per order for in-store orders? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot | `q30` | llm_error | What is the gross margin for the Audio category, defined as net revenue minus product unit cost times quantity? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot | `q32` | llm_error | How many customers signed up in each year? Show the year and the count. | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot | `q33` | llm_error | How many customers were referred by another customer? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot | `q34` | llm_error | Which customer referred the most other customers? Give their first name, last name and the number of referrals. | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot | `q38` | llm_error | How many orders are still pending? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot | `q39` | llm_error | What is the average age of our customers? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot | `q40` | llm_error | Which supplier provides the most products? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot #2 | `q03` | llm_error | How many active corporate customers are there? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot #2 | `q04` | llm_error | How many orders were cancelled in 2025? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot #2 | `q05` | llm_error | What is the total gross sales across all order items, i.e. quantity times unit price before any discount? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot #2 | `q06` | llm_error | What was total net revenue (quantity × unit price × (1 − discount)) from delivered orders placed in 2024? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot #2 | `q07` | llm_error | What was net revenue by customer country code in 2025? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot #2 | `q08` | llm_error | Which 5 products generated the most net revenue overall? Show product name and net revenue, highest first. | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot #2 | `q10` | llm_error | What is the average quantity per order line? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 199135, |
| default+few-shot #2 | `q13` | llm_error | How many customers have never placed an order? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot #2 | `q14` | llm_error | List the names of products that have never been sold. | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot #2 | `q15` | llm_error | List every sales rep's full name together with their manager's full name. | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot #2 | `q17` | llm_error | What is total net revenue for each top-level product category (the categories that have no parent)? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot #2 | `q18` | llm_error | Which customers placed more than 40 orders? Give customer id and number of orders. | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot #2 | `q19` | llm_error | For each region, which sales rep generated the highest net revenue? Show region name, rep name and net revenue. | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot #2 | `q20` | llm_error | Show monthly net revenue for 2025 with a running total: month number, revenue and cumulative revenue, in month order. | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 199495, |
| default+few-shot #2 | `q21` | llm_error | Compare net revenue in 2024 and 2025 for each channel: show channel, 2024 revenue and 2025 revenue. | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot #2 | `q22` | llm_error | How many distinct products were sold in December 2025? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot #2 | `q24` | llm_error | How many orders took more than 3 days to ship, counting days from the order date to the shipped date? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot #2 | `q26` | llm_error | How many orders were paid in more than one payment? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot #2 | `q30` | llm_error | What is the gross margin for the Audio category, defined as net revenue minus product unit cost times quantity? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot #2 | `q31` | llm_error | How many order lines had a 20% discount? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot #2 | `q32` | llm_error | How many customers signed up in each year? Show the year and the count. | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot #2 | `q33` | llm_error | How many customers were referred by another customer? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot #2 | `q35` | llm_error | How many units of discontinued products were sold in 2025, counting every order line regardless of order status? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot #2 | `q37` | llm_error | How many sales reps were hired before 2021? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot #2 | `q40` | llm_error | Which supplier provides the most products? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot #3 | `q01` | llm_error | How many customers do we have? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot #3 | `q02` | llm_error | How many customers are based in Pakistan? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot #3 | `q03` | llm_error | How many active corporate customers are there? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot #3 | `q04` | llm_error | How many orders were cancelled in 2025? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot #3 | `q05` | llm_error | What is the total gross sales across all order items, i.e. quantity times unit price before any discount? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot #3 | `q06` | llm_error | What was total net revenue (quantity × unit price × (1 − discount)) from delivered orders placed in 2024? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot #3 | `q07` | llm_error | What was net revenue by customer country code in 2025? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot #3 | `q09` | llm_error | Which month of 2024 had the most orders? Give the month number and order count. | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot #3 | `q15` | llm_error | List every sales rep's full name together with their manager's full name. | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot #3 | `q17` | llm_error | What is total net revenue for each top-level product category (the categories that have no parent)? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot #3 | `q18` | llm_error | Which customers placed more than 40 orders? Give customer id and number of orders. | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot #3 | `q21` | llm_error | Compare net revenue in 2024 and 2025 for each channel: show channel, 2024 revenue and 2025 revenue. | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot #3 | `q22` | llm_error | How many distinct products were sold in December 2025? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot #3 | `q24` | llm_error | How many orders took more than 3 days to ship, counting days from the order date to the shipped date? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot #3 | `q26` | wrong_rows | How many orders were paid in more than one payment? | expected 1 rows, got 337 |
| default+few-shot #3 | `q27` | wrong_columns | What was net revenue from customers in Dubai for laptops in 2025? | no column matches "NetRevenue" |
| default+few-shot #3 | `q29` | llm_error | Who are our top 3 customers by lifetime net revenue? Show first name, last name and revenue. | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot #3 | `q32` | llm_error | How many customers signed up in each year? Show the year and the count. | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot #3 | `q33` | llm_error | How many customers were referred by another customer? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot #3 | `q34` | llm_error | Which customer referred the most other customers? Give their first name, last name and the number of referrals. | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot #3 | `q37` | llm_error | How many sales reps were hired before 2021? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot #3 | `q39` | llm_error | What is the average age of our customers? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
| default+few-shot #3 | `q40` | llm_error | Which supplier provides the most products? | All LLM providers failed: 429 Rate limit reached for gpt-6-luna in organization org-G1PU1WKchJKuVRMxezlGikaH on tokens per min (TPM): Limit 200000, Used 200000, |
