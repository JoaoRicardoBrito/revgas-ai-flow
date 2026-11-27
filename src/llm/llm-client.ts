/** Token de injeção do provedor de LLM no Nest. */
export const LLM_CLIENT = Symbol('LLM_CLIENT');

export interface JsonCompletionRequest {
  /** Instruções fixas do sistema. Nunca contém texto do cliente. */
  system: string;
  /** Mensagem do usuário, já com o texto do cliente delimitado. */
  user: string;
  /** Nome e JSON Schema da saída esperada. */
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface JsonCompletion {
  /** Texto devolvido pelo modelo; quem chama valida. */
  content: string;
  model: string;
}

/**
 * Provedor de LLM trocável. Só sabe completar com saída em JSON; não
 * conhece o domínio. Erros saem como `LlmError`.
 */
export interface LlmClient {
  readonly provider: string;
  completeJson(request: JsonCompletionRequest): Promise<JsonCompletion>;
}

export type LlmErrorCode =
  /** 429: limite do plano. `retryAfterMs` diz quando tentar de novo. */
  | 'rate_limited'
  /** Chave ausente ou inválida. */
  | 'unauthorized'
  /** Pedido recusado (inclui JSON fora do schema no modo best-effort). */
  | 'bad_request'
  /** Provedor fora do ar, sobrecarregado ou rede. */
  | 'unavailable'
  | 'timeout'
  /** Resposta sem conteúdo ou cortada por tamanho. */
  | 'empty_output';

export class LlmError extends Error {
  override readonly name = 'LlmError';

  constructor(
    readonly code: LlmErrorCode,
    message: string,
    readonly details: {
      status?: number;
      retryAfterMs?: number;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: details.cause });
  }
}

/** Usado sem GROQ_API_KEY: o fluxo segue só com botões. */
export class DisabledLlmClient implements LlmClient {
  readonly provider = 'disabled';

  completeJson(): Promise<JsonCompletion> {
    return Promise.reject(
      new LlmError('unavailable', 'LLM desligado: GROQ_API_KEY não definida'),
    );
  }
}
