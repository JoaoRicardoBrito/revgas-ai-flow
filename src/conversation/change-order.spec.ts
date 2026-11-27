/** Issue #11: alterar produto e endereço, antes e depois da venda. */
import { describe, expect, it } from 'vitest';
import { SEED } from '../revgas/fake/seed.js';
import {
  emptyDraft,
  type SessionState,
  type Signal,
} from './conversation.types.js';
import { NO_COVERAGE_RULES, parseCoverage, type Coverage } from './coverage.js';
import { markDispatched, runTurn } from './state-machine.js';
import { fakeRevgas, fullAddress, said, tapped } from './testing.js';

const RECURRING = SEED.recurringCustomer.phone;
const NEW_PHONE = '5586922220000';
const start: SessionState = { step: 'identifying', draft: emptyDraft() };

function setup(
  contact: string = RECURRING,
  coverage: Coverage = NO_COVERAGE_RULES,
) {
  const { fake, revgas, catalog } = fakeRevgas();
  return {
    fake,
    ctx: {
      revgas,
      catalog,
      contact,
      settings: { cpfRequired: false, coverage },
    },
  };
}

function located(latitude: number, longitude: number, fields = {}): Signal {
  return {
    ...said({ intent: 'change_address', ...fields }),
    location: { latitude, longitude },
  };
}

const ids = (reply: { buttons?: { id: string }[] } | undefined) =>
  reply?.buttons?.map((b) => b.id) ?? [];

async function sold(coverage: Coverage = NO_COVERAGE_RULES) {
  const s = setup(RECURRING, coverage);
  const summary = await runTurn(start, said({ intent: 'repeat_last' }), s.ctx);
  const sale = await runTurn(summary, tapped('confirm'), s.ctx);
  return { ...s, sale };
}

describe('antes da confirmação', () => {
  it('mudar a quantidade recalcula o total', async () => {
    const { ctx } = setup();
    const summary = await runTurn(start, said({ intent: 'repeat_last' }), ctx);

    const result = await runTurn(
      summary,
      said({ intent: 'order', quantity: 2 }),
      ctx,
    );

    expect(result.step).toBe('confirming');
    expect(result.replies[0]?.text).toMatch(/2x GLP 13KG/);
    expect(result.replies[0]?.text).toMatch(/Total: R\$\s?240,00/);
  });

  it('trocar o produto recalcula o total', async () => {
    const { ctx } = setup();
    const summary = await runTurn(start, said({ intent: 'repeat_last' }), ctx);

    const result = await runTurn(
      summary,
      said({ intent: 'change_product', productSizeKg: 45 }),
      ctx,
    );

    expect(result.replies[0]?.text).toMatch(/Total: R\$\s?420,00/);
  });
});

describe('endereço por texto, salvo ou localização', () => {
  it('localização sozinha guarda o ponto e pede rua, número e bairro', async () => {
    const { ctx } = setup(NEW_PHONE);
    const ask = await runTurn(
      start,
      said({ productSizeKg: 13, paymentMethod: 'pix', customerName: 'Ana' }),
      ctx,
    );

    const pinned = await runTurn(ask, located(-5.09, -42.8), ctx);

    expect(pinned.draft.pendingLocation).toEqual({
      latitude: -5.09,
      longitude: -42.8,
    });
    expect(pinned.draft.address).toBeNull();
    expect(pinned.replies[0]?.text).toMatch(/Recebi sua localização\./);
    expect(pinned.replies[0]?.text).toMatch(/rua, o número e o bairro/);
  });

  it('o endereço digitado depois leva as coordenadas da localização', async () => {
    const { ctx, fake } = setup(NEW_PHONE);
    const ask = await runTurn(
      start,
      said({ productSizeKg: 13, paymentMethod: 'pix', customerName: 'Ana' }),
      ctx,
    );
    const pinned = await runTurn(ask, located(-5.09, -42.8), ctx);

    const summary = await runTurn(pinned, said({ address: fullAddress }), ctx);
    await runTurn(summary, tapped('confirm'), ctx);

    expect(summary.draft.address).toMatchObject({
      street: 'Rua Nova',
      latitude: '-5.09',
      longitude: '-42.8',
    });
    expect(summary.draft.pendingLocation).toBeNull();
    expect(fake.sales.at(-1)).toMatchObject({ lat: '-5.09', lon: '-42.8' });
  });

  it('localização com endereço escrito resolve de uma vez', async () => {
    const { ctx } = setup(NEW_PHONE);
    const ask = await runTurn(
      start,
      said({ productSizeKg: 13, paymentMethod: 'pix', customerName: 'Ana' }),
      ctx,
    );

    const summary = await runTurn(
      ask,
      located(-5.09, -42.8, { address: fullAddress }),
      ctx,
    );

    expect(summary.step).toBe('confirming');
    expect(summary.draft.address?.latitude).toBe('-5.09');
  });
});

describe('área de cobertura', () => {
  const onlyCentro = parseCoverage({ neighborhoods: 'Centro' });

  it('fora da área: não aceita o endereço e oferece atendente', async () => {
    const { ctx } = setup(NEW_PHONE, onlyCentro);
    const ask = await runTurn(
      start,
      said({ productSizeKg: 13, paymentMethod: 'pix', customerName: 'Ana' }),
      ctx,
    );

    const result = await runTurn(ask, said({ address: fullAddress }), ctx);

    expect(result.step).toBe('collecting');
    expect(result.draft.address).toBeNull();
    expect(result.replies[0]?.text).toMatch(/Ainda não entregamos em Fátima\./);
    expect(ids(result.replies[0])).toContain('human');
  });

  it('dentro da área: segue para o resumo', async () => {
    const { ctx } = setup(NEW_PHONE, onlyCentro);
    const ask = await runTurn(
      start,
      said({ productSizeKg: 13, paymentMethod: 'pix', customerName: 'Ana' }),
      ctx,
    );

    const result = await runTurn(
      ask,
      said({ address: { ...fullAddress, neighborhood: 'centro' } }),
      ctx,
    );

    expect(result.step).toBe('confirming');
  });

  it('por raio: localização perto da loja é atendida mesmo fora da lista de bairros', async () => {
    const coverage = {
      ...onlyCentro,
      center: { latitude: -5.09, longitude: -42.8 },
      radiusKm: 3,
    };
    const { ctx } = setup(NEW_PHONE, coverage);
    const ask = await runTurn(
      start,
      said({ productSizeKg: 13, paymentMethod: 'pix', customerName: 'Ana' }),
      ctx,
    );

    const result = await runTurn(
      ask,
      located(-5.1, -42.81, { address: fullAddress }),
      ctx,
    );

    expect(result.step).toBe('confirming');
  });

  it('recorrente com último endereço fora da área: avisa e mostra só os atendidos', async () => {
    const onlyOther = parseCoverage({ neighborhoods: 'Fátima' });
    const { ctx } = setup(RECURRING, onlyOther);

    const result = await runTurn(start, said({ intent: 'repeat_last' }), ctx);

    expect(result.step).toBe('collecting');
    expect(result.replies[0]?.text).toMatch(/Ainda não entregamos em Centro\./);
    expect(
      ids(result.replies[0]).filter((id) => id.startsWith('address:')),
    ).toEqual([]);
  });

  it('botão de endereço salvo fora da área também é recusado', async () => {
    const { ctx } = setup(RECURRING, onlyCentro);
    const summary = await runTurn(start, said({ intent: 'repeat_last' }), ctx);
    const menu = await runTurn(summary, tapped('change'), ctx);
    const ask = await runTurn(menu, tapped('change:address'), ctx);
    // Os dois endereços salvos da Maria são do Centro.
    expect(ids(ask.replies[0])).toEqual(['address:0', 'address:1']);

    ctx.settings.coverage = parseCoverage({ neighborhoods: 'Fátima' });
    const result = await runTurn(ask, tapped('address:1'), ctx);

    expect(result.draft.address).toBeNull();
    expect(result.replies[0]?.text).toMatch(/Ainda não entregamos em Centro/);
  });
});

describe('depois da venda, antes do despacho (PRD 6.1)', () => {
  it('trocar o produto: propõe com o novo total e só altera depois de confirmar', async () => {
    const { ctx, fake, sale } = await sold();
    const saleId = sale.draft.saleId;

    const proposal = await runTurn(
      sale,
      said({ intent: 'change_product', productSizeKg: 20 }),
      ctx,
    );

    expect(proposal.step).toBe('sale_created');
    expect(proposal.replies[0]?.text).toMatch(/Alterar o pedido nº \d+ para:/);
    expect(proposal.replies[0]?.text).toMatch(/Novo total: R\$\s?180,00/);
    expect(ids(proposal.replies[0])).toEqual([
      'sale_change:confirm',
      'sale_change:keep',
    ]);
    expect(
      fake.sales.find((s) => s.id === saleId)?.products[0]?.product_description,
    ).toBe('GLP 13KG');

    const done = await runTurn(proposal, tapped('sale_change:confirm'), ctx);

    expect(done.replies[0]?.text).toMatch(
      /alterado\. Novo total: R\$\s?180,00/,
    );
    expect(fake.sales.find((s) => s.id === saleId)).toMatchObject({
      total: 180,
      products: [expect.objectContaining({ product_description: 'GLP 20KG' })],
      payments: [expect.objectContaining({ value: 180 })],
    });
    expect(done.draft.item?.description).toBe('GLP 20KG');
  });

  it('"Manter pedido" não muda nada', async () => {
    const { ctx, fake, sale } = await sold();
    const proposal = await runTurn(
      sale,
      said({ intent: 'change_product', productSizeKg: 20 }),
      ctx,
    );

    const kept = await runTurn(proposal, tapped('sale_change:keep'), ctx);

    expect(kept.draft.pendingChange).toBeNull();
    expect(fake.sales.at(-1)?.products[0]?.product_description).toBe(
      'GLP 13KG',
    );
    expect(
      fake.requests.some(
        (r) => r.method === 'PUT' && r.path.startsWith('/sales/'),
      ),
    ).toBe(false);
  });

  it('mudar o endereço revalida a cobertura', async () => {
    const { ctx, fake, sale } = await sold(
      parseCoverage({ neighborhoods: 'Centro' }),
    );

    const refused = await runTurn(
      sale,
      said({ intent: 'change_address', address: fullAddress }),
      ctx,
    );

    expect(refused.step).toBe('sale_created');
    expect(refused.replies[0]?.text).toMatch(
      /Ainda não entregamos em Fátima\. Seu pedido continua para Rua das Flores/,
    );
    expect(fake.sales.at(-1)?.location).toBe('Rua das Flores');
  });

  it('mudar o endereço dentro da área: altera a venda', async () => {
    const { ctx, fake, sale } = await sold();
    const proposal = await runTurn(
      sale,
      said({ intent: 'change_address', address: fullAddress }),
      ctx,
    );

    await runTurn(proposal, tapped('sale_change:confirm'), ctx);

    expect(fake.sales.at(-1)).toMatchObject({
      location: 'Rua Nova',
      number: '45',
    });
  });

  it('aumentar além do estoque é recusado', async () => {
    const { ctx, fake, sale } = await sold();
    fake.setStock(SEED.products.p13, 1);

    const result = await runTurn(
      sale,
      said({ intent: 'order', quantity: 5 }),
      ctx,
    );

    expect(result.replies[0]?.text).toMatch(/Só temos 1 GLP 13KG agora/);
    expect(result.draft.pendingChange).toBeNull();
  });

  it('a RevGás recusa a alteração (ex.: já confirmada): atendente', async () => {
    const { ctx, fake, sale } = await sold();
    const proposal = await runTurn(
      sale,
      said({ intent: 'change_product', productSizeKg: 20 }),
      ctx,
    );
    fake.setSaleStatus(fake.sales.at(-1)?.id ?? 0, 'CHECK');

    const result = await runTurn(proposal, tapped('sale_change:confirm'), ctx);

    expect(result.step).toBe('closed');
    expect(result.events).toEqual([
      { type: 'handoff', reason: 'alteração recusada pela RevGás' },
    ]);
  });

  it('"quero trocar o produto" sem dizer qual: mostra as opções', async () => {
    const { ctx, sale } = await sold();

    const result = await runTurn(sale, said({ intent: 'change_product' }), ctx);

    expect(result.step).toBe('sale_created');
    expect(ids(result.replies[0])[0]).toMatch(/^product:/);
  });
});

describe('depois do despacho (PRD 6.1)', () => {
  it('produto não muda mais', async () => {
    const { ctx, sale } = await sold();
    const dispatched = markDispatched(sale);

    const result = await runTurn(
      dispatched,
      said({ intent: 'change_product', productSizeKg: 20 }),
      ctx,
    );

    expect(result.step).toBe('dispatched');
    expect(result.replies[0]?.text).toMatch(
      /não dá mais para trocar o produto/,
    );
    expect(ids(result.replies[0])).toEqual(['human']);
  });

  it('endereço só com atendente', async () => {
    const { ctx, sale } = await sold();
    const dispatched = markDispatched(sale);

    const result = await runTurn(dispatched, located(-5.1, -42.8), ctx);

    expect(result.step).toBe('closed');
    expect(result.events).toEqual([
      { type: 'handoff', reason: 'alterar endereço após despacho' },
    ]);
  });
});

describe('alteração com cache ligado', () => {
  it('estoque do cache desatualizado: a consulta na hora barra a alteração', async () => {
    const { fake, revgas, catalog } = fakeRevgas({ ttlMs: 60_000 });
    const ctx = { revgas, catalog, contact: RECURRING };
    const summary = await runTurn(start, said({ intent: 'repeat_last' }), ctx);
    const sale = await runTurn(summary, tapped('confirm'), ctx);
    // O cache ainda acha que tem 40; na API sobrou 1.
    fake.setStock(SEED.products.p13, 1);

    const result = await runTurn(
      sale,
      said({ intent: 'order', quantity: 5 }),
      ctx,
    );

    expect(result.draft.pendingChange).toBeNull();
    expect(result.replies[0]?.text).toMatch(/Não temos GLP 13KG suficiente/);
  });
});
