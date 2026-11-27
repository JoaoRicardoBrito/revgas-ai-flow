/**
 * Preço por peso do botijão, em reais. A API da RevGás não expõe preço de
 * produto (pergunta 2 da issue #1): a revenda configura em PRODUCT_PRICES.
 */
export type PriceList = Readonly<Record<number, number>>;

/**
 * Lê "P13:120,P20:180.50" (ou "13:120"). Decimal com ponto: a vírgula
 * separa itens. Formato inválido lança erro.
 */
export function parsePriceList(value: string): PriceList {
  const prices: Record<number, number> = {};
  const parts = value
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  for (const part of parts) {
    const match = /^P?(\d{1,2})\s*[:=]\s*(\d+(?:\.\d{1,2})?)$/i.exec(part);
    if (!match?.[1] || !match[2]) {
      throw new Error(
        `PRODUCT_PRICES inválido em "${part}". Use P13:120,P20:180`,
      );
    }
    prices[Number(match[1])] = Number(match[2]);
  }
  return prices;
}

export function isValidPriceList(value: string): boolean {
  try {
    parsePriceList(value);
    return true;
  } catch {
    return false;
  }
}
