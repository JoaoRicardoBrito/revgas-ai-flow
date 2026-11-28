import type { z } from 'zod';
import type { RevgasClient } from '../revgas-client.js';
import { RevgasError, type RevgasErrorCode } from '../revgas.errors.js';
import type {
  Address,
  CancelMotive,
  Customer,
  NewCustomer,
  NewSale,
  PaymentType,
  Product,
  Sale,
} from '../revgas.types.js';
import {
  cancelMotiveDto,
  customerDto,
  errorBody,
  pageOf,
  paymentTypeDto,
  productDto,
  saleDto,
  type CustomerDto,
  type SaleDto,
} from './revgas-api.schemas.js';

export interface HttpRevgasClientOptions {
  baseUrl: string;
  apiKey: string;
  establishmentId: number;
  /** Trocado no modo mock pelo fake da API. */
  fetch?: typeof fetch;
  /** A API aceita 1 requisição por segundo. */
  minIntervalMs?: number;
  timeoutMs?: number;
  /** Tentativas extras após 429. */
  maxRateLimitRetries?: number;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

type Method = 'GET' | 'POST' | 'PUT';
type Query = Record<string, string | number | boolean | undefined>;

const PAGE_SIZE_MAX = 100;
const MAX_PAGES = 50;
/** A API recusa intervalos acima de 366 dias; ficamos em 365. */
const SALES_LOOKBACK_DAYS = 365;

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export class HttpRevgasClient implements RevgasClient {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly minIntervalMs: number;
  private readonly timeoutMs: number;
  private readonly maxRateLimitRetries: number;
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();
  private lastRequestAt = 0;

  constructor(private readonly options: HttpRevgasClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.fetchFn = options.fetch ?? fetch;
    this.minIntervalMs = options.minIntervalMs ?? 1000;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxRateLimitRetries = options.maxRateLimitRetries ?? 2;
    this.now = options.now ?? (() => new Date());
    this.sleep = options.sleep ?? defaultSleep;
  }

  // ---- Clientes -----------------------------------------------------------

  async findCustomersByPhone(phone: string): Promise<Customer[]> {
    const normalized = normalizePhone(phone);
    if (!normalized) return [];
    const page = await this.request('GET', '/customers', pageOf(customerDto), {
      query: { phone: normalized, page_size: 10 },
    });
    return page.data.map(toCustomer);
  }

  async getCustomer(id: number): Promise<Customer> {
    return toCustomer(
      await this.request('GET', `/customers/${id}`, customerDto),
    );
  }

  async createCustomer(input: NewCustomer): Promise<Customer> {
    const phone = normalizePhone(input.phone);
    if (!phone) {
      throw new RevgasError('validation', 'Telefone inválido', {
        fields: [{ field: 'phones', message: 'telefone inválido' }],
      });
    }
    const body = {
      name: input.name,
      type: 'PHYSICAL',
      phones: [phone],
      ...(input.cpf ? { cpf: input.cpf.replace(/\D/g, '') } : {}),
      ...(input.address ? addressToCustomerFields(input.address) : {}),
    };
    return toCustomer(
      await this.request('POST', '/customers', customerDto, { body }),
    );
  }

  async updateCustomerAddress(id: number, address: Address): Promise<Customer> {
    // PUT substitui o cadastro: reenviamos tudo o que veio (CPF, e-mails,
    // aniversário...), trocando só o endereço e tirando campos de leitura.
    const current = await this.request(
      'GET',
      `/customers/${id}`,
      customerDto.loose(),
    );
    const {
      id: _id,
      created_at: _createdAt,
      updated_at: _updatedAt,
      last_sale: _lastSale,
      tag_description: _tagDescription,
      ...editable
    } = current;
    const body = { ...editable, ...addressToCustomerFields(address) };
    return toCustomer(
      await this.request('PUT', `/customers/${id}`, customerDto, { body }),
    );
  }

  // ---- Produtos e formas de pagamento -------------------------------------

  async listProducts(): Promise<Product[]> {
    const items = await this.requestAllPages('/products', productDto, {
      establishment_id: this.options.establishmentId,
      inactive: false,
    });
    return items.map(toProduct);
  }

  async getProduct(id: number): Promise<Product> {
    return toProduct(await this.request('GET', `/products/${id}`, productDto));
  }

  async listPaymentTypes(): Promise<PaymentType[]> {
    const items = await this.requestAllPages('/payment-types', paymentTypeDto, {
      establishment_id: this.options.establishmentId,
      status: 'ACTIVE',
    });
    return items.map((p) => ({
      id: p.id,
      code: p.payment_type,
      description: p.payment_type_description ?? p.payment_type,
    }));
  }

  // ---- Vendas -------------------------------------------------------------

  async findLastSale(customerId: number): Promise<Sale | null> {
    const [last] = await this.listRecentSales(customerId, 1);
    return last ?? null;
  }

  async listRecentSales(customerId: number, limit: number): Promise<Sale[]> {
    const to = this.now();
    const from = new Date(to.getTime() - SALES_LOOKBACK_DAYS * 86_400_000);
    // A listagem já vem da mais nova para a mais antiga.
    const page = await this.request('GET', '/sales', pageOf(saleDto), {
      query: {
        customer_id: customerId,
        establishment_id: this.options.establishmentId,
        from: isoDate(from),
        to: isoDate(to),
        page_size: Math.min(Math.max(1, limit), PAGE_SIZE_MAX),
      },
    });
    return page.data.map(toSale);
  }

  async getSale(id: number): Promise<Sale> {
    return toSale(await this.request('GET', `/sales/${id}`, saleDto));
  }

  async createSale(input: NewSale): Promise<Sale> {
    // Sem nova tentativa automática: repetir um POST pode duplicar a venda.
    return toSale(
      await this.request('POST', '/sales', saleDto, {
        body: this.saleBody(input),
      }),
    );
  }

  async updateSale(id: number, input: NewSale): Promise<Sale> {
    return toSale(
      await this.request('PUT', `/sales/${id}`, saleDto, {
        body: this.saleBody(input),
      }),
    );
  }

  async cancelSale(id: number, motiveId: number): Promise<Sale> {
    return toSale(
      await this.request('PUT', `/sales/${id}/cancel`, saleDto, {
        body: { motive_cancel_sale_id: motiveId },
      }),
    );
  }

  async listCancelMotives(): Promise<CancelMotive[]> {
    const items = await this.requestAllPages(
      '/motive-cancel-sale',
      cancelMotiveDto,
      { status: true },
    );
    return items.map((m) => ({ id: m.id, description: m.description ?? '' }));
  }

  private saleBody(input: NewSale) {
    return {
      customer_id: input.customerId,
      establishment_id: this.options.establishmentId,
      ...addressToSaleFields(input.address),
      observation: input.observation ?? '',
      products: input.items.map((item) => ({
        product_id: item.productId,
        quantity: item.quantity,
        value: item.unitValue,
      })),
      payments: input.payments.map((p) => ({
        payment_type: p.code,
        value: p.value,
      })),
      channel: 'WHATSAPP',
      origin: 'INTEGRATION',
      option: 'NORMAL',
      broadcast: 'NEW_SALE',
    };
  }

  // ---- HTTP ---------------------------------------------------------------

  private async requestAllPages<T extends z.ZodType>(
    path: string,
    item: T,
    query: Query,
  ): Promise<z.infer<T>[]> {
    const all: z.infer<T>[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const result = await this.request('GET', path, pageOf(item), {
        query: { ...query, page, page_size: PAGE_SIZE_MAX },
      });
      all.push(...result.data);
      const hasNext =
        result.pagination?.has_next ?? result.data.length === PAGE_SIZE_MAX;
      if (!hasNext) break;
    }
    return all;
  }

  private request<T extends z.ZodType>(
    method: Method,
    path: string,
    schema: T,
    opts: { query?: Query; body?: unknown } = {},
  ): Promise<z.infer<T>> {
    // Fila única: garante o intervalo mínimo entre requisições.
    const run = this.queue.then(() => this.send(method, path, schema, opts));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async send<T extends z.ZodType>(
    method: Method,
    path: string,
    schema: T,
    opts: { query?: Query; body?: unknown },
    attempt = 0,
  ): Promise<z.infer<T>> {
    const wait = this.lastRequestAt + this.minIntervalMs - Date.now();
    if (wait > 0) await this.sleep(wait);
    this.lastRequestAt = Date.now();

    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(opts.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method,
        headers: {
          Authorization: this.options.apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (cause) {
      const isTimeout =
        cause instanceof Error &&
        (cause.name === 'TimeoutError' || cause.name === 'AbortError');
      throw new RevgasError(
        isTimeout ? 'timeout' : 'network',
        isTimeout
          ? `RevGás não respondeu em ${this.timeoutMs} ms (${method} ${path})`
          : `Falha de rede ao chamar a RevGás (${method} ${path})`,
        { cause },
      );
    }

    const payload: unknown = await response.json().catch(() => undefined);

    if (!response.ok) {
      const error = toError(response.status, payload, `${method} ${path}`);
      if (error.retryable && attempt < this.maxRateLimitRetries) {
        await this.sleep(this.minIntervalMs);
        return this.send(method, path, schema, opts, attempt + 1);
      }
      throw error;
    }

    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new RevgasError(
        'invalid_response',
        `Resposta inesperada da RevGás em ${method} ${path}: ${parsed.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join('.')} ${i.message}`)
          .join('; ')}`,
        { status: response.status },
      );
    }
    return parsed.data;
  }
}

// ---- Mapeamentos ----------------------------------------------------------

/**
 * Deixa só dígitos e aceita o formato da API: 10 ou 11 dígitos, com ou sem
 * o 55 na frente. Retorna `null` se não for um telefone válido.
 */
export function normalizePhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  if (/^55\d{10,11}$/.test(digits) || /^\d{10,11}$/.test(digits)) {
    return digits;
  }
  return null;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const orUndefined = (v: string | number | null | undefined) =>
  v === null || v === undefined || v === '' ? undefined : String(v);

function toCustomer(dto: CustomerDto): Customer {
  return {
    id: dto.id,
    name: dto.name ?? '',
    phones: dto.phones ?? [],
    address: dto.location
      ? {
          street: dto.location,
          number: dto.number ?? '',
          neighborhood: dto.neighborhood ?? '',
          complement: orUndefined(dto.complement),
          landmark: orUndefined(dto.landmark),
          city: orUndefined(dto.city),
          state: orUndefined(dto.state_federation),
          postalCode: orUndefined(dto.postal_code),
          latitude: orUndefined(dto.latitude),
          longitude: orUndefined(dto.longitude),
        }
      : null,
    lastSaleAt: dto.last_sale ?? null,
    creditLimit: Number(dto.credit_limit ?? 0) || 0,
    category: dto.tag_description ?? null,
  };
}

function toProduct(dto: z.infer<typeof productDto>): Product {
  return {
    id: dto.id,
    description: dto.description ?? '',
    stockQuantity: dto.stock_quantity ?? 0,
  };
}

function toSale(dto: SaleDto): Sale {
  const items = (dto.products ?? []).map((p) => ({
    productId: p.product_id,
    description: p.product_description ?? '',
    quantity: p.quantity,
    unitValue: p.value,
  }));
  return {
    id: dto.id,
    status: dto.status,
    customerId: dto.customer_id ?? null,
    delivererId: dto.deliverer_id ?? null,
    deliveredAt: dto.delivered_at ?? null,
    address: dto.location
      ? {
          street: dto.location,
          number: dto.number ?? '',
          neighborhood: dto.neighborhood ?? '',
          complement: orUndefined(dto.complement),
          landmark: orUndefined(dto.landmark),
          city: orUndefined(dto.city),
          state: orUndefined(dto.state_federation),
          latitude: orUndefined(dto.lat),
          longitude: orUndefined(dto.lon),
        }
      : null,
    items,
    payments: (dto.payments ?? []).map((p) => ({
      code: p.type,
      value: p.value,
    })),
    total:
      dto.total ??
      items.reduce((sum, item) => sum + item.quantity * item.unitValue, 0),
    observation: dto.observation || null,
  };
}

function addressToCustomerFields(a: Address) {
  return {
    location: a.street,
    number: a.number,
    neighborhood: a.neighborhood,
    complement: a.complement,
    landmark: a.landmark,
    city: a.city,
    state_federation: a.state,
    postal_code: a.postalCode,
    latitude: a.latitude,
    longitude: a.longitude,
  };
}

function addressToSaleFields(a: Address) {
  return {
    location: a.street,
    number: a.number,
    neighborhood: a.neighborhood,
    complement: a.complement,
    landmark: a.landmark,
    city: a.city,
    state_federation: a.state,
    lat: a.latitude,
    lon: a.longitude,
  };
}

const STATUS_CODES: Record<number, RevgasErrorCode> = {
  400: 'bad_request',
  401: 'unauthorized',
  402: 'blocked',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  422: 'validation',
  429: 'rate_limited',
};

function toError(status: number, payload: unknown, where: string): RevgasError {
  const body = errorBody.safeParse(payload);
  const data = body.success ? (body.data.data ?? []) : [];
  const fields = data
    .filter((d) => d.field)
    .map((d) => ({ field: d.field ?? '', message: d.message ?? '' }));
  const apiMessage = body.success ? body.data.message : undefined;

  let code: RevgasErrorCode =
    STATUS_CODES[status] ?? (status >= 500 ? 'server' : 'bad_request');
  if (code === 'validation') {
    if (fields.some((f) => /stock|estoque/i.test(f.message))) {
      code = 'out_of_stock';
    } else if (
      fields.some(
        (f) =>
          f.field.startsWith('payments') && /declin|recus/i.test(f.message),
      )
    ) {
      code = 'payment_declined';
    }
  }

  const duplicateId = data.find((d) => d.value_id != null)?.value_id;
  return new RevgasError(
    code,
    `RevGás respondeu ${status} em ${where}${apiMessage ? `: ${apiMessage}` : ''}`,
    {
      status,
      fields,
      duplicateId: duplicateId == null ? undefined : String(duplicateId),
    },
  );
}
