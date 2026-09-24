import { readFile } from 'node:fs/promises';
import { z } from 'zod';

const caseSchema = z
  .object({
    id: z.string().min(1),
    question: z.string().min(3),
    /** Reference query. Its result, not its text, is the ground truth. */
    gold: z.string().optional(),
    /** The same reference query in DuckDB SQL, used when DB_ENGINE=duckdb (defaults to `gold`). */
    goldDuckdb: z.string().optional(),
    /** `refusal`: the correct behaviour is to say the database cannot answer. */
    expect: z.enum(['result', 'refusal']).default('result'),
    /** Row order is part of the answer (question asks for a sorted list). */
    ordered: z.boolean().default(false),
    tags: z.array(z.string()).default([]),
    difficulty: z.enum(['easy', 'medium', 'hard']).default('medium'),
    /** Language of the question; with --answers the answer must be written in it. */
    language: z.enum(['en', 'ur', 'ur-Latn']).optional(),
    /** Why this case exists / what it tests. */
    note: z.string().optional(),
  })
  .refine((c) => c.expect === 'refusal' || !!c.gold, {
    message: 'gold SQL is required unless expect = refusal',
  });

export const datasetSchema = z.object({
  name: z.string(),
  database: z.string(),
  description: z.string().optional(),
  /** SQL file that creates the database from scratch (for synthetic datasets). */
  fixture: z.string().optional(),
  cases: z.array(caseSchema).min(1),
});

export type EvalCase = z.infer<typeof caseSchema>;
export type Dataset = z.infer<typeof datasetSchema>;

export async function loadDataset(path: string): Promise<Dataset> {
  const raw = JSON.parse(await readFile(path, 'utf8')) as unknown;
  const parsed = datasetSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Invalid dataset ${path}:\n${parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')}`,
    );
  }
  const ids = new Set<string>();
  for (const c of parsed.data.cases) {
    if (ids.has(c.id)) throw new Error(`Duplicate case id "${c.id}" in ${path}`);
    ids.add(c.id);
  }
  return parsed.data;
}
