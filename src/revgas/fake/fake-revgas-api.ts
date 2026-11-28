/**
 * Fake em memória da API da RevGás, no nível HTTP: recebe as mesmas
 * requisições que a API real (rotas, query, corpo, header Authorization) e
 * responde com os mesmos campos, paginação e corpos de erro da documentação
 * (https://revgas.stoplight.io/docs/revgas-api).
 *
 * Comportamentos que a documentação não descreve estão marcados com
 * "SUPOSIÇÃO" e ligados às perguntas da issue #1.
 */
import type { PaymentTypeCode, SaleStatus } from '../revgas.types.js';
import { createSeed, FAKE_ESTABLISHMENT_ID, type FakeSeed } from './seed.js';

export { FAKE_ESTABLISHMENT_ID };
export const FAKE_API_KEY = 'fake-api-key';
export const FAKE_BASE_URL = 'https://fake.revgas.local/v1';

export interface FakeCustomer {
  id: number;
  created_at: string;
  updated_at: string;
  name: string;
  cpf: string | null;
  type: 'PHYSICAL' | 'JURIDICAL';
  phones: string[];
  location: string | null;
  number: string | null;
  neighborhood: string | null;
  complement: string | null;
  landmark: string | null;
  postal_code: string | null;
  city: string | null;
  state_federation: string | null;
  latitude: string | null;
  longitude: string | null;
  last_sale: string | null;
  credit_limit: string | null;
  /** Derivada da categoria (tag_id); só leitura. */
  tag_description: string | null;
}

export interface FakeProduct {
  id: number;
  description: string;
  stock_quantity: number;
  establishment_id: number;
  inactive: boolean;
}

export interface FakePaymentType {
  id: number;
  payment_type: PaymentTypeCode;
  payment_type_description: string;
  status: 'ACTIVE' | 'INACTIVE';
  establishment_id: number;
}

export interface FakeSale {
  id: number;
  status: SaleStatus;
  total: number;
  deliverer_id: number | null;
  deliverer_name: string | null;
  delivered_at: string | null;
  /** Motivo recebido em PUT /sales/{id}/cancel. */
  cancel_motive_id: number | null;
  channel: string;
  origin: string;
  customer_id: number | null;
  customer_name: string | null;
  establishment_id: number;
  location: string | null;
  number: string | null;
  neighborhood: string | null;
  complement: string | null;
  landmark: string | null;
  city: string | null;
  state_federation: string | null;
  lat: string | null;
  lon: string | null;
  observation: string | null;
  products: {
    id: number;
    product_id: number;
    product_description: string;
    quantity: number;
    value: number;
    discount: number;
  }[];
  payments: { id: number; type: PaymentTypeCode; value: number }[];
  logs: {
    id: number;
    sale_id: number;
    status: SaleStatus;
    created_at: string;
  }[];
  created_at: string;
}

export interface FakeCancelMotive {
  id: number;
  description: string;
  status: boolean;
}

export interface FakeRevgasApiOptions {
  apiKey?: string;
  /** Latência artificial por requisição. */
  latencyMs?: number;
  /**
   * SUPOSIÇÃO (pergunta 5 da #1): a API recusa venda sem estoque com 422.
   * Desligue para simular uma API que aceita e deixa o estoque negativo.
   */
  rejectSaleWithoutStock?: boolean;
  /** Aplica o limite documentado de 1 requisição por segundo (429). */
  enforceRateLimit?: boolean;
  now?: () => Date;
  seed?: FakeSeed;
}

interface Route {
  method: string;
  pattern: RegExp;
  handle: (ctx: RequestContext) => Response | Promise<Response>;
}

interface RequestContext {
  params: string[];
  query: URLSearchParams;
  body: Record<string, unknown>;
}

export class FakeRevgasApi {
  customers: FakeCustomer[];
  products: FakeProduct[];
  paymentTypes: FakePaymentType[];
  sales: FakeSale[];
  cancelMotives: FakeCancelMotive[];

  /** Todas as requisições recebidas, para inspecionar em testes. */
  readonly requests: {
    method: string;
    path: string;
    query: Record<string, string>;
    body: unknown;
  }[] = [];

  private readonly options: Required<Omit<FakeRevgasApiOptions, 'seed'>>;
  private readonly routes: Route[];
  private nextId = 1000;
  private pendingFailures: {
    status: number;
    only: { method?: string; path?: string } | undefined;
  }[] = [];
  private declineNextPayments = 0;
  private lastRequestAt = Number.NEGATIVE_INFINITY;

  constructor(options: FakeRevgasApiOptions = {}) {
    this.options = {
      apiKey: options.apiKey ?? FAKE_API_KEY,
      latencyMs: options.latencyMs ?? 0,
      rejectSaleWithoutStock: options.rejectSaleWithoutStock ?? true,
      enforceRateLimit: options.enforceRateLimit ?? false,
      now: options.now ?? (() => new Date()),
    };
    const seed = options.seed ?? createSeed(this.options.now());
    this.customers = seed.customers;
    this.products = seed.products;
    this.paymentTypes = seed.paymentTypes;
    this.sales = seed.sales;
    this.cancelMotives = seed.cancelMotives;
    this.routes = this.buildRoutes();
  }

  // ---- Controles de simulação --------------------------------------------

  set latencyMs(ms: number) {
    this.options.latencyMs = ms;
  }

  /**
   * As próximas `count` requisições falham com `status` (padrão 500). Com
   * `only`, só as que batem com o método e o caminho (ex.: POST /sales).
   */
  failNext(
    count = 1,
    status = 500,
    only?: { method?: string; path?: string },
  ): void {
    for (let i = 0; i < count; i++) this.pendingFailures.push({ status, only });
  }

  /** As próximas `count` vendas criadas têm o pagamento recusado. */
  declinePayment(count = 1): void {
    this.declineNextPayments += count;
  }

  setStock(productId: number, quantity: number): void {
    this.product(productId).stock_quantity = quantity;
  }

  /** A revenda despachou: entregador atribuído (SUPOSIÇÃO, pergunta 3 da #1). */
  dispatchSale(saleId: number): void {
    const sale = this.saleById(saleId);
    sale.deliverer_id = 7;
    sale.deliverer_name = 'Entregador Exemplo';
  }

  /** O entregador entregou. */
  deliverSale(saleId: number): void {
    const sale = this.saleById(saleId);
    this.dispatchSale(saleId);
    sale.delivered_at = this.options.now().toISOString();
  }

  private saleById(saleId: number): FakeSale {
    const sale = this.sales.find((s) => s.id === saleId);
    if (!sale) throw new Error(`Venda ${saleId} não existe no fake`);
    return sale;
  }

  /** Simula a revenda mudando o status (ex.: despacho, conferência). */
  setSaleStatus(saleId: number, status: SaleStatus): void {
    const sale = this.sales.find((s) => s.id === saleId);
    if (!sale) throw new Error(`Venda ${saleId} não existe no fake`);
    this.setStatus(sale, status);
  }

  // ---- Entrada HTTP -------------------------------------------------------

  /** Compatível com `fetch`: injete no `HttpRevgasClient`. */
  readonly fetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/v1/, '');
    const raw = request.body ? await request.text() : '';
    const body = parseBody(raw);
    this.requests.push({
      method: request.method,
      path,
      query: Object.fromEntries(url.searchParams),
      body,
    });

    await abortableDelay(this.options.latencyMs, request.signal);

    const failureIndex = this.pendingFailures.findIndex(
      ({ only }) =>
        (!only?.method || only.method === request.method) &&
        (!only?.path || only.path === path),
    );
    if (failureIndex >= 0) {
      const [failure] = this.pendingFailures.splice(failureIndex, 1);
      if (failure) return standardError(failure.status);
    }

    if (this.options.enforceRateLimit) {
      const now = Date.now();
      const tooSoon = now - this.lastRequestAt < 1000;
      this.lastRequestAt = now;
      if (tooSoon) return standardError(429);
    }

    const auth = request.headers.get('Authorization');
    if (!auth) return standardError(401);
    if (auth !== this.options.apiKey) return standardError(401);

    for (const route of this.routes) {
      if (route.method !== request.method) continue;
      const match = route.pattern.exec(path);
      if (!match) continue;
      return route.handle({
        params: match.slice(1),
        query: url.searchParams,
        body: body ?? {},
      });
    }
    return json(404, { message: 'not found' });
  };

  // ---- Rotas --------------------------------------------------------------

  private buildRoutes(): Route[] {
    const id = '(\\d+)';
    return [
      {
        method: 'GET',
        pattern: /^\/customers$/,
        handle: (c) => this.listCustomers(c),
      },
      {
        method: 'POST',
        pattern: /^\/customers$/,
        handle: (c) => this.createCustomer(c),
      },
      {
        method: 'GET',
        pattern: new RegExp(`^/customers/${id}$`),
        handle: (c) => this.getCustomer(c),
      },
      {
        method: 'PUT',
        pattern: new RegExp(`^/customers/${id}$`),
        handle: (c) => this.updateCustomer(c),
      },
      {
        method: 'GET',
        pattern: /^\/products$/,
        handle: (c) => this.listProducts(c),
      },
      {
        method: 'GET',
        pattern: new RegExp(`^/products/${id}$`),
        handle: (c) => this.getProduct(c),
      },
      {
        method: 'GET',
        pattern: /^\/payment-types$/,
        handle: (c) => this.listPaymentTypes(c),
      },
      {
        method: 'GET',
        pattern: /^\/motive-cancel-sale$/,
        handle: (c) => this.listCancelMotives(c),
      },
      { method: 'GET', pattern: /^\/sales$/, handle: (c) => this.listSales(c) },
      {
        method: 'POST',
        pattern: /^\/sales$/,
        handle: (c) => this.createSale(c),
      },
      {
        method: 'GET',
        pattern: new RegExp(`^/sales/${id}$`),
        handle: (c) => this.getSale(c),
      },
      {
        method: 'PUT',
        pattern: new RegExp(`^/sales/${id}$`),
        handle: (c) => this.updateSale(c),
      },
      {
        method: 'PUT',
        pattern: new RegExp(`^/sales/${id}/cancel$`),
        handle: (c) => this.cancelSale(c),
      },
    ];
  }

  private listCustomers({ query }: RequestContext): Response {
    const phone = query.get('phone');
    if (phone !== null && !PHONE_PATTERN.test(phone)) {
      return validation([{ field: 'phone', message: 'invalid phone' }]);
    }
    let items = this.customers;
    if (phone) {
      const wanted = nationalPhone(phone);
      items = items.filter((c) =>
        c.phones.some((p) => nationalPhone(p) === wanted),
      );
    }
    const name = query.get('name');
    if (name) {
      items = items.filter((c) =>
        c.name.toLowerCase().includes(name.toLowerCase()),
      );
    }
    return paginate(items, query);
  }

  private getCustomer({ params }: RequestContext): Response {
    const customer = this.customers.find((c) => c.id === Number(params[0]));
    return customer ? json(200, customer) : notFound();
  }

  private createCustomer({ body }: RequestContext): Response {
    const errors = validateCustomer(body);
    if (errors.length) return validation(errors);
    const now = this.options.now().toISOString();
    const customer: FakeCustomer = {
      id: this.newId(),
      created_at: now,
      updated_at: now,
      last_sale: null,
      tag_description: null,
      ...customerFields(body),
    };
    this.customers.push(customer);
    return json(201, customer);
  }

  private updateCustomer({ params, body }: RequestContext): Response {
    const customer = this.customers.find((c) => c.id === Number(params[0]));
    if (!customer) return notFound();
    const errors = validateCustomer(body);
    if (errors.length) return validation(errors);
    Object.assign(customer, customerFields(body), {
      updated_at: this.options.now().toISOString(),
    });
    return json(200, customer);
  }

  private listProducts({ query }: RequestContext): Response {
    const establishment = query.get('establishment_id');
    const inactive = query.get('inactive') === 'true';
    const description = query.get('description');
    const items = this.products.filter(
      (p) =>
        (!establishment || p.establishment_id === Number(establishment)) &&
        p.inactive === inactive &&
        (!description ||
          p.description.toLowerCase().includes(description.toLowerCase())),
    );
    return paginate(items.map(productView), query);
  }

  private getProduct({ params }: RequestContext): Response {
    const product = this.products.find((p) => p.id === Number(params[0]));
    return product ? json(200, productView(product)) : notFound();
  }

  private listPaymentTypes({ query }: RequestContext): Response {
    const establishment = query.get('establishment_id');
    if (!establishment) {
      return validation([
        { field: 'establishment_id', message: 'establishment_id is required' },
      ]);
    }
    const status = query.get('status');
    const items = this.paymentTypes.filter(
      (p) =>
        p.establishment_id === Number(establishment) &&
        (!status || p.status === status),
    );
    return paginate(
      items.map(({ establishment_id: _e, ...rest }) => rest),
      query,
    );
  }

  private listCancelMotives({ query }: RequestContext): Response {
    const status = query.get('status');
    const items = this.cancelMotives.filter(
      (m) => status === null || String(m.status) === status,
    );
    return paginate(items, query);
  }

  private listSales({ query }: RequestContext): Response {
    const today = this.options.now();
    const from = query.get('from') ?? isoDate(firstDayOfMonth(today));
    const to = query.get('to') ?? isoDate(lastDayOfMonth(today));
    const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
    if (days > 366) {
      return validation([
        {
          field: 'fromAndToDifferenteMaxOneYear',
          message: 'from and to differente must be less than one year',
        },
      ]);
    }
    const customerId = query.get('customer_id');
    const establishment = query.get('establishment_id');
    const items = this.sales
      .filter((s) => {
        const day = s.created_at.slice(0, 10);
        return (
          day >= from &&
          day <= to &&
          (!customerId || s.customer_id === Number(customerId)) &&
          (!establishment || s.establishment_id === Number(establishment))
        );
      })
      // Documentado: ordenadas decrescentemente pela data de criação.
      .toSorted((a, b) => b.created_at.localeCompare(a.created_at));
    return paginate(items.map(saleView), query);
  }

  private getSale({ params }: RequestContext): Response {
    const sale = this.sales.find((s) => s.id === Number(params[0]));
    return sale ? json(200, saleView(sale)) : notFound();
  }

  private createSale({ body }: RequestContext): Response {
    const result = this.buildSaleItems(body);
    if ('error' in result) return result.error;

    if (this.declineNextPayments > 0) {
      // SUPOSIÇÃO (pergunta 4 da #1): a API não processa pagamento. Esta
      // recusa só existe no fake, para exercitar o caminho do PRD 6.8.
      this.declineNextPayments--;
      return validation([{ field: 'payments', message: 'payment declined' }]);
    }

    const now = this.options.now().toISOString();
    const saleId = this.newId();
    const customer = this.customers.find((c) => c.id === result.customerId);
    const sale: FakeSale = {
      id: saleId,
      // `option: NORMAL` cria a venda aberta; INDOOR/OUTDOOR confirmam sozinhas.
      status:
        body.option === 'INDOOR' || body.option === 'OUTDOOR'
          ? 'CONFIRM'
          : 'OPEN',
      total: result.total,
      channel: str(body.channel) ?? 'DISK',
      origin: str(body.origin) ?? 'REVGAS',
      customer_id: result.customerId,
      customer_name: customer?.name ?? null,
      deliverer_id: null,
      deliverer_name: null,
      delivered_at: null,
      cancel_motive_id: null,
      establishment_id: Number(body.establishment_id ?? FAKE_ESTABLISHMENT_ID),
      ...saleAddress(body),
      observation: str(body.observation),
      products: result.items,
      payments: result.payments,
      logs: [
        { id: this.newId(), sale_id: saleId, status: 'OPEN', created_at: now },
      ],
      created_at: now,
    };
    this.sales.push(sale);
    // SUPOSIÇÃO: a venda baixa o estoque na criação.
    for (const item of sale.products) {
      this.product(item.product_id).stock_quantity -= item.quantity;
    }
    if (customer) customer.last_sale = now;
    return json(201, saleView(sale));
  }

  private updateSale({ params, body }: RequestContext): Response {
    const sale = this.sales.find((s) => s.id === Number(params[0]));
    if (!sale) return notFound();
    // SUPOSIÇÃO (pergunta 1 da #1): só altera antes de confirmar/conferir.
    if (!['OPEN', 'ACTIVE', 'WARNING'].includes(sale.status)) {
      return json(400, {
        message: `sale with status ${sale.status} cannot be changed`,
      });
    }
    for (const item of sale.products) {
      this.product(item.product_id).stock_quantity += item.quantity;
    }
    const result = this.buildSaleItems(body);
    if ('error' in result) {
      for (const item of sale.products) {
        this.product(item.product_id).stock_quantity -= item.quantity;
      }
      return result.error;
    }
    Object.assign(sale, saleAddress(body), {
      customer_id: result.customerId,
      observation: str(body.observation),
      products: result.items,
      payments: result.payments,
      total: result.total,
    });
    for (const item of sale.products) {
      this.product(item.product_id).stock_quantity -= item.quantity;
    }
    return json(200, saleView(sale));
  }

  private cancelSale({ params, body }: RequestContext): Response {
    const sale = this.sales.find((s) => s.id === Number(params[0]));
    if (!sale) return notFound();
    const motive = this.cancelMotives.find(
      (m) => m.id === Number(body.motive_cancel_sale_id),
    );
    if (!motive) {
      return validation([
        { field: 'motive_cancel_sale_id', message: 'invalid motive' },
      ]);
    }
    // SUPOSIÇÃO (pergunta 1 da #1): venda cancelada, conferida ou já
    // entregue não cancela.
    if (
      sale.status === 'CANCEL' ||
      sale.status === 'CHECK' ||
      sale.delivered_at !== null
    ) {
      return json(400, {
        message: `sale with status ${sale.status} cannot be canceled`,
      });
    }
    sale.cancel_motive_id = motive.id;
    this.setStatus(sale, 'CANCEL');
    for (const item of sale.products) {
      this.product(item.product_id).stock_quantity += item.quantity;
    }
    return json(200, saleView(sale));
  }

  // ---- Apoio --------------------------------------------------------------

  private buildSaleItems(body: Record<string, unknown>):
    | { error: Response }
    | {
        customerId: number | null;
        items: FakeSale['products'];
        payments: FakeSale['payments'];
        total: number;
      } {
    const errors: FieldError[] = [];
    const customerId =
      body.customer_id == null ? null : Number(body.customer_id);
    if (
      customerId !== null &&
      !this.customers.some((c) => c.id === customerId)
    ) {
      errors.push({ field: 'customer_id', message: 'customer not found' });
    }

    const rawProducts = Array.isArray(body.products)
      ? (body.products as unknown[])
      : [];
    if (rawProducts.length === 0) {
      errors.push({ field: 'products', message: 'products is required' });
    }
    const items: FakeSale['products'] = [];
    rawProducts.forEach((raw, index) => {
      const p = isRecord(raw) ? raw : {};
      const product = this.products.find((x) => x.id === Number(p.product_id));
      const quantity = Number(p.quantity);
      const value = Number(p.value);
      if (!product) {
        errors.push({
          field: `products[${index}].product_id`,
          message: 'product not found',
        });
        return;
      }
      if (!Number.isInteger(quantity) || quantity <= 0) {
        errors.push({
          field: `products[${index}].quantity`,
          message: 'invalid quantity',
        });
        return;
      }
      if (!Number.isFinite(value) || value < 0) {
        errors.push({
          field: `products[${index}].value`,
          message: 'invalid value',
        });
        return;
      }
      if (
        this.options.rejectSaleWithoutStock &&
        product.stock_quantity < quantity
      ) {
        errors.push({
          field: `products[${index}].quantity`,
          message: 'insufficient stock',
        });
        return;
      }
      items.push({
        id: this.newId(),
        product_id: product.id,
        product_description: product.description,
        quantity,
        value,
        discount: 0,
      });
    });

    const rawPayments = Array.isArray(body.payments)
      ? (body.payments as unknown[])
      : [];
    const payments: FakeSale['payments'] = [];
    rawPayments.forEach((raw, index) => {
      const p = isRecord(raw) ? raw : {};
      const type = this.paymentTypes.find(
        (t) => t.payment_type === p.payment_type && t.status === 'ACTIVE',
      )?.payment_type;
      if (!type) {
        errors.push({
          field: `payments[${index}].payment_type`,
          message: 'invalid payment type',
        });
        return;
      }
      payments.push({
        id: this.newId(),
        type,
        value: Number(p.value),
      });
    });

    if (errors.length) return { error: validation(errors) };
    const total = round2(
      items.reduce((sum, i) => sum + i.quantity * i.value, 0),
    );
    return { customerId, items, payments, total };
  }

  private setStatus(sale: FakeSale, status: SaleStatus): void {
    sale.status = status;
    sale.logs.push({
      id: this.newId(),
      sale_id: sale.id,
      status,
      created_at: this.options.now().toISOString(),
    });
  }

  private product(id: number): FakeProduct {
    const product = this.products.find((p) => p.id === id);
    if (!product) throw new Error(`Produto ${id} não existe no fake`);
    return product;
  }

  private newId(): number {
    return this.nextId++;
  }
}

// ---- Funções puras --------------------------------------------------------

interface FieldError {
  field: string;
  message: string;
}

/** Padrão de telefone documentado em `GET /customers?phone=`. */
const PHONE_PATTERN = /^(((\+)?(5{2})(\d{10,11}))|(\d{10,11}))$/;

function nationalPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 12 && digits.startsWith('55')
    ? digits.slice(2)
    : digits;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const notFound = () => json(404, { message: 'not found' });

function validation(data: FieldError[]): Response {
  return json(422, { data, message: 'Request error' });
}

/** Corpos dos erros padrão, como na página "Respostas padrões". */
function standardError(status: number): Response {
  const messages: Record<number, string> = {
    400: 'descrição do erro',
    401: 'unauthorized user',
    402: 'Blocked user',
    403: 'User does not have access to this resource',
    409: 'cannot modify object due to lock, try again',
    429: 'too many requests',
    500: 'internal server error',
  };
  return json(status, { message: messages[status] ?? 'error' });
}

function paginate(items: unknown[], query: URLSearchParams): Response {
  const page = Math.max(1, Number(query.get('page') ?? 1) || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, Number(query.get('page_size') ?? 10) || 10),
  );
  const data = items.slice((page - 1) * pageSize, page * pageSize);
  return json(200, {
    data,
    pagination: {
      page,
      page_size: pageSize,
      count: data.length,
      total_count: items.length,
      has_next: page * pageSize < items.length,
    },
  });
}

function productView(p: FakeProduct) {
  const { inactive: _inactive, ...rest } = p;
  return { ...rest, lent_quantity: 0, transit_quantity: 0 };
}

function saleView(s: FakeSale) {
  const { origin: _origin, created_at: _created, ...rest } = s;
  return rest;
}

function validateCustomer(body: Record<string, unknown>): FieldError[] {
  const errors: FieldError[] = [];
  if (!str(body.name))
    errors.push({ field: 'name', message: 'name is required' });
  const phones = Array.isArray(body.phones) ? body.phones : [];
  phones.forEach((p, i) => {
    if (typeof p !== 'string' || !PHONE_PATTERN.test(p)) {
      errors.push({ field: `phones[${i}]`, message: 'invalid phone' });
    }
  });
  // Documentado: CPF com 11 dígitos (ex.: "00000000000").
  if (
    body.cpf != null &&
    !(typeof body.cpf === 'string' && /^\d{11}$/.test(body.cpf))
  ) {
    errors.push({ field: 'cpf', message: 'invalid cpf' });
  }
  return errors;
}

function customerFields(body: Record<string, unknown>) {
  return {
    name: str(body.name) ?? '',
    cpf: str(body.cpf),
    credit_limit: str(body.credit_limit),
    type:
      body.type === 'JURIDICAL'
        ? ('JURIDICAL' as const)
        : ('PHYSICAL' as const),
    phones: Array.isArray(body.phones) ? body.phones.map(String) : [],
    location: str(body.location),
    number: str(body.number),
    neighborhood: str(body.neighborhood),
    complement: str(body.complement),
    landmark: str(body.landmark),
    postal_code: str(body.postal_code),
    city: str(body.city),
    state_federation: str(body.state_federation),
    latitude: str(body.latitude),
    longitude: str(body.longitude),
  };
}

function saleAddress(body: Record<string, unknown>) {
  return {
    location: str(body.location),
    number: str(body.number),
    neighborhood: str(body.neighborhood),
    complement: str(body.complement),
    landmark: str(body.landmark),
    city: str(body.city),
    state_federation: str(body.state_federation),
    lat: str(body.lat),
    lon: str(body.lon),
  };
}

function str(value: unknown): string | null {
  if (typeof value === 'string') return value === '' ? null : value;
  if (typeof value === 'number') return String(value);
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseBody(raw: string): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const firstDayOfMonth = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
const lastDayOfMonth = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(signal.reason);
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
