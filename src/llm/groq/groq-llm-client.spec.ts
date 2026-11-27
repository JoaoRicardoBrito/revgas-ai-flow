import { describe, expect, it, vi } from 'vitest';
import { LlmError } from '../llm-client.js';
import {
  GROQ_DEFAULT_MODEL,
  GroqLlmClient,
  parseRetryAfter,
} from './groq-llm-client.js';

const request = {
  system: 'sistema',
  user: 'usuário',
  schemaName: 'teste',
  jsonSchema: {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  },
};

const ok = (content: string | null, finish = 'stop') =>
  Response.json({
    id: 'x',
    object: 'chat.completion',
    model: GROQ_DEFAULT_MODEL,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content },
        finish_reason: finish,
      },
    ],
  });

function client(
  response: Response | (() => Promise<Response>),
  opts: { timeoutMs?: number } = {},
) {
  const fetchSpy = vi.fn((_url: string | URL | Request, _init?: RequestInit) =>
    typeof response === 'function'
      ? response()
      : Promise.resolve(response.clone()),
  );
  return {
    fetchSpy,
    groq: new GroqLlmClient({ apiKey: 'gsk_teste', fetch: fetchSpy, ...opts }),
  };
}

async function errorOf(promise: Promise<unknown>): Promise<LlmError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(error instanceof LlmError))
    throw new Error(`esperava LlmError, veio ${String(error)}`);
  return error;
}

describe('GroqLlmClient', () => {
  it('chama chat completions com Bearer e json_schema estrito', async () => {
    const { groq, fetchSpy } = client(ok('{}'));

    await groq.completeJson(request);

    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    if (typeof init?.body !== 'string') throw new Error('corpo não é texto');
    expect(new Headers(init?.headers).get('Authorization')).toBe(
      'Bearer gsk_teste',
    );
    const body: unknown = JSON.parse(init.body);
    expect(body).toMatchObject({
      model: GROQ_DEFAULT_MODEL,
      temperature: 0,
      messages: [
        { role: 'system', content: 'sistema' },
        { role: 'user', content: 'usuário' },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'teste',
          strict: true,
          schema: request.jsonSchema,
        },
      },
    });
  });

  it('devolve o conteúdo da primeira escolha', async () => {
    const { groq } = client(ok(' {"a":1} '));

    await expect(groq.completeJson(request)).resolves.toEqual({
      content: '{"a":1}',
      model: GROQ_DEFAULT_MODEL,
    });
  });

  it('429 vira rate_limited com retry-after em ms', async () => {
    const { groq } = client(
      Response.json(
        { error: { message: 'Rate limit reached', type: 'tokens' } },
        { status: 429, headers: { 'retry-after': '7' } },
      ),
    );

    const error = await errorOf(groq.completeJson(request));

    expect(error.code).toBe('rate_limited');
    expect(error.details.retryAfterMs).toBe(7000);
    expect(error.message).toContain('Rate limit reached');
  });

  it.each([
    [401, 'unauthorized'],
    [400, 'bad_request'],
    [422, 'bad_request'],
    [498, 'unavailable'],
    [503, 'unavailable'],
  ])('%i vira %s', async (status, code) => {
    const { groq } = client(
      Response.json({ error: { message: 'x' } }, { status }),
    );

    expect((await errorOf(groq.completeJson(request))).code).toBe(code);
  });

  it('resposta cortada por tamanho vira empty_output', async () => {
    const { groq } = client(ok('{"a":', 'length'));

    expect((await errorOf(groq.completeJson(request))).code).toBe(
      'empty_output',
    );
  });

  it('resposta sem conteúdo vira empty_output', async () => {
    const { groq } = client(ok(null));

    expect((await errorOf(groq.completeJson(request))).code).toBe(
      'empty_output',
    );
  });

  it('demora acima do timeout vira timeout', async () => {
    const { groq } = client(
      () =>
        new Promise<Response>((_resolve, reject) => {
          setTimeout(() => reject(new DOMException('t', 'TimeoutError')), 50);
        }),
      { timeoutMs: 10 },
    );

    expect((await errorOf(groq.completeJson(request))).code).toBe('timeout');
  });

  it('a mensagem de erro não contém a chave', async () => {
    const { groq } = client(
      Response.json({ error: { message: 'Invalid API Key' } }, { status: 401 }),
    );

    const error = await errorOf(groq.completeJson(request));

    expect(
      JSON.stringify({ m: error.message, d: error.details }),
    ).not.toContain('gsk_teste');
  });
});

describe('parseRetryAfter', () => {
  it.each([
    ['2', 2000],
    ['0.5', 500],
    [null, 10_000],
    ['abc', 10_000],
  ])('%s → %i ms', (value, expected) => {
    expect(parseRetryAfter(value)).toBe(expected);
  });
});
