import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { SchemaContext } from '../database/schema/schema.types.js';
import { LANGUAGE_NAME, type Lang } from './language.js';

/**
 * Message order is deliberate: static rules, then schema, then the question.
 * Providers cache identical prompt prefixes (typically >= 1024 tokens), so
 * keeping volatile content last makes repeat traffic up to ~90% cheaper on
 * input tokens and noticeably faster.
 */
export const SQL_RULES = `You translate questions into ONE Microsoft SQL Server (T-SQL) query.
Output format: a single \`\`\`sql fenced block and nothing else.
Rules:
- Read-only: SELECT, or WITH ... SELECT. Never INSERT/UPDATE/DELETE/MERGE, INTO, DECLARE, SET, EXEC, temp tables, or multiple statements.
- Never use SELECT * or alias.*: list the columns the question needs (COUNT(*) is fine).
- Use only objects and columns listed in the schema. Schema-qualify and bracket identifiers: [dbo].[Orders].[OrderId].
- Join along the "->" foreign keys. Alias tables.
- Mind the grain: never SUM a header-level amount (an invoice or order total) over line-level rows, where it repeats once per line. Follow any table or column notes (-- or "quoted").
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
- Use NULLIF to avoid division by zero. Give computed columns readable aliases.
- Derive standard business metrics from columns that carry that meaning (e.g. revenue = quantity * unit price) instead of refusing. Never substitute a different concept: a signup or order date is not a birth date.
- Only if no reasonable query exists, output: \`\`\`sql
-- CANNOT_ANSWER: <short reason>
\`\`\``;

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
): ChatCompletionMessageParam[] {
  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: SQL_RULES.replace('{maxRows}', String(maxRows)) },
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
- Lead with the direct answer in one sentence, then the key figures.
- Questions may be in Urdu or Roman Urdu; the user turn says which language to answer in (default English).
- Use a compact markdown table only when several rows matter.
- If several rows tie for first place, name all of them.
- If the result was sampled or capped, say so. Never invent or extrapolate numbers.
- No preamble, no restating the question, no SQL explanation unless asked.`;

const URDU_STYLE = `Write the whole answer in Urdu script: natural, formal Pakistani Urdu (آپ form).
Always start with at least one complete Urdu sentence, even when a table follows or the answer is a single number.
Use Western digits (0-9) with thousands separators, never Urdu digits. Keep names, codes and IDs from the data exactly as they appear.
Translate table headings into Urdu.`;

const ROMAN_URDU_STYLE = `Write the whole answer in Roman Urdu, the casual way Pakistanis text, for example:
"Ap k 1,050 customers hain." / "Is mahine 320 orders aaye, jin mein se 12 cancel hue."
Keep everyday business words in English (customers, orders, sales, revenue, stock, invoice, products).
Short, friendly sentences with "ap". Always start with at least one full sentence, even when a table follows.
Keep numbers, names, codes and IDs from the data exactly as they appear.`;

/** Language instruction goes in the user turn, so the system prompt stays identical (cacheable) for every language. */
export function answerMessages(
  question: string,
  sql: string,
  table: string,
  lang: Lang = 'en',
): ChatCompletionMessageParam[] {
  const style = lang === 'ur' ? `\n\n${URDU_STYLE}` : lang === 'ur-Latn' ? `\n\n${ROMAN_URDU_STYLE}` : '';
  return [
    { role: 'system', content: ANSWER_SYSTEM },
    { role: 'user', content: `Question: ${question}\n\nSQL:\n${sql}\n\nResult (TSV):\n${table}${style}` },
  ];
}

/** The question as the SQL model sees it, plus the language to refuse in. */
export function sqlQuestion(question: string, lang: Lang): string {
  if (lang === 'en') return question;
  return `${question}\n\n(If you must refuse, write the CANNOT_ANSWER reason in ${LANGUAGE_NAME[lang]}.)`;
}

export const AGENT_SYSTEM = `You are a senior data analyst with read-only access to a Microsoft SQL Server database.
Work efficiently: every tool call costs time and money.
- The schema excerpt below is usually enough. Only call search_schema/describe_tables when a needed table or column is missing.
- Prefer one well-aggregated query over many small ones. Run independent queries in parallel tool calls.
- T-SQL only, SELECT/WITH only, bracketed schema-qualified identifiers, TOP (n) WITH TIES for rankings.
- When you have enough evidence, stop calling tools and write the final answer: direct answer first, then supporting figures, then brief caveats. Use markdown. Never invent numbers.`;

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
