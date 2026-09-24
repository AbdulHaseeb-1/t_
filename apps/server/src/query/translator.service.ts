import { Injectable } from '@nestjs/common';
import { LRUCache } from 'lru-cache';
import { LlmService } from '../llm/llm.service.js';
import type { UsageMeter } from '../llm/llm.types.js';
import type { Lang } from './language.js';

const SYSTEM = `You translate questions about a business database from Urdu (Urdu script or Roman Urdu, often mixed with English words) into precise English.
Keep every number, name, code, date, unit, ranking and condition exactly. Keep English words that appear in the question as they are.
Do not answer, explain or add anything. Output only the English question.`;

/**
 * Urdu -> English before retrieval and SQL generation: schema matching,
 * examples and SQL rules all work in English, so one small call lifts every
 * downstream step. Cached, so repeated questions cost nothing.
 */
@Injectable()
export class TranslatorService {
  private readonly cache = new LRUCache<string, string>({ max: 2000 });

  constructor(private readonly llm: LlmService) {}

  async toEnglish(text: string, lang: Lang, meter?: UsageMeter): Promise<string> {
    if (lang === 'en') return text;
    const key = text.trim();
    const hit = this.cache.get(key);
    if (hit) return hit;
    const res = await this.llm.chat(
      {
        tier: 'fast',
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: text },
        ],
        temperature: 0,
        maxTokens: 300,
        cacheKey: 'translate',
      },
      meter,
    );
    const english = (res.message.content ?? '').trim().replace(/^["']|["']$/g, '') || text;
    this.cache.set(key, english);
    return english;
  }
}
