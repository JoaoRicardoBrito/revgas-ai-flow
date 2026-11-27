import type {
  Address,
  CancelMotive,
  Customer,
  NewCustomer,
  NewSale,
  PaymentType,
  Product,
  Sale,
} from './revgas.types.js';

/** Token de injeção do client no Nest. */
export const REVGAS_CLIENT = Symbol('REVGAS_CLIENT');

/**
 * Todo acesso à RevGás passa por aqui. Erros saem como `RevgasError`.
 *
 * O estabelecimento (revenda) é fixado na construção do client; os métodos
 * de produto, forma de pagamento e venda já usam ele.
 */
export interface RevgasClient {
  /** Clientes cujo telefone bate com o informado (com ou sem 55). */
  findCustomersByPhone(phone: string): Promise<Customer[]>;
  getCustomer(id: number): Promise<Customer>;
  createCustomer(input: NewCustomer): Promise<Customer>;
  /** Troca o endereço salvo, preservando os demais dados do cadastro. */
  updateCustomerAddress(id: number, address: Address): Promise<Customer>;

  /** Produtos ativos da revenda, com estoque atual. */
  listProducts(): Promise<Product[]>;
  /** Um produto com o estoque do momento, para checar antes de vender. */
  getProduct(id: number): Promise<Product>;

  /** Formas de pagamento ativas na revenda. */
  listPaymentTypes(): Promise<PaymentType[]>;

  /** Venda mais recente do cliente nos últimos 12 meses, ou `null`. */
  findLastSale(customerId: number): Promise<Sale | null>;
  /** Até `limit` vendas do cliente nos últimos 12 meses, mais nova primeiro. */
  listRecentSales(customerId: number, limit: number): Promise<Sale[]>;
  getSale(id: number): Promise<Sale>;
  /** Cria a venda com canal WhatsApp e origem integração. */
  createSale(input: NewSale): Promise<Sale>;
  updateSale(id: number, input: NewSale): Promise<Sale>;
  cancelSale(id: number, motiveId: number): Promise<Sale>;
  listCancelMotives(): Promise<CancelMotive[]>;
}
