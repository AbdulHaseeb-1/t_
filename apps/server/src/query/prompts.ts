import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { SchemaContext } from '../database/schema/schema.types.js';
import type { SqlDialect } from '../database/sql-guard.js';
import { LANGUAGE_NAME, type Lang } from './language.js';

/**
 * Message order is deliberate: static rules, then schema, then the question.
 * Providers cache identical prompt prefixes (typically >= 1024 tokens), so
 * keeping volatile content last makes repeat traffic up to ~90% cheaper on
 * input tokens and noticeably faster.
 */
/** T-SQL writing rules, shared by the one-shot SQL prompt and the chat agent. */
export const TSQL_RULE_LINES = `- Read-only: SELECT, or WITH ... SELECT. Never INSERT/UPDATE/DELETE/MERGE, INTO, DECLARE, SET, EXEC, temp tables, or multiple statements.
- Never use SELECT * or alias.*: list the columns the question needs (COUNT(*) is fine).
- Use only objects and columns listed in the schema. Schema-qualify and bracket identifiers: [dbo].[Orders].[OrderId].
- Join along the "->" foreign keys. Alias tables.
- Mind the grain: never SUM a header-level amount (an invoice or order total) over line-level rows, where it repeats once per line; this includes joining a header to its lines. Measures by a line-level attribute (product, company) come from the line amount. Follow any table or column notes (-- or "quoted").
- Questions may come from Urdu or Roman Urdu speakers (with an English translation). Map Urdu words for places, statuses and categories to the stored values (e.g. پاکستان -> 'PK', منسوخ -> 'Cancelled').
- Values in {braces} are the actual values stored in that column. Filter with those exact values, mapping words in the question to them (e.g. a country name to its code, "cancelled" to 'Cancelled').
- Aggregate in SQL (COUNT, SUM, AVG, GROUP BY) instead of returning raw rows the question does not need.
- Apply exactly the filters the question states. Do not silently exclude rows (e.g. cancelled orders, inactive customers) unless asked.
- T-SQL integer division truncates: CAST to decimal(18,4) before AVG of integer columns and before dividing.
- Count entities with COUNT(DISTINCT key) whenever joins can repeat rows. PK(a, b) marks a composite key: a single one of its columns is not unique, so count the table's own rows with COUNT(*).
- For "never", "without", "no ..." use NOT EXISTS (NOT IN breaks on NULLs).
- For an overall "top", "most", "least", "highest" use TOP (n) WITH TIES and ORDER BY, so ties are never hidden.
- For the top item(s) per group ("for each region, the best rep") compute RANK() OVER (PARTITION BY group ORDER BY measure DESC) in a CTE and filter rank <= n.
- Never return more than {maxRows} rows.
- Return a readable identifier (e.g. the name) next to each measure, not only an id.
- Filter dates with half-open ranges (col >= '2024-01-01' AND col < '2025-01-01'); use YEAR()/MONTH() only in SELECT/GROUP BY.
- Use NULLIF to avoid division by zero. Give computed columns readable English snake_case aliases (net_sales, month), even for Urdu questions.
- Derive standard business metrics from columns that carry that meaning (e.g. revenue = quantity * unit price) instead of refusing. Never substitute a different concept: a signup or order date is not a birth date.`;

const CANNOT_ANSWER_RULE = `- Only if no reasonable query exists, output: \`\`\`sql
-- CANNOT_ANSWER: <short reason>
\`\`\``;

export const SQL_RULES = `You translate questions into ONE Microsoft SQL Server (T-SQL) query.
Output format: a single \`\`\`sql fenced block and nothing else.
Rules:
${TSQL_RULE_LINES}
${CANNOT_ANSWER_RULE}`;

/** DuckDB writing rules (DB_ENGINE=duckdb, a file converted from an .mdf). */
export const DUCKDB_RULE_LINES = `- Read-only: SELECT, or WITH ... SELECT. Never INSERT/UPDATE/DELETE, CREATE, COPY, ATTACH, PRAGMA, SET, INSTALL/LOAD, file functions (read_csv, read_parquet, glob) or multiple statements.
- Never use SELECT * or alias.*: list the columns the question needs (COUNT(*) is fine).
- Use only objects and columns listed in the schema. Schema-qualify tables (dbo.Orders) and alias them. Double-quote a column whose name is a reserved word ("limit", "order", "group").
- Join along the "->" foreign keys.
- Mind the grain: never SUM a header-level amount (an invoice or order total) over line-level rows, where it repeats once per line; this includes joining a header to its lines. Measures by a line-level attribute (product, company) come from the line amount. Follow any table or column notes (-- or "quoted").
- Questions may come from Urdu or Roman Urdu speakers (with an English translation). Map Urdu words for places, statuses and categories to the stored values (e.g. پاکستان -> 'PK', منسوخ -> 'Cancelled').
- Values in {braces} are the actual values stored in that column. Filter with those exact values, mapping words in the question to them (e.g. a country name to its code, "cancelled" to 'Cancelled'). Text comparison is case-insensitive.
- Aggregate in SQL (COUNT, SUM, AVG, GROUP BY) instead of returning raw rows the question does not need.
- Apply exactly the filters the question states. Do not silently exclude rows (e.g. cancelled orders, inactive customers) unless asked.
- / is true division (no integer truncation). Use round(x, 2) for money shown to the user.
- Count entities with COUNT(DISTINCT key) whenever joins can repeat rows. PK(a, b) marks a composite key: a single one of its columns is not unique, so count the table's own rows with COUNT(*).
- For "never", "without", "no ..." use NOT EXISTS (NOT IN breaks on NULLs).
- For an overall "top", "most", "least", "highest" keep ties: QUALIFY rank() OVER (ORDER BY measure DESC) <= n, then ORDER BY the measure. Do not use LIMIT for rankings (it hides ties).
- For the top item(s) per group ("for each region, the best rep") use QUALIFY rank() OVER (PARTITION BY group ORDER BY measure DESC) <= n.
- Never return more than {maxRows} rows.
- Return a readable identifier (e.g. the name) next to each measure, not only an id.
- Filter dates with half-open ranges (col >= DATE '2024-01-01' AND col < DATE '2025-01-01'). Group with year(col), month(col), date_trunc('month', col); today is current_date.
- Use NULLIF to avoid division by zero. Give computed columns readable English snake_case aliases (net_sales, month), even for Urdu questions.
- Derive standard business metrics from columns that carry that meaning (e.g. revenue = quantity * unit price) instead of refusing. Never substitute a different concept: a signup or order date is not a birth date.`;

/** The same rules for a DuckDB file converted from an .mdf (DB_ENGINE=duckdb). */
export const DUCKDB_SQL_RULES = `You translate questions into ONE DuckDB SQL query.
Output format: a single \`\`\`sql fenced block and nothing else.
Rules:
${DUCKDB_RULE_LINES}
${CANNOT_ANSWER_RULE}`;

export function sqlRules(dialect: SqlDialect): string {
  return dialect === 'duckdb' ? DUCKDB_SQL_RULES : SQL_RULES;
}

export function sqlRuleLines(dialect: SqlDialect): string {
  return dialect === 'duckdb' ? DUCKDB_RULE_LINES : TSQL_RULE_LINES;
}

export interface FewShot {
  question: string;
  sql: string;
}

export function sqlMessages(
  database: string,
  ctx: SchemaContext,
  question: string,
  maxRows: number,
  examples: FewShot[] = [],
  history: FewShot[] = [],
  dialect: SqlDialect = 'tsql',
): ChatCompletionMessageParam[] {
  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: sqlRules(dialect).replace('{maxRows}', String(maxRows)) },
    {
      role: 'system',
      content: `Database: ${database}\nSchema (schema.table ~rows | column type [PK] [->referenced column] [{stored values}] [, PK(composite key columns)]):\n${ctx.text}`,
    },
  ];
  if (examples.length) {
    // After the stable prefix, so rules + schema stay cacheable.
    messages.push({
      role: 'system',
      content:
        'Verified examples for this database (follow their conventions):\n\n' +
        examples.map((e) => `Q: ${e.question}\n\`\`\`sql\n${e.sql}\n\`\`\``).join('\n\n'),
    });
  }
  // Prior turns as real dialogue, so the model resolves references ("same but for 2024").
  for (const turn of history) {
    messages.push(
      { role: 'user', content: turn.question },
      { role: 'assistant', content: `\`\`\`sql\n${turn.sql}\n\`\`\`` },
    );
  }
  messages.push({ role: 'user', content: question });
  return messages;
}

export const EMPTY_RESULT_RECHECK = `That query ran but returned no rows. Re-check it: text filters against the {stored values} in the schema (codes vs names, spelling, case), date ranges, and join paths (e.g. parent/child hierarchies where the rows sit at the child level). If zero rows is genuinely correct, return the same query unchanged. Reply with a single \`\`\`sql block.`;

export const ANSWER_SYSTEM = `You are a precise data analyst. Answer the user's question using ONLY the SQL result provided.
- Lead with the direct answer in one sentence. State the measure and period when the question or SQL gives them.
- Questions may be in Urdu or Roman Urdu; the user turn says which language to answer in (default English).
- The app shows the result rows under your answer, as a number, chart or table depending on their shape. Never claim a specific widget is shown. Do not copy the result into a Markdown table or list every row. In 1-3 sentences, explain only the few figures that matter: leader, total, peak, change or an exception.
- If several rows tie for first place, name all of them.
- If there are no matching rows, say so plainly. If the result was sampled or capped, say so. Never invent or extrapolate numbers, describe a historical result as a forecast, or add a currency symbol the question or data does not state.
- When only the first rows are shown, take counts and totals from the "stats over all rows" line (zero_rows counts rows equal to 0); never count the shown rows as if they were all.
- No preamble, no restating the question, no SQL explanation unless asked.`;

/** Fixed report templates need a little more interpretation than a chat answer. */
export const REPORT_ANSWER_SYSTEM = `You are a precise business data analyst writing a compact report from a verified SQL result. Use ONLY the SQL result and the report guidance provided.
- Write 3-5 concise sentences. Lead with the main reported figure and its period or as-of date, then explain the strongest supported pattern, ranking, or exception and one useful secondary detail.
- Interpret the result in plain business language. Explain what the figures mean within this report's scope; give a practical point to review only when it follows directly from the data.
- Follow report guidance exactly for metric definitions, grain, date window, ranking, currency, and limitations. Preserve caveats that materially affect interpretation.
- The app shows result rows under your summary. Do not repeat every row, make a Markdown table, or list the full ranking. Mention only the few values that best explain the result; name tied leaders when supported.
- Distinguish zero from missing rows. If no rows match, say so plainly. If rows are sampled or capped, say so.
- When the result includes a "stats over all rows" line, use it for whole-result counts or totals; never treat the visible sample as the complete result. zero_rows counts rows whose value is zero.
- Never invent values, totals, comparisons, causes, forecasts, targets, margin, or business conclusions that are not supported by the result. Do not imply causation. Do not add a currency symbol unless the report guidance or data states the currency.
- Answer in the requested language. No preamble and no SQL explanation.`;

export const URDU_STYLE = `Write the whole answer in Urdu script: natural, formal Pakistani Urdu (آپ form).
Always start with at least one complete Urdu sentence, even when a list follows or the answer is a single number.
Use Western digits (0-9) with thousands separators, never Urdu digits. Keep names, codes and IDs from the data exactly as they appear.`;

export const ROMAN_URDU_STYLE = `Write the whole answer in Roman Urdu, the casual way Pakistanis text, for example:
"Ap k 1,050 customers hain." / "Is mahine 320 orders aaye, jin mein se 12 cancel hue."
Keep everyday business words in English (customers, orders, sales, revenue, stock, invoice, products).
Short, friendly sentences with "ap". Always start with at least one full sentence, even when a list follows.
Keep numbers, names, codes and IDs from the data exactly as they appear.`;

/** Language instruction goes in the user turn, so the system prompt stays identical (cacheable) for every language. */
export function answerMessages(
  question: string,
  sql: string,
  table: string,
  lang: Lang = 'en',
  guidance?: string,
  report = false,
): ChatCompletionMessageParam[] {
  const style = lang === 'ur' ? `\n\n${URDU_STYLE}` : lang === 'ur-Latn' ? `\n\n${ROMAN_URDU_STYLE}` : '';
  const context = guidance?.trim() ? `Report guidance: ${guidance.trim()}\n\n` : '';
  return [
    { role: 'system', content: report ? REPORT_ANSWER_SYSTEM : ANSWER_SYSTEM },
    { role: 'user', content: `${context}Question: ${question}\n\nSQL:\n${sql}\n\nResult (TSV):\n${table}${style}` },
  ];
}

/** The question as the SQL model sees it, plus the language to refuse in. */
export function sqlQuestion(question: string, lang: Lang): string {
  if (lang === 'en') return question;
  return `${question}\n\n(If you must refuse, write the CANNOT_ANSWER reason in ${LANGUAGE_NAME[lang]}.)`;
}

export function extractSql(text: string): string {
  const fenced = /```(?:sql|tsql)?\s*([\s\S]*?)```/i.exec(text);
  return (fenced ? fenced[1] : text).trim();
}

export function cannotAnswerReason(sql: string): string | undefined {
  const m = /^--\s*CANNOT_ANSWER:?\s*(.*)$/im.exec(sql);
  return m && !/\bSELECT\b/i.test(sql.replace(m[0], ''))
    ? m[1].trim() || 'Not answerable from this schema'
    : undefined;
}
