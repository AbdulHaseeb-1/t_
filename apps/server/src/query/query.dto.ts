import { z } from 'zod';

const question = z.string().trim().min(3).max(2000);
const maxRows = z.number().int().positive().max(100_000).optional();
const tier = z.enum(['fast', 'smart']).default('fast');

/** Earlier turns of the same conversation, oldest first, so follow-ups ("and for 2024?") resolve. */
const context = z
  .array(z.object({ question: z.string().trim().min(1).max(2000), sql: z.string().min(1).max(20_000) }))
  .max(4)
  .default([]);

/** `auto` answers in the language and script of the question. */
export const language = z.enum(['auto', 'en', 'ur', 'ur-Latn']).default('auto');

export const askSchema = z.object({
  question,
  context,
  language,
  /** false = return SQL + rows only (one LLM call instead of two). */
  answer: z.boolean().default(true),
  maxRows,
  tier,
  noCache: z.boolean().default(false),
});
export type AskInput = z.infer<typeof askSchema>;

/**
 * Earlier chat turns, oldest first: what was asked, what was answered, and the SQL
 * behind the answer (absent for conversational turns), so follow-ups resolve.
 */
const chatContext = z
  .array(
    z.object({
      question: z.string().trim().min(1).max(2000),
      answer: z.string().max(4000).optional(),
      sql: z.string().min(1).max(20_000).optional(),
    }),
  )
  .max(12)
  .default([]);

/** Chat also takes short conversational messages ("hi", "ok", "ji"). */
const message = z.string().trim().min(1).max(2000);

export const chatSchema = z.object({
  question: message,
  context: chatContext,
  language,
  tier,
  noCache: z.boolean().default(false),
});
export type ChatInput = z.infer<typeof chatSchema>;
export type ChatTurn = z.infer<typeof chatContext>[number];

export const analyzeSchema = z.object({
  question,
  language,
  tier,
  maxSteps: z.number().int().positive().max(20).optional(),
  noCache: z.boolean().default(false),
});
export type AnalyzeInput = z.infer<typeof analyzeSchema>;

export const sqlSchema = z.object({
  sql: z.string().min(1).max(20_000),
  maxRows,
});
export type SqlInput = z.infer<typeof sqlSchema>;

export const exampleSchema = z.object({
  question,
  sql: z.string().min(1).max(20_000),
});
export type ExampleInput = z.infer<typeof exampleSchema>;

export type Turn = z.infer<typeof context>[number];

const jsonField = z
  .string()
  .default('[]')
  .transform((s, ctx) => {
    try {
      return JSON.parse(s) as unknown;
    } catch {
      ctx.addIssue({ code: 'custom', message: 'context must be JSON' });
      return z.NEVER;
    }
  });

const booleanField = (fallback: 'true' | 'false') =>
  z
    .enum(['true', 'false'])
    .default(fallback)
    .transform((v) => v === 'true');

/** Text fields of a multipart /query/ask/media request (files are handled separately). */
export const mediaFieldsSchema = z.object({
  question: z.string().trim().max(2000).default(''),
  context: jsonField.pipe(context),
  language,
  answer: booleanField('true'),
});

/** Text fields of a multipart /query/chat/media request. */
export const chatMediaFieldsSchema = z.object({
  question: z.string().trim().max(2000).default(''),
  context: jsonField.pipe(chatContext),
  language,
  /** true = a fresh answer, e.g. when the person asks again. */
  noCache: booleanField('false'),
});
