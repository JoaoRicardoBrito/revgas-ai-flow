export type RevgasErrorCode =
  /** 400: requisição inválida. */
  | 'bad_request'
  /** 401: chave ausente ou inválida. */
  | 'unauthorized'
  /** 402: chave bloqueada por falta de pagamento da assinatura. */
  | 'blocked'
  /** 403: a chave não tem acesso ao recurso. */
  | 'forbidden'
  | 'not_found'
  /** 409: registro duplicado ou lock no banco. */
  | 'conflict'
  /** 422: campos inválidos (ver `fields`). */
  | 'validation'
  /** 422 cujo campo indica falta de estoque. */
  | 'out_of_stock'
  /** 422 cujo campo indica pagamento recusado. */
  | 'payment_declined'
  /** 429: mais de 1 requisição por segundo. */
  | 'rate_limited'
  | 'server'
  | 'network'
  | 'timeout'
  | 'invalid_response';

export interface RevgasFieldError {
  field: string;
  message: string;
}

/**
 * Único tipo de erro que sai do client. Nunca carrega a chave nem o corpo
 * inteiro da requisição, para poder ir para log.
 */
export class RevgasError extends Error {
  override readonly name = 'RevgasError';

  constructor(
    readonly code: RevgasErrorCode,
    message: string,
    readonly details: {
      status?: number;
      fields?: RevgasFieldError[];
      /** Em 409 de duplicidade, o ID do registro que já existe. */
      duplicateId?: string;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: details.cause });
  }

  /** Quando é seguro repetir a mesma chamada sem risco de duplicar efeito. */
  get retryable(): boolean {
    return this.code === 'rate_limited';
  }
}
