import { z } from 'zod';
import {
  LlmError,
  type JsonCompletion,
  type JsonCompletionRequest,
  type LlmClient,
} from '../llm-client.js';

/**
 * Adaptador do Groq (API compatível com OpenAI).
 * Docs: https://console.groq.com/docs/structured-outputs
 */
export const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
/** Pesos abertos, em produção no Groq e com `json_schema` estrito. */
export const GROQ_DEFAULT_MODEL = 'openai/gpt-oss-20b';

export interface GroqLlmClientOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Teto de tokens da resposta (o gpt-oss também gasta com raciocínio). */
  maxCompletionTokens?: number;
}

const completionResponse = z.object({
  model: z.string().nullish(),
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().nullish() }),
        finish_reason: z.string().nullish(),
      }),
    )
    .min(1),
});

const errorResponse = z.object({
  error: z.object({
    message: z.string().nullish(),
    type: z.string().nullish(),
  }),
});

export class GroqLlmClient implements LlmClient {
  readonly provider = 'groq';
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxCompletionTokens: number;

  constructor(private readonly options: GroqLlmClientOptions) {
    this.model = options.model || GROQ_DEFAULT_MODEL;
    this.baseUrl = (options.baseUrl ?? GROQ_BASE_URL).replace(/\/+$/, '');
    this.fetchFn = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 8000;
    this.maxCompletionTokens = options.maxCompletionTokens ?? 1024;
  }

  async completeJson(request: JsonCompletionRequest): Promise<JsonCompletion> {
    const signal = request.signal
      ? AbortSignal.any([request.signal, AbortSignal.timeout(this.timeoutMs)])
      : AbortSignal.timeout(this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchFn(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.user },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: request.schemaName,
              strict: true,
              schema: request.jsonSchema,
            },
          },
          temperature: 0,
          max_completion_tokens: this.maxCompletionTokens,
        }),
        signal,
      });
    } catch (cause) {
      const isTimeout =
        cause instanceof Error &&
        (cause.name === 'TimeoutError' || cause.name === 'AbortError');
      throw new LlmError(
        isTimeout ? 'timeout' : 'unavailable',
        isTimeout
          ? `Groq não respondeu em ${this.timeoutMs} ms`
          : 'Falha de rede ao chamar o Groq',
        { cause },
      );
    }

    const payload: unknown = await response.json().catch(() => undefined);
    if (!response.ok) throw toError(response, payload);

    const parsed = completionResponse.safeParse(payload);
    const choice = parsed.success ? parsed.data.choices[0] : undefined;
    const content = choice?.message.content?.trim();
    if (!content || choice?.finish_reason === 'length') {
      throw new LlmError(
        'empty_output',
        choice?.finish_reason === 'length'
          ? 'Resposta do Groq cortada por tamanho'
          : 'Resposta do Groq sem conteúdo',
        { status: response.status },
      );
    }
    return {
      content,
      model: (parsed.success && parsed.data.model) || this.model,
    };
  }
}

function toError(response: Response, payload: unknown): LlmError {
  const status = response.status;
  const body = errorResponse.safeParse(payload);
  const detail = body.success ? body.data.error.message : undefined;
  const message = `Groq respondeu ${status}${detail ? `: ${detail}` : ''}`;

  if (status === 429) {
    return new LlmError('rate_limited', message, {
      status,
      retryAfterMs: parseRetryAfter(response.headers.get('retry-after')),
    });
  }
  if (status === 401 || status === 403) {
    return new LlmError('unauthorized', message, { status });
  }
  if (status === 400 || status === 413 || status === 422) {
    return new LlmError('bad_request', message, { status });
  }
  // 498 (sem capacidade), 5xx e o resto: provedor indisponível agora.
  return new LlmError('unavailable', message, { status });
}

/** `retry-after` vem em segundos. Sem header, espera 10 s. */
export function parseRetryAfter(value: string | null): number {
  const seconds = value === null ? Number.NaN : Number(value);
  return Number.isFinite(seconds) && seconds >= 0
    ? Math.ceil(seconds * 1000)
    : 10_000;
}
