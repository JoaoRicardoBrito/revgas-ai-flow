import type { RevgasClient } from '../revgas/revgas-client.js';
import type {
  PaymentType,
  PaymentTypeCode,
  Product,
} from '../revgas/revgas.types.js';
import type { PAYMENT_METHODS } from '../llm/extraction.schema.js';
import type { PriceList } from '../config/price-list.js';
import type { Coverage } from './coverage.js';

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
  /** Área de entrega da revenda (issue #11). Sem regras: tudo atendido. */
  coverage?: Coverage;
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

/** Formas que só clientes autorizados pela revenda veem (PRD 6.2). */
export const RESTRICTED_PAYMENTS: readonly PaymentTypeCode[] = [
  'CREDITO_CLIENTE',
  'VALEGAS',
];

/** Ordem padrão: dinheiro, Pix e cartão na entrega primeiro (issue #10). */
const DEFAULT_ORDER: readonly PaymentTypeCode[] = [
  'MONEY',
  'PIX',
  'CARTAO_DE_DEBITO',
  'CARTAO_DE_CREDITO',
];

/** Cobrança antes da entrega: fora do protótipo (PRD seção 3). */
const NOT_ON_DELIVERY: readonly PaymentTypeCode[] = [
  'FETLOCK',
  'TRANSFERENCIA_BANCARIA',
  'BANKDRAFT',
];

export interface PaymentChoice {
  /** Formas restritas liberadas para este cliente. */
  authorized?: readonly PaymentTypeCode[];
  /** Recusadas nesta conversa. */
  exclude?: readonly PaymentTypeCode[];
  /** Vem primeiro (a do último pedido). */
  preferred?: PaymentTypeCode | null;
}

/**
 * Formas oferecidas ao cliente, só as cadastradas e ativas na revenda: sem
 * fiado nem vale gás para quem não é autorizado, sem as recusadas nesta
 * conversa e sem cobrança antecipada. A do último pedido vem primeiro.
 */
export function offeredPayments(
  accepted: PaymentType[],
  choice: PaymentChoice = {},
): PaymentType[] {
  const rank = (code: PaymentTypeCode) => {
    if (code === choice.preferred) return -1;
    const index = DEFAULT_ORDER.indexOf(code);
    return index === -1 ? DEFAULT_ORDER.length : index;
  };
  return accepted
    .filter(
      (t) =>
        !NOT_ON_DELIVERY.includes(t.code) &&
        !(choice.exclude ?? []).includes(t.code) &&
        (!RESTRICTED_PAYMENTS.includes(t.code) ||
          (choice.authorized ?? []).includes(t.code)),
    )
    .toSorted((a, b) => rank(a.code) - rank(b.code));
}

/**
 * Quem pode usar fiado e vale gás. SUPOSIÇÃO até a RevGás confirmar
 * (issue #1): fiado exige limite de crédito no cadastro; vale gás exige
 * categoria do cliente com "vale gás" no nome. Cliente novo não tem nenhum.
 */
export function authorizedPaymentsFor(customer: {
  creditLimit: number;
  category: string | null;
}): PaymentTypeCode[] {
  const codes: PaymentTypeCode[] = [];
  if (customer.creditLimit > 0) codes.push('CREDITO_CLIENTE');
  const category = (customer.category ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
  if (category.includes('vale gas')) codes.push('VALEGAS');
  return codes;
}
