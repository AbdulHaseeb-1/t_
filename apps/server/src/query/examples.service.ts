import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { AppConfig } from '../config/app-config.js';
import { tokenize } from '../database/schema/schema-retriever.js';
import { normalizeQuestion } from './query-cache.service.js';

export interface Example {
  id: string;
  question: string;
  sql: string;
  addedAt: string;
}

interface Indexed {
  example: Example;
  tokens: Set<string>;
}

/**
 * Verified question -> SQL pairs. The closest ones are shown to the model as
 * worked examples: the cheapest way to teach it this database's conventions
 * (which table is authoritative, how revenue is defined, fiscal calendars...).
 */
@Injectable()
export class ExamplesService implements OnModuleInit {
  private readonly logger = new Logger(ExamplesService.name);
  private items: Indexed[] = [];

  constructor(private readonly config: AppConfig) {}

  async onModuleInit(): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(this.config.get('EXAMPLES_FILE'), 'utf8')) as Example[];
      this.replaceAll(raw);
      this.logger.log(`Loaded ${this.items.length} verified examples`);
    } catch {
      // No examples yet.
    }
  }

  list(): Example[] {
    return this.items.map((i) => i.example);
  }

  /** In-memory replacement (used by the evaluation harness). */
  replaceAll(examples: Omit<Example, 'id' | 'addedAt'>[] | Example[]): void {
    this.items = examples.map((e) => this.index({ ...this.make(e.question, e.sql), ...e }));
  }

  async add(question: string, sql: string): Promise<Example> {
    const example = this.make(question, sql);
    this.items = this.items.filter((i) => i.example.id !== example.id);
    this.items.push(this.index(example));
    await this.persist();
    return example;
  }

  async remove(id: string): Promise<void> {
    const before = this.items.length;
    this.items = this.items.filter((i) => i.example.id !== id);
    if (this.items.length === before) throw new NotFoundException(`Unknown example "${id}"`);
    await this.persist();
  }

  /**
   * Top-k by token overlap (Dice coefficient). The question itself is never
   * returned, so a stored example cannot leak its own answer during evaluation.
   */
  retrieve(question: string, k = this.config.get('ASK_FEWSHOT_K')): Example[] {
    if (k === 0 || this.items.length === 0) return [];
    const q = new Set(tokenize(question));
    if (q.size === 0) return [];
    const self = normalizeQuestion(question);
    return this.items
      .filter((i) => normalizeQuestion(i.example.question) !== self)
      .map((i) => {
        let shared = 0;
        for (const t of q) if (i.tokens.has(t)) shared++;
        return { e: i.example, score: (2 * shared) / (q.size + i.tokens.size) };
      })
      .filter((s) => s.score >= 0.2)
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map((s) => s.e);
  }

  private make(question: string, sql: string): Example {
    const id = createHash('sha1').update(normalizeQuestion(question)).digest('hex').slice(0, 12);
    return { id, question: question.trim(), sql: sql.trim(), addedAt: new Date().toISOString() };
  }

  private index(example: Example): Indexed {
    return { example, tokens: new Set(tokenize(example.question)) };
  }

  private async persist(): Promise<void> {
    const file = this.config.get('EXAMPLES_FILE');
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(this.list(), null, 2)}\n`);
  }
}
