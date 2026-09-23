import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { SchemaContext } from '../database/schema/schema.types.js';

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
- Use only objects and columns listed in the schema. Schema-qualify and bracket identifiers: [dbo].[Orders].[OrderId].
- Join along the "->" foreign keys. Alias tables.
- Aggregate in SQL (COUNT, SUM, AVG, GROUP BY) instead of returning raw rows the question does not need.
- For "top", "latest", "most" use TOP (n) with ORDER BY. Never return more than {maxRows} rows.
- Keep WHERE clauses sargable: compare columns to ranges (col >= '2024-01-01' AND col < '2025-01-01') instead of wrapping columns in functions.
- Use ISNULL/COALESCE for nullable aggregates, NULLIF to avoid division by zero, CAST(... AS decimal(18,2)) for ratios.
- Give computed columns readable aliases.
- If the schema cannot answer the question, output: \`\`\`sql
-- CANNOT_ANSWER: <short reason>
\`\`\``;

export function sqlMessages(
  database: string,
  ctx: SchemaContext,
  question: string,
  maxRows: number,
): ChatCompletionMessageParam[] {
  return [
    { role: 'system', content: SQL_RULES.replace('{maxRows}', String(maxRows)) },
    {
      role: 'system',
      content: `Database: ${database}\nSchema (schema.table ~rows | column type [PK] [->referenced column]):\n${ctx.text}`,
    },
    { role: 'user', content: question },
  ];
}

export const ANSWER_SYSTEM = `You are a precise data analyst. Answer the user's question using ONLY the SQL result provided.
- Lead with the direct answer in one sentence, then the key figures.
- Use a compact markdown table only when several rows matter.
- If the result was sampled or capped, say so. Never invent or extrapolate numbers.
- No preamble, no restating the question, no SQL explanation unless asked.`;

export function answerMessages(question: string, sql: string, table: string): ChatCompletionMessageParam[] {
  return [
    { role: 'system', content: ANSWER_SYSTEM },
    { role: 'user', content: `Question: ${question}\n\nSQL:\n${sql}\n\nResult (TSV):\n${table}` },
  ];
}

export const AGENT_SYSTEM = `You are a senior data analyst with read-only access to a Microsoft SQL Server database.
Work efficiently: every tool call costs time and money.
- The schema excerpt below is usually enough. Only call search_schema/describe_tables when a needed table or column is missing.
- Prefer one well-aggregated query over many small ones. Run independent queries in parallel tool calls.
- T-SQL only, SELECT/WITH only, bracketed schema-qualified identifiers, TOP (n) for limits.
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
