import { ApiError, chat, checkConnection, normalizeBaseUrl } from '../src/lib/api';

const cfg = { baseUrl: 'http://srv:3000/', apiKey: 'secret' };
const ok = (body: unknown, status = 200) =>
  Promise.resolve({
    ok: status < 400,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(body),
  } as Response);
const ask = (question: string, signal?: AbortSignal, language?: 'ur-Latn', fresh?: boolean) =>
  chat(cfg, question, [], {}, signal, language, fresh);
const sent = (fetchMock: jest.SpyInstance) => JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)) as Record<string, unknown>;

afterEach(() => jest.restoreAllMocks());

describe('chat', () => {
  it('posts the question, earlier turns and API key, asking for a stream', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(() => ok({ answer: 'hi' }));
    const context = [{ question: 'q1', answer: 'a1', sql: 'SELECT 1' }];
    await chat(cfg, 'How many?', context, {});
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://srv:3000/query/chat');
    const headers = init.headers as Record<string, string>;
    expect(headers).toMatchObject({ 'x-api-key': 'secret', Accept: 'text/event-stream' });
    expect(sent(fetchMock)).toEqual({ question: 'How many?', context, language: 'auto' });
  });

  it('asks the server for a fresh answer when asking again', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(() => ok({ answer: 'hi' }));
    await ask('q', undefined, undefined, true);
    expect(sent(fetchMock)).toMatchObject({ noCache: true });
  });

  it.each([
    [401, {}, 'auth', /API key/],
    [429, {}, 'rate_limit', /Too many requests/],
    [422, { message: "Invalid column name 'x'." }, 'query', /Invalid column name/],
    [503, { message: 'All LLM providers failed' }, 'unavailable', /All LLM providers failed/],
    [500, {}, 'server', /\(500\)/],
  ])('maps HTTP %s to a clear error', async (status, body, kind, message) => {
    jest.spyOn(globalThis, 'fetch').mockImplementation(() => ok(body, status));
    const err = await ask('q').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ kind, message: expect.stringMatching(message) });
  });

  it('sends the chosen reply language', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(() => ok({ answer: 'Ap k 20 customers hain.' }));
    await ask('kitne customers hain?', undefined, 'ur-Latn');
    expect(sent(fetchMock).language).toBe('ur-Latn');
  });

  it('refuses to call out before a server address is set', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch');
    await expect(chat({ baseUrl: '' }, 'q', [], {})).rejects.toMatchObject({ kind: 'unconfigured' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports network failures with the address to check', async () => {
    jest.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.reject(new TypeError('Network request failed')));
    await expect(ask('q')).rejects.toMatchObject({ kind: 'network', message: expect.stringContaining('http://srv:3000') });
  });

  it('distinguishes a user stop from a stream that went quiet', async () => {
    jest.spyOn(globalThis, 'fetch').mockImplementation(
      (_url, init) =>
        new Promise((_, reject) => (init as RequestInit).signal!.addEventListener('abort', () => reject(new Error('aborted')))),
    );
    const stop = new AbortController();
    const pending = ask('q', stop.signal);
    stop.abort();
    await expect(pending).rejects.toMatchObject({ kind: 'aborted' });

    jest.useFakeTimers();
    const slow = ask('q');
    jest.advanceTimersByTime(60_001);
    await expect(slow).rejects.toMatchObject({ kind: 'timeout' });
    jest.useRealTimers();
  });
});

describe('checkConnection', () => {
  it('reports a rejected key without failing the check', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => ok({ status: 'ok', db: { ok: true }, llm: { configured: true, mode: 'openai' } }))
      .mockImplementationOnce(() => ok({}, 401));
    expect(await checkConnection(cfg)).toMatchObject({ status: 'ok', authorized: false });
  });
});

describe('normalizeBaseUrl', () => {
  it('adds a scheme and trims slashes', () => {
    expect(normalizeBaseUrl(' 192.168.1.5:3000// ')).toBe('http://192.168.1.5:3000');
    expect(normalizeBaseUrl('https://api.example.com/')).toBe('https://api.example.com');
  });
});
