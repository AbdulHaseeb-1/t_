import { Injectable } from '@nestjs/common';
import { LRUCache } from 'lru-cache';
import { AppConfig } from '../config/app-config.js';

export function normalizeQuestion(q: string): string {
  return q
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[?.!\s]+$/, '')
    .trim();
}

/**
 * Two tiers:
 *  - sql:    question -> validated SQL (long TTL). A hit skips the LLM entirely
 *            yet still returns live data.
 *  - answer: question -> full response (short TTL). A hit skips LLM and DB.
 * Keys include the schema hash, so DDL changes invalidate automatically.
 * A TTL of 0 disables that tier.
 */
@Injectable()
export class QueryCacheService {
  private readonly sql?: LRUCache<string, string>;
  private readonly answers?: LRUCache<string, object>;
  private readonly hits = { sql: 0, answer: 0 };
  private misses = 0;

  constructor(config: AppConfig) {
    const max = config.get('CACHE_MAX_ENTRIES');
    const sqlTtl = config.get('CACHE_SQL_TTL_S');
    const answerTtl = config.get('CACHE_ANSWER_TTL_S');
    if (sqlTtl > 0) this.sql = new LRUCache({ max, ttl: sqlTtl * 1000 });
    if (answerTtl > 0) this.answers = new LRUCache({ max, ttl: answerTtl * 1000 });
  }

  getSql(key: string): string | undefined {
    const v = this.sql?.get(key);
    if (v) this.hits.sql++;
    return v;
  }

  setSql(key: string, sql: string): void {
    this.sql?.set(key, sql);
  }

  getAnswer<T extends object>(key: string): T | undefined {
    const v = this.answers?.get(key) as T | undefined;
    if (v) this.hits.answer++;
    else this.misses++;
    return v;
  }

  setAnswer(key: string, value: object): void {
    this.answers?.set(key, value);
  }

  clear(): void {
    this.sql?.clear();
    this.answers?.clear();
  }

  stats() {
    return {
      sqlEntries: this.sql?.size ?? 0,
      answerEntries: this.answers?.size ?? 0,
      hits: this.hits,
      misses: this.misses,
    };
  }
}
