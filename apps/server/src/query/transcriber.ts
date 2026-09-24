import OpenAI, { toFile } from 'openai';

/**
 * Speech-to-text providers. Chosen for Urdu first:
 *  - Gemini (audio-capable Flash models via the Interactions API) had the best
 *    published Urdu accuracy and costs ~$0.001/min on Flash-Lite. The dedicated
 *    gemini-3.5-transcribe model does NOT list Urdu, so a general model is used
 *    with a strict verbatim-transcription instruction.
 *  - OpenAI gpt-4o-transcribe keeps Urdu in Urdu script without a hint
 *    (the mini model drifts to Devanagari) and is the fallback.
 */
export interface Transcript {
  text: string;
  provider: 'gemini' | 'openai';
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
  latencyMs: number;
}

export interface Transcriber {
  readonly provider: Transcript['provider'];
  readonly model: string;
  transcribe(audio: { buffer: Buffer; filename: string; mimetype: string }): Promise<Transcript>;
}

/** USD per 1M tokens: [audio input, text output]. Unknown models report no cost. */
const PRICES: Record<string, [number, number]> = {
  'gemini-3.5-flash-lite': [0.3, 2.5],
  'gemini-3.8-flash': [3, 3.75],
  'gpt-4o-transcribe': [6, 10],
  'gpt-4o-mini-transcribe': [3, 5],
};

function cost(model: string, input: number, output: number): number | undefined {
  const p = PRICES[model];
  return p ? Number(((input * p[0] + output * p[1]) / 1e6).toFixed(6)) : undefined;
}

export const GEMINI_TRANSCRIBE_PROMPT = `Transcribe this voice message verbatim, exactly as spoken.
- Urdu speech: write it in Urdu script (Perso-Arabic, as used in Pakistan). Never use Devanagari (Hindi) script, never romanize, never translate.
- English words spoken inside Urdu (business terms, product or company names, numbers) stay in English/Latin letters.
- English speech: write it in English.
- Write numbers with Western digits (0-9).
- Do not answer, summarize, correct or add anything. Output only the transcript text.
- If there is no intelligible speech, output nothing.`;

const MIME_ALIASES: Record<string, string> = {
  'audio/x-m4a': 'audio/m4a',
  'audio/mp4': 'audio/m4a',
  'video/mp4': 'audio/m4a',
  'audio/x-wav': 'audio/wav',
  'audio/wave': 'audio/wav',
  'video/webm': 'audio/webm',
  'audio/mp3': 'audio/mpeg',
};

export class GeminiTranscriber implements Transcriber {
  readonly provider = 'gemini' as const;

  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly baseUrl = 'https://generativelanguage.googleapis.com',
    private readonly timeoutMs = 60_000,
  ) {}

  async transcribe(audio: { buffer: Buffer; mimetype: string }): Promise<Transcript> {
    const t0 = performance.now();
    const body = (thinking: boolean) => ({
      model: this.model,
      input: [
        { type: 'text', text: GEMINI_TRANSCRIBE_PROMPT },
        {
          type: 'audio',
          data: audio.buffer.toString('base64'),
          mime_type: MIME_ALIASES[audio.mimetype] ?? audio.mimetype,
        },
      ],
      generation_config: {
        temperature: 0,
        max_output_tokens: 2048,
        ...(thinking ? { thinking_level: 'minimal' } : {}),
      },
      // Voice messages are not kept by the provider.
      store: false,
    });
    let res = await this.post(body(true));
    // Some models do not accept a thinking level: retry once without it.
    if (res.status === 400 && /thinking/i.test(res.text)) res = await this.post(body(false));
    if (!res.ok) throw new Error(`Gemini transcription failed (${res.status}): ${res.text.slice(0, 300)}`);
    const json = JSON.parse(res.text) as {
      output_text?: string;
      usage?: { total_input_tokens?: number; total_output_tokens?: number };
    };
    const inputTokens = json.usage?.total_input_tokens ?? 0;
    const outputTokens = json.usage?.total_output_tokens ?? 0;
    return {
      text: (json.output_text ?? '').trim(),
      provider: 'gemini',
      model: this.model,
      inputTokens,
      outputTokens,
      costUsd: cost(this.model, inputTokens, outputTokens),
      latencyMs: Math.round(performance.now() - t0),
    };
  }

  private async post(body: unknown): Promise<{ ok: boolean; status: number; text: string }> {
    const res = await fetch(`${this.baseUrl.replace(/\/+$/, '')}/v1beta/interactions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    return { ok: res.ok, status: res.status, text: await res.text() };
  }
}

const DEVANAGARI = /[\u0900-\u097F]/;
/** Urdu-script context for the retry; English business words stay in English. */
const URDU_SCRIPT_PROMPT = 'پاکستان میں ہمارے کتنے customers ہیں؟ اس مہینے کی sales کتنی ہے؟';

export class OpenAiTranscriber implements Transcriber {
  readonly provider = 'openai' as const;

  constructor(
    private readonly client: OpenAI,
    readonly model: string,
  ) {}

  async transcribe(audio: { buffer: Buffer; filename: string; mimetype: string }): Promise<Transcript> {
    const t0 = performance.now();
    // No language hint first: the model usually keeps Urdu in Urdu script and still handles English speech.
    let res = await this.request(audio);
    let inputTokens = res.inputTokens;
    let outputTokens = res.outputTokens;
    // Spoken Urdu and Hindi sound alike; when the model picks Devanagari, ask again pinned to Urdu.
    if (DEVANAGARI.test(res.text)) {
      res = await this.request(audio, 'ur');
      inputTokens += res.inputTokens;
      outputTokens += res.outputTokens;
    }
    return {
      text: res.text,
      provider: 'openai',
      model: this.model,
      inputTokens,
      outputTokens,
      costUsd: cost(this.model, inputTokens, outputTokens),
      latencyMs: Math.round(performance.now() - t0),
    };
  }

  private async request(audio: { buffer: Buffer; filename: string; mimetype: string }, language?: 'ur') {
    const res = await this.client.audio.transcriptions.create({
      file: await toFile(audio.buffer, audio.filename, { type: audio.mimetype }),
      model: this.model,
      ...(language ? { language, prompt: URDU_SCRIPT_PROMPT } : {}),
    });
    const usage = (res as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
    return {
      text: res.text.trim(),
      inputTokens: usage?.input_tokens ?? 0,
      outputTokens: usage?.output_tokens ?? 0,
    };
  }
}
