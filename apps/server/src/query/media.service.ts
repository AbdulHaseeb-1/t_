import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { GeminiTranscriber, OpenAiTranscriber, type Transcriber } from './transcriber.js';
import { AppConfig } from '../config/app-config.js';
import { LlmUnavailableError } from '../common/errors.js';
import { LlmService } from '../llm/llm.service.js';
import { UsageMeter, type UsageSummary } from '../llm/llm.types.js';
import { AnalystService, type ChatOptions, type ChatResponse } from './analyst/analyst.service.js';
import type { Emit } from './analyst/analyst.run.js';
import { AskService, type AskResponse } from './ask.service.js';
import { detectLanguage, type Lang } from './language.js';
import type { ChatTurn, Turn } from './query.dto.js';

export interface UploadedMedia {
  buffer: Buffer;
  filename: string;
  mimetype: string;
}

export interface MediaAskInput {
  question: string;
  context: Turn[];
  language: Lang | 'auto';
  answer: boolean;
  audio?: UploadedMedia;
  image?: UploadedMedia;
}

export interface MediaChatInput {
  question: string;
  context: ChatTurn[];
  language: Lang | 'auto';
  audio?: UploadedMedia;
  image?: UploadedMedia;
}

interface MediaFields {
  /** What was heard in the voice message. */
  transcript?: string;
  /** Which speech-to-text model heard it. */
  speech?: { provider: string; model: string };
  /** What was read from the image: the question in English (used for SQL) and in the user's language. */
  image?: { question: string; display: string; extracted: string };
}

export type MediaAskResponse = AskResponse & MediaFields;
export type MediaChatResponse = ChatResponse & MediaFields;

interface Understood extends MediaFields {
  question: string;
  englishQuestion?: string;
  language: Lang;
  noCache: boolean;
  meter: UsageMeter;
  mediaMs: number;
}

export const AUDIO_TYPES = new Set([
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/aac',
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/webm',
  'audio/ogg',
  'video/mp4',
  'video/webm',
]);
export const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

const VISION_SYSTEM = `You help people query their business database. The user sent an image, possibly with a message.
1. Read everything in the image that matters for the request: text in any language (including Urdu), numbers, names, codes, dates, tables.
2. Write ONE precise, self-contained English question for the database that fulfils the user's request, embedding the specific values read from the image.
   - If the image itself contains a written question, translate THAT question faithfully. Do not add conditions from other content in the image (tables, lists, totals) unless the question refers to them ("these products", "this list").
   - If the user's message refers to the image ("how many of these did we sell?"), combine the message with the values read from the image.
Reply with JSON only:
{"language": "en" | "ur" | "ur-Latn", "written_question": "<a question written in the image, copied exactly in its original language and script, or null>", "question": "<the English question>", "display": "<the same question in the user's language>", "extracted": "<one short sentence, in the user's language, saying what you read>"}
"language" is the language the user wrote or spoke in; if there is no message, the language of any question in the image, else "en". Urdu means Urdu script.`;

function mergeUsage(a: UsageSummary, b: UsageSummary): UsageSummary {
  return {
    llmCalls: a.llmCalls + b.llmCalls,
    promptTokens: a.promptTokens + b.promptTokens,
    cachedPromptTokens: a.cachedPromptTokens + b.cachedPromptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    costUsd: Number((a.costUsd + b.costUsd).toFixed(6)),
    costComplete: a.costComplete && b.costComplete,
    models: [...new Set([...a.models, ...b.models])],
    calls: [...a.calls, ...b.calls],
  };
}

/**
 * Voice and image input. Both are turned into text first (transcript, or an
 * English question read from the image), then the regular, evaluated ask
 * pipeline answers - so media questions get the same accuracy work as typed ones.
 */
@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);
  /** In preference order; the next one is tried when a provider fails. */
  readonly transcribers: Transcriber[] = [];

  constructor(
    private readonly config: AppConfig,
    private readonly llm: LlmService,
    private readonly asker: AskService,
    private readonly analyst: AnalystService,
  ) {
    const key = config.get('OPENAI_API_KEY');
    const openai = key
      ? new OpenAiTranscriber(
          new OpenAI({
            apiKey: key,
            baseURL: config.get('OPENAI_BASE_URL'),
            timeout: config.get('LLM_TIMEOUT_MS'),
            maxRetries: config.get('LLM_MAX_RETRIES'),
          }),
          config.get('TRANSCRIBE_MODEL'),
        )
      : undefined;
    const geminiKey = config.get('GEMINI_API_KEY');
    const gemini = geminiKey
      ? new GeminiTranscriber(geminiKey, config.get('GEMINI_TRANSCRIBE_MODEL'), config.get('GEMINI_BASE_URL'), config.get('LLM_TIMEOUT_MS'))
      : undefined;
    const mode = config.get('TRANSCRIBE_PROVIDER');
    const order: (Transcriber | undefined)[] = mode === 'openai' ? [openai, gemini] : [gemini, openai];
    this.transcribers = order.filter((t): t is Transcriber => !!t);
  }

  async ask(input: MediaAskInput): Promise<MediaAskResponse> {
    const heard = await this.understand(input);
    const res = await this.asker.ask(
      {
        question: heard.question,
        context: input.context,
        language: heard.language,
        answer: input.answer,
        tier: 'fast',
        noCache: heard.noCache,
      },
      heard.englishQuestion ? { englishQuestion: heard.englishQuestion } : {},
    );
    return this.withMedia(heard, res);
  }

  /** The same input for the chat agent; `emit` reports listening/reading before the answer streams. */
  async chat(input: MediaChatInput, opts: Omit<ChatOptions, 'englishQuestion'> = {}): Promise<MediaChatResponse> {
    const heard = await this.understand(input, opts.emit);
    const res = await this.analyst.chat(
      { question: heard.question, context: input.context, language: heard.language, tier: 'fast', noCache: heard.noCache },
      { ...opts, ...(heard.englishQuestion ? { englishQuestion: heard.englishQuestion } : {}) },
    );
    return this.withMedia(heard, res);
  }

  /** Voice and photo turned into the question to answer, in the user's language. */
  private async understand(
    input: Pick<MediaAskInput, 'question' | 'language' | 'audio' | 'image'>,
    emit?: Emit,
  ): Promise<Understood> {
    const started = performance.now();
    const meter = new UsageMeter();

    if (input.audio) emit?.({ type: 'status', stage: 'listening' });
    const heard = input.audio ? await this.transcribe(input.audio, meter) : undefined;
    const transcript = heard?.text;
    const userText = [input.question.trim(), transcript].filter(Boolean).join('\n');
    let lang: Lang | undefined =
      input.language !== 'auto' ? input.language : userText ? detectLanguage(userText) : undefined;

    let image: MediaAskResponse['image'];
    /** A question written in the image, used verbatim when the user sent nothing else. */
    let written: string | undefined;
    if (input.image) {
      emit?.({ type: 'status', stage: 'reading' });
      const read = await this.readImage(input.image, userText, meter);
      written = userText ? undefined : read.written;
      image = { question: read.question, display: written ?? read.display, extracted: read.extracted };
      lang ??= written ? detectLanguage(written) : read.language;
    }

    // A transcribed written question goes through the regular text pipeline unparaphrased:
    // the vision model otherwise tends to fold unrelated image content (tables) into it.
    return {
      question: written ?? (userText || image!.display),
      englishQuestion: written ? undefined : image?.question,
      language: lang ?? 'en',
      noCache: !!input.image && !written,
      transcript,
      speech: heard ? { provider: heard.provider, model: heard.model } : undefined,
      image,
      meter,
      mediaMs: Math.round(performance.now() - started),
    };
  }

  private withMedia<T extends AskResponse | ChatResponse>(u: Understood, res: T): T & MediaFields {
    return <T & MediaFields>{
      ...res,
      transcript: u.transcript,
      ...(u.speech ? { speech: u.speech } : {}),
      image: u.image,
      timings: { ...res.timings, totalMs: res.timings.totalMs + u.mediaMs, llmMs: res.timings.llmMs + u.mediaMs, mediaMs: u.mediaMs },
      usage: mergeUsage(u.meter.summary(), res.usage),
    };
  }

  private async transcribe(audio: UploadedMedia, meter: UsageMeter): Promise<{ text: string; provider: string; model: string }> {
    if (!this.transcribers.length) {
      throw new LlmUnavailableError('Voice messages need GEMINI_API_KEY or OPENAI_API_KEY for speech-to-text.');
    }
    let lastError: unknown;
    for (const t of this.transcribers) {
      try {
        const r = await t.transcribe(audio);
        meter.add({
          provider: t.provider,
          model: r.model,
          purpose: 'transcribe',
          promptTokens: r.inputTokens,
          cachedPromptTokens: 0,
          completionTokens: r.outputTokens,
          costUsd: r.costUsd,
          latencyMs: r.latencyMs,
        });
        if (!r.text) {
          throw new HttpException(
            { message: "Couldn't hear a question in the recording.", code: 'EMPTY_AUDIO' },
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }
        return { text: r.text, provider: r.provider, model: r.model };
      } catch (err) {
        // Silence is an answer, not a provider failure.
        if (err instanceof HttpException) throw err;
        lastError = err;
        this.logger.warn(`${t.provider} transcription failed, trying next: ${(err as Error).message}`);
      }
    }
    throw new LlmUnavailableError(`Speech-to-text failed: ${(lastError as Error)?.message ?? 'unknown error'}`);
  }

  private async readImage(
    image: UploadedMedia,
    userText: string,
    meter: UsageMeter,
  ): Promise<{ question: string; display: string; extracted: string; language: Lang; written?: string }> {
    const res = await this.llm.chat(
      {
        tier: 'fast',
        purpose: 'vision',
        reasoningEffort: this.config.get('VISION_REASONING_EFFORT'),
        maxTokens: 800,
        messages: [
          { role: 'system', content: VISION_SYSTEM },
          {
            role: 'user',
            content: [
              { type: 'text', text: userText ? `Message: ${userText}` : 'No message; use the image.' },
              // High detail was required to read small Urdu text reliably.
              {
                type: 'image_url',
                image_url: {
                  url: `data:${image.mimetype};base64,${image.buffer.toString('base64')}`,
                  detail: 'high',
                },
              },
            ],
          },
        ],
      },
      meter,
    );
    const text = res.message.content ?? '';
    try {
      const json = JSON.parse(/\{[\s\S]*\}/.exec(text)?.[0] ?? '') as {
        question?: string;
        display?: string;
        extracted?: string;
        language?: string;
        written_question?: string | null;
      };
      if (!json.question?.trim()) throw new Error('no question');
      const language: Lang = json.language === 'ur' || json.language === 'ur-Latn' ? json.language : 'en';
      const question = json.question.trim();
      return {
        question,
        display: json.display?.trim() || question,
        extracted: json.extracted?.trim() ?? '',
        language,
        written: typeof json.written_question === 'string' ? json.written_question.trim() || undefined : undefined,
      };
    } catch {
      this.logger.warn(`Unreadable vision reply: ${text.slice(0, 200)}`);
      throw new HttpException(
        {
          message: "Couldn't work out a question from the image. Add a short message with it.",
          code: 'IMAGE_UNCLEAR',
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
  }
}
