import { describe, expect, it, vi } from 'vitest';
import { SEED } from '../revgas/fake/seed.js';
import {
  Catalog,
  DEMO_PRICES_BY_KG,
  findRelative,
  parsePriceList,
  sellable,
  type CatalogProduct,
} from './catalog.js';
import { fakeRevgas } from './testing.js';

function setup(ttlMs = 120_000) {
  let clock = 0;
  const { fake, revgas } = fakeRevgas();
  const catalog = new Catalog(revgas, {
    prices: DEMO_PRICES_BY_KG,
    ttlMs,
    now: () => clock,
  });
  const productCalls = () =>
    fake.requests.filter((r) => r.path === '/products').length;
  return {
    fake,
    revgas,
    catalog,
    productCalls,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe('Catalog: cache', () => {
  it('dentro do prazo, não chama a API de novo', async () => {
    const { catalog, productCalls, advance } = setup();

    await catalog.offer();
    advance(119_000);
    await catalog.offer();

    expect(productCalls()).toBe(1);
  });

  it('depois do prazo, recarrega', async () => {
    const { catalog, productCalls, advance } = setup();

    await catalog.offer();
    advance(120_000);
    await catalog.offer();

    expect(productCalls()).toBe(2);
  });

  it('turnos simultâneos esperam a mesma carga', async () => {
    const { catalog, productCalls } = setup();

    await Promise.all([catalog.offer(), catalog.offer(), catalog.offer()]);

    expect(productCalls()).toBe(1);
  });

  it('invalidate força recarregar', async () => {
    const { catalog, productCalls } = setup();

    await catalog.offer();
    catalog.invalidate();
    await catalog.offer();

    expect(productCalls()).toBe(2);
  });

  it('falha ao carregar não fica no cache', async () => {
    const { fake, catalog } = setup();
    fake.failNext(1, 500, { path: '/products' });

    await expect(catalog.offer()).rejects.toThrow();
    await expect(catalog.offer()).resolves.toMatchObject({
      catalog: expect.any(Array),
    });
  });

  it('freshStock consulta a API sem cache e atualiza o cache', async () => {
    const { fake, catalog } = setup();
    await catalog.offer();
    fake.setStock(SEED.products.p13, 2);

    const stock = await catalog.freshStock(SEED.products.p13);
    const cached = (await catalog.offer()).catalog.find(
      (p) => p.id === SEED.products.p13,
    );

    expect(stock).toBe(2);
    expect(cached?.stockQuantity).toBe(2);
  });

  it('formas de pagamento também ficam no cache', async () => {
    const { fake, catalog } = setup();

    await catalog.offer();
    await catalog.offer();

    expect(
      fake.requests.filter((r) => r.path === '/payment-types'),
    ).toHaveLength(1);
  });
});

describe('Catalog: preços', () => {
  it('aplica o preço configurado por peso', async () => {
    const { revgas } = fakeRevgas();
    const catalog = new Catalog(revgas, {
      prices: parsePriceList('P13:115,P20:175.50'),
      ttlMs: 0,
    });

    const { catalog: products } = await catalog.offer();

    expect(products.find((p) => p.sizeKg === 13)?.unitValue).toBe(115);
    expect(products.find((p) => p.sizeKg === 20)?.unitValue).toBe(175.5);
    expect(products.find((p) => p.sizeKg === 45)?.unitValue).toBeNull();
  });

  it('sem tabela de preços, nada fica à venda', async () => {
    const { revgas } = fakeRevgas();
    const catalog = new Catalog(revgas, { prices: {}, ttlMs: 0 });

    const { catalog: products } = await catalog.offer();

    expect(products.length).toBeGreaterThan(0);
    expect(sellable(products)).toEqual([]);
  });

  it.each([
    ['P13:120,P20:180', { 13: 120, 20: 180 }],
    ['13=120, 45=420.50', { 13: 120, 45: 420.5 }],
    [' p13 : 99.9 ', { 13: 99.9 }],
  ])('parsePriceList("%s")', (input, expected) => {
    expect(parsePriceList(input)).toEqual(expected);
  });

  it.each(['treze reais', 'P13:120,50', 'P130:120', 'P13:'])(
    'parsePriceList recusa "%s" (vírgula separa itens; decimal é com ponto)',
    (input) => {
      expect(() => parsePriceList(input)).toThrow(/Use P13:120,P20:180/);
    },
  );
});

function product(
  id: number,
  sizeKg: number,
  stock = 5,
  unitValue: number | null = 100,
): CatalogProduct {
  return {
    id,
    description: `GLP ${sizeKg}KG`,
    stockQuantity: stock,
    sizeKg,
    unitValue,
  };
}

describe('sellable e findRelative', () => {
  const catalog = [
    product(4, 45),
    product(1, 8),
    product(3, 20, 0),
    product(2, 13),
    product(5, 90, 5, null),
  ];

  it('sellable ordena do menor ao maior e tira sem estoque ou sem preço', () => {
    expect(sellable(catalog).map((p) => p.sizeKg)).toEqual([8, 13, 45]);
  });

  it('"um maior" pula o que não está à venda', () => {
    expect(findRelative(catalog, 2, 'bigger').product?.sizeKg).toBe(45);
  });

  it('"um menor" pega o tamanho logo abaixo', () => {
    expect(findRelative(catalog, 4, 'smaller').product?.sizeKg).toBe(13);
  });

  it('sem maior disponível', () => {
    expect(findRelative(catalog, 4, 'bigger')).toEqual({
      reason: 'none_in_direction',
    });
  });

  it('sem produto atual, é ambíguo', () => {
    expect(findRelative(catalog, null, 'bigger')).toEqual({
      reason: 'no_reference',
    });
  });
});

describe('Catalog com fake de rede', () => {
  it('não consulta o estoque individual ao montar a oferta', async () => {
    const { revgas, catalog } = setup();
    const getProduct = vi.spyOn(revgas, 'getProduct');

    await catalog.offer();

    expect(getProduct).not.toHaveBeenCalled();
  });
});
