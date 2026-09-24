import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { testConfig } from '../testing/fake-openai.js';
import { ModelPricingService } from './model-pricing.service.js';

describe('ModelPricingService', () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    server = createServer((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          data: [
            { id: 'openai/gpt-4.1-mini', pricing: { prompt: '0.0000004', completion: '0.0000016', input_cache_read: '0.0000001' } },
            { id: 'deepseek/deepseek-v4-flash', pricing: { prompt: '0.0000002', completion: '0.0000008' } },
          ],
        }),
      );
    });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise((ok) => server.close(ok)));

  it('prices uncached, cached and output tokens from the catalog', async () => {
    const p = new ModelPricingService(testConfig({ OPENROUTER_BASE_URL: base }));
    // 1000 prompt (400 cached) + 100 output: 600*0.4 + 400*0.1 + 100*1.6 per 1M
    expect(await p.estimate('openai', 'gpt-4.1-mini', 1000, 400, 100)).toBeCloseTo(0.00044, 10);
    expect(await p.estimate('openrouter', 'deepseek/deepseek-v4-flash', 1000, 0, 0)).toBeCloseTo(0.0002, 10);
  });

  it('prices a dated snapshot as its alias, and leaves unknown models unpriced', async () => {
    const p = new ModelPricingService(testConfig({ OPENROUTER_BASE_URL: base }));
    expect(await p.estimate('openai', 'gpt-4.1-mini-2025-04-14', 1000, 0, 0)).toBeCloseTo(0.0004, 10);
    expect(await p.estimate('openai', 'gpt-nope', 1000, 0, 0)).toBeUndefined();
  });
});
