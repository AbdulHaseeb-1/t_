import type { OutgoingHttpHeaders } from 'node:http';
import { HttpException, Logger } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ChatEvent, Emit } from './analyst.run.js';

const logger = new Logger('ChatStream');
/** Comment lines keep proxies (ngrok, nginx) from closing a quiet stream while the model thinks. */
const KEEPALIVE_MS = 15_000;

export function wantsEventStream(req: FastifyRequest): boolean {
  return /\btext\/event-stream\b/i.test(req.headers.accept ?? '');
}

/** Aborts when the client goes away before the response is written, so an abandoned agent run stops spending. */
export function abortOnDisconnect(reply: FastifyReply): AbortSignal {
  const controller = new AbortController();
  reply.raw.on('close', () => {
    if (!reply.raw.writableFinished) controller.abort();
  });
  return controller.signal;
}

/** Status and message for an error event, matching what the JSON API would have returned. */
export function errorEvent(err: unknown): Extract<ChatEvent, { type: 'error' }> {
  if (err instanceof HttpException) {
    const body = err.getResponse();
    const message =
      typeof body === 'string' ? body : Array.isArray((body as { message?: unknown }).message) ? ((body as { message: string[] }).message).join('; ') : String((body as { message?: unknown }).message ?? err.message);
    return { type: 'error', status: err.getStatus(), message };
  }
  logger.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  return { type: 'error', status: 500, message: 'Internal server error' };
}

/**
 * Answers with Server-Sent Events: `run` streams events through `emit`, and its
 * return value becomes the final `done` event. Errors after the stream has
 * started are sent as an `error` event (the status line is already out).
 * A client that disconnects aborts the run.
 */
export async function sendEventStream<T>(
  reply: FastifyReply,
  run: (emit: Emit, signal: AbortSignal) => Promise<T>,
): Promise<void> {
  const res = reply.raw;
  const controller = new AbortController();
  // CORS and security headers set by earlier hooks still apply.
  const inherited: OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(reply.getHeaders())) if (value !== undefined) inherited[name] = value;
  reply.hijack();
  res.writeHead(200, {
    ...inherited,
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    'x-accel-buffering': 'no',
    connection: 'keep-alive',
  });
  res.flushHeaders();
  res.on('close', () => {
    if (!res.writableFinished) controller.abort();
  });
  const write = (event: ChatEvent) => {
    if (!res.writableEnded && !res.destroyed) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  };
  const keepalive = setInterval(() => {
    if (!res.writableEnded && !res.destroyed) res.write(': keepalive\n\n');
  }, KEEPALIVE_MS);
  // The first bytes let the client show that the question arrived.
  res.write(': open\n\n');
  try {
    const response = await run(write, controller.signal);
    write({ type: 'done', response });
  } catch (err) {
    if (!controller.signal.aborted) write(errorEvent(err));
  } finally {
    clearInterval(keepalive);
    if (!res.writableEnded) res.end();
  }
}
