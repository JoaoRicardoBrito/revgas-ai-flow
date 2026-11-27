/**
 * Regra do projeto: CPF, endereço e texto do cliente não vão para log.
 * Use `toLogSafe` em qualquer objeto antes de logar.
 */

/** Chaves cujo valor é removido, em qualquer nível do objeto. */
const SENSITIVE_KEYS = new Set(
  [
    'cpf',
    'cnpj',
    'document',
    'address',
    'street',
    'location',
    'number',
    'neighborhood',
    'complement',
    'landmark',
    'postal_code',
    'postalcode',
    'cep',
    'city',
    'state',
    'state_federation',
    'latitude',
    'longitude',
    'lat',
    'lon',
    'body',
    'text',
    'message_body',
    'collected',
    'name',
    'apikey',
    'api_key',
    'authorization',
    'token',
    'password',
  ].map(normalizeKey),
);

const REDACTED = '[removido]';

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z]/g, '');
}

/**
 * Mascara números longos em texto livre: CPF, CNPJ, CEP e telefone, com ou
 * sem pontuação. Qualquer trecho com 8 ou mais dígitos vira um marcador;
 * números curtos (ex.: número da casa, quantidade) ficam.
 */
export function redactText(value: string): string {
  return value.replace(/\+?\(?\d[\d\s()./-]*\d/g, (match) =>
    match.replace(/\D/g, '').length >= 8 ? '[número removido]' : match,
  );
}

/**
 * Cópia do valor pronta para log: remove chaves sensíveis e mascara
 * documentos e telefones em textos. Não altera o original.
 */
export function toLogSafe(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[profundo demais]';
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.map((v) => toLogSafe(v, depth + 1));
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return { name: value.name, message: redactText(value.message) };
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [
        key,
        SENSITIVE_KEYS.has(normalizeKey(key))
          ? REDACTED
          : toLogSafe(v, depth + 1),
      ]),
    );
  }
  return value;
}
