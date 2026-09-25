import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { AppConfig } from '../config/app-config.js';
import { type Env, validateEnv } from '../config/env.js';

export interface FakeReply {
  status?: number;
  errorMessage?: string;
  param?: string;
  content?: string | null;
  toolCalls?: { id: string; name: string; arguments: string }[];
  usage?: Record<string, unknown>;
}

/** A streamed chat completion: text in a few chunks, then tool calls, then usage, as the real API sends them. */
function streamReply(res: ServerResponse, body: Record<string, unknown>, r: FakeReply): void {
  res.setHeader('content-type', 'text/event-stream');
  const chunk = (delta: Record<string, unknown>, finish: string | null = null) =>
    res.write(
      `data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 0, model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
    );
  chunk({ role: 'assistant', content: '' });
  for (const piece of (r.content ?? '').match(/[\s\S]{1,12}/g) ?? []) chunk({ content: piece });
  r.toolCalls?.forEach((t, index) =>
    chunk({ tool_calls: [{ index, id: t.id, type: 'function', function: { name: t.name, arguments: t.arguments } }] }),
  );
  chunk({}, r.toolCalls ? 'tool_calls' : 'stop');
  res.write(
    `data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 0, model: body.model, choices: [], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110, ...r.usage } })}\n\n`,
  );
  res.end('data: [DONE]\n\n');
}

/** Minimal OpenAI-compatible /chat/completions server for tests (JSON or streamed). */
export class FakeOpenAI {
  readonly requests: Record<string, unknown>[] = [];
  private server?: Server;

  /** Multipart bodies received by /audio/transcriptions. */
  readonly transcriptions: string[] = [];

  constructor(
    private readonly reply: (body: Record<string, unknown>, n: number) => FakeReply,
    private readonly transcript: () => string = () => '',
  ) {}

  async start(): Promise<string> {
    this.server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c: Buffer) => (raw += c.toString('latin1')));
      req.on('end', () => {
        if (req.url?.endsWith('/audio/transcriptions')) {
          this.transcriptions.push(raw);
          res.setHeader('content-type', 'application/json');
          res.end(
            JSON.stringify({
              text: this.transcript(),
              usage: { type: 'tokens', input_tokens: 50, output_tokens: 12 },
            }),
          );
          return;
        }
        const body = JSON.parse(raw || '{}') as Record<string, unknown>;
        this.requests.push(body);
        const r = this.reply(body, this.requests.length);
        res.setHeader('content-type', 'application/json');
        if (r.status && r.status >= 400) {
          res.statusCode = r.status;
          res.end(
            JSON.stringify({
              error: { message: r.errorMessage ?? `fake ${r.status}`, param: r.param ?? null },
            }),
          );
          return;
        }
        if (body.stream === true) {
          streamReply(res, body, r);
          return;
        }
        res.end(
          JSON.stringify({
            id: 'x',
            object: 'chat.completion',
            created: 0,
            model: body.model,
            choices: [
              {
                index: 0,
                finish_reason: r.toolCalls ? 'tool_calls' : 'stop',
                message: {
                  role: 'assistant',
                  content: r.content ?? null,
                  tool_calls: r.toolCalls?.map((t) => ({
                    id: t.id,
                    type: 'function',
                    function: { name: t.name, arguments: t.arguments },
                  })),
                },
              },
            ],
            usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110, ...r.usage },
          }),
        );
      });
    });
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(this.server!.address() as AddressInfo).port}/v1`;
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = undefined;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

export function testConfig(overrides: Record<string, string> = {}): AppConfig {
  const env: Env = validateEnv({ NODE_ENV: 'test', ...overrides });
  return { get: (k: keyof Env) => env[k] } as AppConfig;
}
