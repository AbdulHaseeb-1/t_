import { ApiError, ask, checkConnection, normalizeBaseUrl } from '../src/lib/api';

const cfg = { baseUrl: 'http://srv:3000/', apiKey: 'secret' };
const ok = (body: unknown, status = 200) =>
  Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response);

afterEach(() => jest.restoreAllMocks());

describe('ask', () => {
  it('posts the question, capped context and API key', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(() => ok({ answer: 'hi' }));
    const context = Array.from({ length: 6 }, (_, i) => ({ question: `q${i}`, sql: `SELECT ${i}` }));
    await ask(cfg, 'How many?', context);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://srv:3000/query/ask');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('secret');
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ question: 'How many?', answer: true });
    expect(body.context.map((c: { question: string }) => c.question)).toEqual(['q2', 'q3', 'q4', 'q5']);
  });

  it.each([
    [401, {}, 'auth', /API key/],
    [429, {}, 'rate_limit', /Too many requests/],
    [422, { message: "Invalid column name 'x'." }, 'query', /Invalid column name/],
    [503, { message: 'All LLM providers failed' }, 'unavailable', /All LLM providers failed/],
    [500, {}, 'server', /\(500\)/],
  ])('maps HTTP %s to a clear error', async (status, body, kind, message) => {
    jest.spyOn(globalThis, 'fetch').mockImplementation(() => ok(body, status));
    const err = await ask(cfg, 'q', []).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ kind, message: expect.stringMatching(message) });
  });

  it('reports network failures with the address to check', async () => {
    jest.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.reject(new TypeError('Network request failed')));
    await expect(ask(cfg, 'q', [])).rejects.toMatchObject({ kind: 'network', message: expect.stringContaining('http://srv:3000') });
  });

  it('distinguishes a user stop from a timeout', async () => {
    jest.spyOn(globalThis, 'fetch').mockImplementation(
      (_url, init) =>
        new Promise((_, reject) => (init as RequestInit).signal!.addEventListener('abort', () => reject(new Error('aborted')))),
    );
    const stop = new AbortController();
    const pending = ask(cfg, 'q', [], stop.signal);
    stop.abort();
    await expect(pending).rejects.toMatchObject({ kind: 'aborted' });

    jest.useFakeTimers();
    const slow = ask(cfg, 'q', []);
    jest.advanceTimersByTime(90_001);
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
