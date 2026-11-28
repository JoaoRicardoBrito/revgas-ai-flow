/**
 * Tipos de domínio do acesso à RevGás. O resto da aplicação usa só estes
 * tipos; os nomes e formatos da API (snake_case, paginação, enums) ficam
 * escondidos no client.
 *
 * Referência: https://revgas.stoplight.io/docs/revgas-api
 */

/** Formas de pagamento aceitas pela API (`payment_type`). */
export const PAYMENT_TYPE_CODES = [
  'MONEY',
  'WALLET',
  'BANKDRAFT',
  'FETLOCK',
  'VISA',
  'MASTER',
  'HIPER',
  'CREDISHOP',
  'VALEGAS',
  'ELO',
  'CARTAO_DE_CREDITO',
  'CARTAO_OUTRO',
  'CREDITO_CLIENTE',
  'CARTAO_DE_DEBITO',
  'CARTAO_REVGAS',
  'PIX',
  'TRANSFERENCIA_BANCARIA',
] as const;
export type PaymentTypeCode = (typeof PAYMENT_TYPE_CODES)[number];

/**
 * Status de venda como a API devolve. O significado de cada um ainda não
 * está documentado (pergunta 3 da issue #1); só `OPEN` (criada) e `CANCEL`
 * (cancelada) são usados com segurança.
 */
export const SALE_STATUSES = [
  'CANCEL',
  'OPEN',
  'ACTIVE',
  'WARNING',
  'CONFIRM',
  'CHECK',
] as const;
export type SaleStatus = (typeof SALE_STATUSES)[number];

export interface Address {
  street: string;
  number: string;
  neighborhood: string;
  complement?: string;
  landmark?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  latitude?: string;
  longitude?: string;
}

export interface Customer {
  id: number;
  name: string;
  phones: string[];
  /** A API guarda um único endereço por cliente. */
  address: Address | null;
  lastSaleAt: string | null;
  /** Limite de fiado. 0 = sem fiado. */
  creditLimit: number;
  /** Categoria do cliente na revenda (ex.: "Vale Gás"). */
  category: string | null;
}

export interface NewCustomer {
  name: string;
  phone: string;
  /** Só quando a nota fiscal exigir (ver CPF_REQUIRED). */
  cpf?: string;
  address?: Address;
}

export interface Product {
  id: number;
  description: string;
  stockQuantity: number;
}

export interface PaymentType {
  id: number;
  code: PaymentTypeCode;
  description: string;
}

export interface CancelMotive {
  id: number;
  description: string;
}

export interface SaleItem {
  productId: number;
  description: string;
  quantity: number;
  /** Valor unitário em reais. */
  unitValue: number;
}

export interface SalePayment {
  code: PaymentTypeCode;
  value: number;
}

export interface Sale {
  id: number;
  status: SaleStatus;
  customerId: number | null;
  /** Entregador atribuído: indica que a revenda despachou (suposição, #1). */
  delivererId: number | null;
  /** Preenchido quando a venda foi entregue. */
  deliveredAt: string | null;
  address: Address | null;
  items: SaleItem[];
  payments: SalePayment[];
  total: number;
  observation: string | null;
}

export interface NewSale {
  customerId: number;
  address: Address;
  /**
   * A API não calcula preço: o valor unitário vai na venda (pergunta 2 da
   * issue #1). Quem chama decide o preço.
   */
  items: { productId: number; quantity: number; unitValue: number }[];
  payments: SalePayment[];
  observation?: string;
}
