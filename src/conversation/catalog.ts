import type { RevgasClient } from '../revgas/revgas-client.js';
import type {
  PaymentType,
  PaymentTypeCode,
  Product,
} from '../revgas/revgas.types.js';
import type { PAYMENT_METHODS } from '../llm/extraction.schema.js';
import type { PriceList } from '../config/price-list.js';

export { parsePriceList, type PriceList } from '../config/price-list.js';

/**
 * Só para o modo mock, quando PRODUCT_PRICES está vazio. Valores fictícios.
 * No modo real, sem tabela, nenhum produto fica à venda: o bot não inventa
 * preço numa venda de verdade.
 */
export const DEMO_PRICES_BY_KG: PriceList = {
  8: 95,
  13: 120,
  20: 180,
  45: 420,
};

export interface CatalogProduct extends Product {
  sizeKg: number | null;
  unitValue: number | null;
}

export interface Offer {
  catalog: CatalogProduct[];
  paymentTypes: PaymentType[];
}

/** Lê o peso da descrição da RevGás, ex.: "GLP 13KG". */
export function sizeKgOf(description: string): number | null {
  const match = /(\d+)\s*KG/i.exec(description);
  return match ? Number(match[1]) : null;
}

export interface CatalogOptions {
  prices: PriceList;
  /** Tempo de cache de produtos e formas de pagamento. */
  ttlMs: number;
  now?: () => number;
}

/**
 * Produtos, preços e formas de pagamento da revenda, com cache de poucos
 * minutos (issue #9). O estoque do cache serve para montar opções; antes
 * de confirmar a venda, `freshStock` consulta de novo, sem cache.
 */
export class Catalog {
  private cached: { offer: Offer; at: number } | null = null;
  private loading: Promise<Offer> | null = null;
  private readonly now: () => number;

  constructor(
    private readonly revgas: RevgasClient,
    private readonly options: CatalogOptions,
  ) {
    this.now = options.now ?? (() => Date.now());
  }

  async offer(): Promise<Offer> {
    if (this.cached && this.now() - this.cached.at < this.options.ttlMs) {
      return this.cached.offer;
    }
    // Turnos simultâneos esperam a mesma carga, em vez de repetir chamadas.
    this.loading ??= this.load().finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  /** Estoque atual do produto, direto da API. Atualiza o cache. */
  async freshStock(productId: number): Promise<number> {
    const product = await this.revgas.getProduct(productId);
    const item = this.cached?.offer.catalog.find((p) => p.id === productId);
    if (item) item.stockQuantity = product.stockQuantity;
    return product.stockQuantity;
  }

  /** Esquece o cache (ex.: a venda foi recusada por estoque). */
  invalidate(): void {
    this.cached = null;
  }

  private async load(): Promise<Offer> {
    const products = await this.revgas.listProducts();
    const paymentTypes = await this.revgas.listPaymentTypes();
    const catalog = products.map((p) => {
      const sizeKg = sizeKgOf(p.description);
      return {
        ...p,
        sizeKg,
        unitValue:
          sizeKg === null ? null : (this.options.prices[sizeKg] ?? null),
      };
    });
    const offer = { catalog, paymentTypes };
    this.cached = { offer, at: this.now() };
    return offer;
  }
}

/** Produtos que dá para vender agora: com preço e estoque, do menor ao maior. */
export function sellable(catalog: CatalogProduct[]): CatalogProduct[] {
  return catalog
    .filter((p) => p.unitValue !== null && p.stockQuantity > 0)
    .toSorted((a, b) => (a.sizeKg ?? 0) - (b.sizeKg ?? 0));
}

export function findBySize(
  catalog: CatalogProduct[],
  sizeKg: number,
): CatalogProduct | undefined {
  return sellable(catalog).find((p) => p.sizeKg === sizeKg);
}

/**
 * "Um maior" / "um menor" que o produto atual: o próximo tamanho à venda.
 * `undefined` quando não há referência (ambíguo) ou não existe nessa direção.
 */
export function findRelative(
  catalog: CatalogProduct[],
  currentProductId: number | null,
  direction: 'bigger' | 'smaller',
): { product?: CatalogProduct; reason?: 'no_reference' | 'none_in_direction' } {
  const current = catalog.find((p) => p.id === currentProductId);
  if (current?.sizeKg == null) return { reason: 'no_reference' };
  const options = sellable(catalog).filter((p) => p.sizeKg !== null);
  const currentSize = current.sizeKg;
  const product =
    direction === 'bigger'
      ? options.find((p) => (p.sizeKg ?? 0) > currentSize)
      : options.findLast((p) => (p.sizeKg ?? 0) < currentSize);
  return product ? { product } : { reason: 'none_in_direction' };
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
