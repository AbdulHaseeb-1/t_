import { FakeOpenAI, testConfig } from '../testing/fake-openai.js';
import { LlmService } from './llm.service.js';
import { UsageMeter } from './llm.types.js';
import type { ModelPricingService } from './model-pricing.service.js';

const pricing = { estimate: async () => 0.001 } as unknown as ModelPricingService;
const messages = [{ role: 'user' as const, content: 'hi' }];

describe('LlmService', () => {
  let openai: FakeOpenAI;
  let openrouter: FakeOpenAI;
  let openaiStatus = 200;

  beforeEach(async () => {
    openaiStatus = 200;
    openai = new FakeOpenAI(() => ({ status: openaiStatus, content: 'from-openai' }));
    openrouter = new FakeOpenAI(() => ({ content: 'from-openrouter', usage: { cost: 0.0042 } }));
  });
  afterEach(async () => {
    await openai.stop();
    await openrouter.stop();
  });

  async function service(extra: Record<string, string> = {}) {
    const config = testConfig({
      OPENAI_API_KEY: 'k1',
      OPENAI_BASE_URL: await openai.start(),
      OPENROUTER_API_KEY: 'k2',
      OPENROUTER_BASE_URL: await openrouter.start(),
      OPENROUTER_PROVIDER_SORT: 'throughput',
      LLM_BREAKER_THRESHOLD: '1',
      ...extra,
    });
    return new LlmService(config, pricing);
  }

  it('uses the primary provider with provider-specific parameters', async () => {
    const llm = await service({ LLM_REASONING_EFFORT_FAST: 'low' });
    const meter = new UsageMeter();
    const res = await llm.chat({ tier: 'fast', messages, cacheKey: 'sql:abc', maxTokens: 50 }, meter);
    expect(res.message.content).toBe('from-openai');
    expect(openai.requests[0]).toMatchObject({
      model: 'gpt-6-luna',
      max_completion_tokens: 50,
      prompt_cache_key: 'sql:abc',
      reasoning_effort: 'low',
    });
    expect(meter.summary()).toMatchObject({ llmCalls: 1, costUsd: 0.001, models: ['openai:gpt-6-luna'] });
  });

  it('fails over to OpenRouter on 5xx and then skips the open breaker', async () => {
    openaiStatus = 503;
    const llm = await service();
    const meter = new UsageMeter();
    const res = await llm.chat({ tier: 'smart', messages }, meter);
    expect(res.usage.provider).toBe('openrouter');
    expect(openrouter.requests[0]).toMatchObject({
      model: 'anthropic/claude-sonnet-5',
      usage: { include: true },
      provider: { sort: 'throughput' },
    });
    expect(meter.summary().costUsd).toBe(0.0042); // exact cost reported by OpenRouter

    const before = openai.requests.length;
    await llm.chat({ tier: 'fast', messages });
    expect(openai.requests.length).toBe(before); // breaker open: primary skipped
  });

  it('does not fail over on a 400 (our request is wrong)', async () => {
    openaiStatus = 400;
    const llm = await service();
    await expect(llm.chat({ tier: 'fast', messages })).rejects.toThrow(/400/);
    expect(openrouter.requests).toHaveLength(0);
  });

  it('pins a provider when the mode is switched at runtime', async () => {
    const llm = await service();
    llm.setMode('openrouter');
    const res = await llm.chat({ tier: 'fast', messages });
    expect(res.usage).toMatchObject({ provider: 'openrouter', model: 'deepseek/deepseek-v4-flash' });

    openaiStatus = 503;
    llm.setMode('openai');
    await expect(llm.chat({ tier: 'fast', messages })).rejects.toThrow(/All LLM providers failed/);
    expect(openrouter.requests).toHaveLength(1);
  });

  it('rejects switching to a provider without a key', () => {
    const llm = new LlmService(testConfig({ OPENROUTER_API_KEY: 'k' }), pricing);
    expect(() => llm.setMode('openai')).toThrow(/no API key/);
    expect(llm.getState().providers.map((p) => p.name)).toEqual(['openrouter']);
  });
});
