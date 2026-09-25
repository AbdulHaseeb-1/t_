import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { UsageMeter } from '../llm/llm.types.js';
import { testConfig } from '../testing/fake-openai.js';
import { MediaService } from './media.service.js';
import type OpenAI from 'openai';
import {
  GEMINI_TRANSCRIBE_PROMPT,
  GeminiTranscriber,
  OpenAiTranscriber,
  type Transcriber,
} from './transcriber.js';

/** Minimal stand-in for the Gemini Interactions API. */
function fakeGemini(reply: (body: Record<string, any>) => { status?: number; json: unknown }) {
  const requests: { headers: Record<string, unknown>; body: Record<string, any> }[] = [];
  const server: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw);
      requests.push({ headers: req.headers, body });
      const r = reply(body);
      res.writeHead(r.status ?? 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(r.json));
    });
  });
  return {
    requests,
    start: () =>
      new Promise<string>((ok) =>
        server.listen(0, () => ok(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)),
      ),
    stop: () => new Promise<void>((ok) => server.close(() => ok())),
  };
}

const audio = { buffer: Buffer.from('RIFF-fake-audio'), filename: 'v.m4a', mimetype: 'audio/x-m4a' };

describe('GeminiTranscriber', () => {
  it('sends inline audio with a strict Urdu-script instruction and reads transcript, tokens and cost', async () => {
    const g = fakeGemini(() => ({
      json: {
        output_text: ' ہمارے کتنے customers ہیں؟ ',
        usage: { total_input_tokens: 2000, total_output_tokens: 20 },
      },
    }));
    const url = await g.start();
    try {
      const t = await new GeminiTranscriber('k-123', 'gemini-3.5-flash-lite', url).transcribe(audio);
      expect(t).toMatchObject({
        text: 'ہمارے کتنے customers ہیں؟',
        provider: 'gemini',
        inputTokens: 2000,
        outputTokens: 20,
      });
      // $0.30/M in + $2.50/M out
      expect(t.costUsd).toBeCloseTo(0.00065, 6);
      const { headers, body } = g.requests[0];
      expect(headers['x-goog-api-key']).toBe('k-123');
      expect(body).toMatchObject({
        model: 'gemini-3.5-flash-lite',
        store: false,
        generation_config: { temperature: 0, thinking_level: 'minimal' },
      });
      expect(body.input[0]).toEqual({ type: 'text', text: GEMINI_TRANSCRIBE_PROMPT });
      expect(body.input[1]).toEqual({
        type: 'audio',
        data: audio.buffer.toString('base64'),
        mime_type: 'audio/m4a',
      });
      expect(GEMINI_TRANSCRIBE_PROMPT).toMatch(/Never use Devanagari/);
    } finally {
      await g.stop();
    }
  });

  it('retries without a thinking level when the model rejects it', async () => {
    const g = fakeGemini((b) =>
      b.generation_config.thinking_level
        ? { status: 400, json: { error: { message: 'thinking_level is not supported for this model' } } }
        : { json: { output_text: 'ok' } },
    );
    const url = await g.start();
    try {
      const t = await new GeminiTranscriber('k', 'some-future-model', url).transcribe(audio);
      expect(t.text).toBe('ok');
      expect(t.costUsd).toBeUndefined(); // unknown model: no guessed price
      expect(g.requests).toHaveLength(2);
    } finally {
      await g.stop();
    }
  });

  it('surfaces API errors', async () => {
    const g = fakeGemini(() => ({ status: 403, json: { error: { message: 'API key not valid' } } }));
    const url = await g.start();
    try {
      await expect(
        new GeminiTranscriber('bad', 'gemini-3.5-flash-lite', url).transcribe(audio),
      ).rejects.toThrow(/403.*API key not valid/);
    } finally {
      await g.stop();
    }
  });
});

describe('OpenAiTranscriber', () => {
  const fakeClient = (texts: string[]) => {
    const calls: Record<string, unknown>[] = [];
    const client = {
      audio: {
        transcriptions: {
          create: async (body: Record<string, unknown>) => {
            calls.push(body);
            return { text: texts[calls.length - 1], usage: { input_tokens: 40, output_tokens: 10 } };
          },
        },
      },
    } as unknown as OpenAI;
    return { client, calls };
  };

  it('keeps an Urdu-script transcript from the first, unpinned request', async () => {
    const { client, calls } = fakeClient(['پاکستان میں ہمارے کتنے گاہک ہیں؟']);
    const r = await new OpenAiTranscriber(client, 'gpt-4o-transcribe').transcribe(audio);
    expect(r.text).toBe('پاکستان میں ہمارے کتنے گاہک ہیں؟');
    expect(calls).toHaveLength(1);
    expect(calls[0].language).toBeUndefined();
  });

  it('asks again pinned to Urdu when the model writes Urdu speech in Devanagari, and meters both calls', async () => {
    const { client, calls } = fakeClient([
      'पाकिस्तान में हमारे कितने ग्राहक हैं?',
      'پاکستان میں ہمارے کتنے گاہک ہیں؟',
    ]);
    const r = await new OpenAiTranscriber(client, 'gpt-4o-transcribe').transcribe(audio);
    expect(r.text).toBe('پاکستان میں ہمارے کتنے گاہک ہیں؟');
    expect(calls[1]).toMatchObject({ language: 'ur', prompt: expect.stringMatching(/[\u0600-\u06FF]/) });
    expect(r).toMatchObject({ inputTokens: 80, outputTokens: 20 });
    expect(r.costUsd).toBeGreaterThan(0);
  });
});

describe('MediaService speech-to-text routing', () => {
  const service = (env: Record<string, string>) =>
    new MediaService(testConfig(env), {} as never, {} as never);
  const transcribe = (s: MediaService, meter = new UsageMeter()) =>
    (
      s as unknown as {
        transcribe: (a: typeof audio, m: UsageMeter) => Promise<{ text: string; provider: string }>;
      }
    ).transcribe(audio, meter);

  it('prefers Gemini when its key is set (auto), OpenAI otherwise', () => {
    expect(service({ OPENAI_API_KEY: 'o', GEMINI_API_KEY: 'g' }).transcribers.map((t) => t.provider)).toEqual(
      ['gemini', 'openai'],
    );
    expect(service({ OPENAI_API_KEY: 'o' }).transcribers.map((t) => t.provider)).toEqual(['openai']);
    expect(
      service({ OPENAI_API_KEY: 'o', GEMINI_API_KEY: 'g', TRANSCRIBE_PROVIDER: 'openai' }).transcribers.map(
        (t) => t.provider,
      ),
    ).toEqual(['openai', 'gemini']);
  });

  it('falls back to the next provider when one fails, and meters the call', async () => {
    const s = service({ OPENAI_API_KEY: 'o', GEMINI_API_KEY: 'g' });
    const failing: Transcriber = {
      provider: 'gemini',
      model: 'g',
      transcribe: () => Promise.reject(new Error('quota')),
    };
    const working: Transcriber = {
      provider: 'openai',
      model: 'gpt-4o-transcribe',
      transcribe: async () => ({
        text: 'hello',
        provider: 'openai',
        model: 'gpt-4o-transcribe',
        inputTokens: 10,
        outputTokens: 2,
        costUsd: 0.00008,
        latencyMs: 5,
      }),
    };
    s.transcribers.splice(0, s.transcribers.length, failing, working);
    const meter = new UsageMeter();
    await expect(transcribe(s, meter)).resolves.toMatchObject({ text: 'hello', provider: 'openai' });
    expect(meter.summary().calls).toEqual([
      expect.objectContaining({ purpose: 'transcribe', model: 'openai:gpt-4o-transcribe', costUsd: 0.00008 }),
    ]);
  });

  it('treats silence as the user’s problem, not a provider failure', async () => {
    const s = service({ OPENAI_API_KEY: 'o' });
    let second = false;
    s.transcribers.splice(
      0,
      s.transcribers.length,
      {
        provider: 'gemini',
        model: 'g',
        transcribe: async () => ({
          text: '',
          provider: 'gemini',
          model: 'g',
          inputTokens: 1,
          outputTokens: 0,
          latencyMs: 1,
        }),
      },
      {
        provider: 'openai',
        model: 'o',
        transcribe: async () => {
          second = true;
          return { text: 'x', provider: 'openai', model: 'o', inputTokens: 1, outputTokens: 1, latencyMs: 1 };
        },
      },
    );
    await expect(transcribe(s)).rejects.toMatchObject({ response: { code: 'EMPTY_AUDIO' } });
    expect(second).toBe(false);
  });
});
