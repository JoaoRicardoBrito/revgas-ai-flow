/**
 * CPF lido pelo código (não pelo LLM): só dígitos, com verificação dos
 * dígitos verificadores.
 */

export function isValidCpf(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  if (!/^\d{11}$/.test(digits) || /^(\d)\1{10}$/.test(digits)) return false;
  const check = (length: number) => {
    let sum = 0;
    for (let i = 0; i < length; i++) {
      sum += Number(digits[i]) * (length + 1 - i);
    }
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return check(9) === Number(digits[9]) && check(10) === Number(digits[10]);
}

/**
 * Primeiro CPF válido no texto, só com dígitos, ou `null`. Aceita com ou
 * sem pontuação ("123.456.789-09" ou "12345678909").
 */
export function findCpf(text: string): string | null {
  for (const match of text.matchAll(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/g)) {
    const digits = match[0].replace(/\D/g, '');
    if (isValidCpf(digits)) return digits;
  }
  return null;
}

/** Para mostrar ao cliente: só os dois últimos dígitos. */
export function maskCpf(cpf: string): string {
  return `***.***.***-${cpf.replace(/\D/g, '').slice(-2)}`;
}
