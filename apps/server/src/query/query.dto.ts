import { z } from 'zod';

const question = z.string().trim().min(3).max(2000);
const maxRows = z.number().int().positive().max(100_000).optional();
const tier = z.enum(['fast', 'smart']).default('fast');

/** Earlier turns of the same conversation, oldest first, so follow-ups ("and for 2024?") resolve. */
const context = z
  .array(z.object({ question: z.string().trim().min(1).max(2000), sql: z.string().min(1).max(20_000) }))
  .max(4)
  .default([]);

export const askSchema = z.object({
  question,
  context,
  /** false = return SQL + rows only (one LLM call instead of two). */
  answer: z.boolean().default(true),
  maxRows,
  tier,
  noCache: z.boolean().default(false),
});
export type AskInput = z.infer<typeof askSchema>;

export const analyzeSchema = z.object({
  question,
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
