import { describe, expect, it, vi } from 'vitest';
import { RevgasError } from '../revgas.errors.js';
import {
  FAKE_API_KEY,
  FAKE_BASE_URL,
  FAKE_ESTABLISHMENT_ID,
  FakeRevgasApi,
  type FakeRevgasApiOptions,
} from '../fake/fake-revgas-api.js';
import { SEED } from '../fake/seed.js';
import { readContract, writeContract } from '../revgas-client.contract.js';
import {
  HttpRevgasClient,
  normalizePhone,
  type HttpRevgasClientOptions,
} from './http-revgas-client.js';

function setup(
  fakeOptions: FakeRevgasApiOptions = {},
  clientOptions: Partial<HttpRevgasClientOptions> = {},
) {
  const fake = new FakeRevgasApi(fakeOptions);
  const client = new HttpRevgasClient({
    baseUrl: FAKE_BASE_URL,
    apiKey: FAKE_API_KEY,
    establishmentId: FAKE_ESTABLISHMENT_ID,
    fetch: fake.fetch,
    minIntervalMs: 0,
    sleep: () => Promise.resolve(),
    ...clientOptions,
  });
  return { fake, client };
}

const sale = {
  customerId: SEED.recurringCustomer.id,
  address: { street: 'Rua A', number: '1', neighborhood: 'Centro' },
  items: [{ productId: SEED.products.p13, quantity: 1, unitValue: 120 }],
  payments: [{ code: 'PIX' as const, value: 120 }],
};

describe('HttpRevgasClient contra o fake da API', () => {
  const target = {
    client: () => setup().client,
    clientWithBadKey: () => setup({}, { apiKey: 'errada' }).client,
  };
  readContract(target);
  writeContract(target, {
    recurringPhone: SEED.recurringCustomer.phone,
    recurringCustomerId: SEED.recurringCustomer.id,
    customerWithoutSalesId: SEED.customerWithoutSales.id,
    productId: SEED.products.p13,
    cancelMotiveId: SEED.cancelMotive,
  });
});

describe('HttpRevgasClient: requisições enviadas', () => {
  it('manda a chave crua no Authorization, sem Bearer', async () => {
    const fetchSpy = vi.fn(new FakeRevgasApi().fetch);
    const { client } = setup({}, { fetch: fetchSpy });

    await client.listProducts();

    const init = fetchSpy.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).get('Authorization')).toBe(FAKE_API_KEY);
  });

  it('cria a venda com canal WhatsApp e origem integração', async () => {
    const { fake, client } = setup();

    await client.createSale(sale);

    const post = fake.requests.find(
      (r) => r.method === 'POST' && r.path === '/sales',
    );
    expect(post?.body).toMatchObject({
      channel: 'WHATSAPP',
      origin: 'INTEGRATION',
      option: 'NORMAL',
      establishment_id: FAKE_ESTABLISHMENT_ID,
      products: [{ product_id: SEED.products.p13, quantity: 1, value: 120 }],
      payments: [{ payment_type: 'PIX', value: 120 }],
    });
  });

  it('busca a última venda dentro do limite de 366 dias', async () => {
    const now = new Date('2026-11-27T12:00:00Z');
    const { fake, client } = setup({ now: () => now }, { now: () => now });

    await client.findLastSale(SEED.recurringCustomer.id);

    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]).toMatchObject({
      path: '/sales',
      query: {
        customer_id: String(SEED.recurringCustomer.id),
        from: '2025-11-27',
        to: '2026-11-27',
        page_size: '1',
      },
    });
  });

  it('percorre todas as páginas da listagem', async () => {
    const { fake, client } = setup();
    for (let i = 0; i < 230; i++) {
      fake.products.push({
        id: 5000 + i,
        description: `Produto ${i}`,
        stock_quantity: 1,
        establishment_id: FAKE_ESTABLISHMENT_ID,
        inactive: false,
      });
    }

    const products = await client.listProducts();

    expect(products).toHaveLength(233);
    expect(fake.requests.filter((r) => r.path === '/products')).toHaveLength(3);
  });

  it('respeita o intervalo mínimo entre requisições', async () => {
    const sleep = vi.fn((_ms: number) => Promise.resolve());
    const { client } = setup({}, { minIntervalMs: 1000, sleep });

    await Promise.all([client.listPaymentTypes(), client.listCancelMotives()]);

    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep.mock.calls[0]?.[0]).toBeGreaterThan(900);
  });
});

describe('HttpRevgasClient: cenários simulados no fake', () => {
  it('produto sem estoque vira out_of_stock e não baixa estoque', async () => {
    const { fake, client } = setup();
    fake.setStock(SEED.products.p13, 0);

    const error = await client.createSale(sale).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RevgasError);
    expect(error).toMatchObject({ code: 'out_of_stock' });
    expect((await client.getProduct(SEED.products.p13)).stockQuantity).toBe(0);
  });

  it('venda baixa o estoque e o cancelamento devolve', async () => {
    const { client } = setup();
    const before = (await client.getProduct(SEED.products.p13)).stockQuantity;

    const created = await client.createSale(sale);
    const during = (await client.getProduct(SEED.products.p13)).stockQuantity;
    await client.cancelSale(created.id, SEED.cancelMotive);
    const after = (await client.getProduct(SEED.products.p13)).stockQuantity;

    expect(during).toBe(before - 1);
    expect(after).toBe(before);
  });

  it('pagamento recusado vira payment_declined', async () => {
    const { fake, client } = setup();
    fake.declinePayment();

    await expect(client.createSale(sale)).rejects.toMatchObject({
      code: 'payment_declined',
    });
    await expect(client.createSale(sale)).resolves.toMatchObject({
      status: 'OPEN',
    });
  });

  it('falha 500 vira server e o POST de venda não é repetido', async () => {
    const { fake, client } = setup();
    fake.failNext(1, 500);

    await expect(client.createSale(sale)).rejects.toMatchObject({
      code: 'server',
    });
    expect(fake.requests.filter((r) => r.path === '/sales')).toHaveLength(1);
  });

  it('429 é repetido até passar', async () => {
    const { fake, client } = setup();
    fake.failNext(2, 429);

    await expect(client.listPaymentTypes()).resolves.not.toHaveLength(0);
    expect(fake.requests).toHaveLength(3);
  });

  it('429 persistente vira rate_limited', async () => {
    const { fake, client } = setup({}, { maxRateLimitRetries: 1 });
    fake.failNext(5, 429);

    await expect(client.listPaymentTypes()).rejects.toMatchObject({
      code: 'rate_limited',
    });
  });

  it('latência acima do timeout vira timeout', async () => {
    const { client } = setup({ latencyMs: 200 }, { timeoutMs: 20 });

    await expect(client.listProducts()).rejects.toMatchObject({
      code: 'timeout',
    });
  });

  it('venda conferida não pode ser cancelada', async () => {
    const { fake, client } = setup();
    const created = await client.createSale(sale);
    fake.setSaleStatus(created.id, 'CHECK');

    await expect(
      client.cancelSale(created.id, SEED.cancelMotive),
    ).rejects.toMatchObject({ code: 'bad_request' });
  });

  it('a mensagem de erro não contém a chave', async () => {
    const secret = 'chave-super-secreta';
    const { client } = setup({}, { apiKey: secret });

    const error = await client.listProducts().catch((e: unknown) => e);

    expect(String(error)).not.toContain(secret);
    expect(JSON.stringify(error)).not.toContain(secret);
  });
});

describe('normalizePhone', () => {
  it.each([
    ['(86) 99999-0001', '86999990001'],
    ['+55 86 99999-0001', '5586999990001'],
    ['8633330001', '8633330001'],
  ])('%s → %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(['', '123', 'abc', '+1 415 555 0100 99'])('recusa %s', (input) => {
    expect(normalizePhone(input)).toBeNull();
  });
});
