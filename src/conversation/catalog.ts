import type { RevgasClient } from '../revgas/revgas-client.js';
import type {
  PaymentType,
  PaymentTypeCode,
  Product,
} from '../revgas/revgas.types.js';
import type { PAYMENT_METHODS } from '../llm/extraction.schema.js';

/**
 * PROVISÓRIO até a issue #9 e a pergunta 2 da #1: a API não expõe preço de
 * produto. Para cliente recorrente usamos o valor do último pedido; para os
 * demais, esta tabela por peso. Valores fictícios de demonstração.
 */
export const PROVISIONAL_PRICES_BY_KG: Readonly<Record<number, number>> = {
  8: 95,
  13: 120,
  20: 180,
  45: 420,
};

export interface CatalogProduct extends Product {
  sizeKg: number | null;
  unitValue: number | null;
}

/** Lê o peso da descrição da RevGás, ex.: "GLP 13KG". */
export function sizeKgOf(description: string): number | null {
  const match = /(\d+)\s*KG/i.exec(description);
  return match ? Number(match[1]) : null;
}

export async function loadCatalog(
  revgas: RevgasClient,
): Promise<CatalogProduct[]> {
  const products = await revgas.listProducts();
  return products.map((p) => {
    const sizeKg = sizeKgOf(p.description);
    return {
      ...p,
      sizeKg,
      unitValue:
        sizeKg === null ? null : (PROVISIONAL_PRICES_BY_KG[sizeKg] ?? null),
    };
  });
}

/** Produtos que dá para vender agora: com preço e estoque. */
export function sellable(catalog: CatalogProduct[]): CatalogProduct[] {
  return catalog.filter((p) => p.unitValue !== null && p.stockQuantity > 0);
}

export function findBySize(
  catalog: CatalogProduct[],
  sizeKg: number,
): CatalogProduct | undefined {
  return sellable(catalog).find((p) => p.sizeKg === sizeKg);
}

type PaymentMethod = (typeof PAYMENT_METHODS)[number];

const METHOD_TO_CODES: Readonly<
  Record<PaymentMethod, readonly PaymentTypeCode[]>
> = {
  money: ['MONEY'],
  pix: ['PIX'],
  debit_card: ['CARTAO_DE_DEBITO', 'VISA', 'MASTER', 'ELO'],
  credit_card: ['CARTAO_DE_CREDITO', 'VISA', 'MASTER', 'ELO'],
  vale_gas: ['VALEGAS'],
  other: [],
};

/** Forma dita pelo cliente → código aceito pela revenda, ou null. */
export function matchPayment(
  method: PaymentMethod,
  accepted: PaymentType[],
): PaymentTypeCode | null {
  const codes = METHOD_TO_CODES[method];
  return codes.find((code) => accepted.some((t) => t.code === code)) ?? null;
}

/**
 * Formas oferecidas em botões. PROVISÓRIO até a #10: fiado (crédito de
 * cliente) e vale gás só com autorização, que ainda não verificamos.
 */
export function offeredPayments(accepted: PaymentType[]): PaymentType[] {
  return accepted.filter(
    (t) => t.code !== 'CREDITO_CLIENTE' && t.code !== 'VALEGAS',
  );
}
