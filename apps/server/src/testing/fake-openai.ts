import { createServer, type Server } from 'node:http';
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

/** Minimal OpenAI-compatible /chat/completions server for tests. */
export class FakeOpenAI {
  readonly requests: Record<string, unknown>[] = [];
  private server?: Server;

  constructor(private readonly reply: (body: Record<string, unknown>, n: number) => FakeReply) {}

  async start(): Promise<string> {
    this.server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c: Buffer) => (raw += c.toString()));
      req.on('end', () => {
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
