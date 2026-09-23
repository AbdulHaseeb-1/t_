import { readFileSync } from 'node:fs';
import { validateEnv } from './env.js';

function parseDotenv(text: string): Record<string, string> {
  return Object.fromEntries(
    text
      .split('\n')
      .filter((l) => /^[A-Z_]+=/.test(l))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
  );
}

describe('validateEnv', () => {
  it('accepts the shipped .env.example as-is', () => {
    const example = parseDotenv(readFileSync(new URL('../../../../.env.example', import.meta.url), 'utf8'));
    const env = validateEnv(example);
    expect(env.LLM_REASONING_EFFORT_FAST).toBe('none');
    expect(env.API_KEY).toBeUndefined();
    expect(env.LLM_FALLBACK_ORDER).toEqual(['openai', 'openrouter']);
  });

  it('treats blank values as unset and still rejects invalid ones', () => {
    expect(validateEnv({ PORT: '', LLM_PROVIDER: '' })).toMatchObject({ PORT: 3000, LLM_PROVIDER: 'auto' });
    expect(() => validateEnv({ LLM_PROVIDER: 'gemini' })).toThrow(/LLM_PROVIDER/);
    expect(() => validateEnv({ LLM_FALLBACK_ORDER: 'openai,bogus' })).toThrow(/unknown provider/);
  });
});
