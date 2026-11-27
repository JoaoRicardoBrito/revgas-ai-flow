/** Issue #9: produto, "maior/menor" e estoque dentro da conversa. */
import { describe, expect, it, vi } from 'vitest';
import { SEED } from '../revgas/fake/seed.js';
import { emptyDraft, type SessionState } from './conversation.types.js';
import { runTurn } from './state-machine.js';
import { fakeRevgas, fullAddress, said, tapped } from './testing.js';

const RECURRING = SEED.recurringCustomer.phone;
const start: SessionState = { step: 'identifying', draft: emptyDraft() };

function setup(contact: string = RECURRING) {
  const { fake, revgas, catalog } = fakeRevgas();
  return { fake, revgas, ctx: { revgas, catalog, contact } };
}

/** Recorrente no resumo com 1x P13. */
async function atSummary() {
  const s = setup();
  const summary = await runTurn(start, said({ intent: 'repeat_last' }), s.ctx);
  return { ...s, summary };
}

describe('"um maior" e "um menor"', () => {
  it('"quero um maior" troca P13 por P20 e recalcula o total', async () => {
    const { ctx, summary } = await atSummary();

    const result = await runTurn(
      summary,
      said({ intent: 'change_product', productRelative: 'bigger' }),
      ctx,
    );

    expect(result.step).toBe('confirming');
    expect(result.draft.item).toMatchObject({
      description: 'GLP 20KG',
      unitValue: 180,
    });
    expect(result.replies[0]?.text).toMatch(/Total: R\$\s?180,00/);
  });

  it('"um menor" que o P20 volta para o P13', async () => {
    const { ctx, summary } = await atSummary();
    const bigger = await runTurn(
      summary,
      said({ intent: 'change_product', productRelative: 'bigger' }),
      ctx,
    );

    const smaller = await runTurn(
      bigger,
      said({ intent: 'change_product', productRelative: 'smaller' }),
      ctx,
    );

    expect(smaller.draft.item?.description).toBe('GLP 13KG');
  });

  it('pula tamanho sem estoque', async () => {
    const { ctx, fake } = setup();
    fake.setStock(SEED.products.p20, 0);
    const summary = await runTurn(start, said({ intent: 'repeat_last' }), ctx);

    const result = await runTurn(
      summary,
      said({ intent: 'change_product', productRelative: 'bigger' }),
      ctx,
    );

    expect(result.draft.item?.description).toBe('GLP 45KG');
  });

  it('sem maior disponível, avisa e mostra as opções', async () => {
    const { ctx, summary } = await atSummary();
    const p45 = await runTurn(
      summary,
      said({ intent: 'change_product', productSizeKg: 45 }),
      ctx,
    );

    const result = await runTurn(
      p45,
      said({ intent: 'change_product', productRelative: 'bigger' }),
      ctx,
    );

    expect(result.step).toBe('collecting');
    expect(result.replies[0]?.text).toMatch(
      /Esse já é o maior que temos agora/,
    );
    expect(result.replies[0]?.buttons?.map((b) => b.id)).toContain(
      `product:${SEED.products.p45}`,
    );
  });

  it('"quero outro" sem dizer qual: botões em vez de adivinhar', async () => {
    const { ctx, summary } = await atSummary();

    const result = await runTurn(
      summary,
      said({ intent: 'change_product' }),
      ctx,
    );

    expect(result.step).toBe('collecting');
    expect(result.draft.item).toBeNull();
    expect(result.replies[0]?.buttons?.map((b) => b.id)).toEqual([
      `product:${SEED.products.p13}`,
      `product:${SEED.products.p20}`,
      `product:${SEED.products.p45}`,
    ]);
  });

  it('"um maior" sem produto escolhido é ambíguo: pergunta o tamanho', async () => {
    const { ctx } = setup('5586900002222');

    const result = await runTurn(
      start,
      said({ productRelative: 'bigger', customerName: 'Ana' }),
      ctx,
    );

    expect(result.draft.item).toBeNull();
    expect(result.replies[0]?.text).toMatch(/Qual tamanho você quer\?/);
    expect(result.replies[0]?.buttons?.[0]?.id).toMatch(/^product:/);
  });
});

describe('estoque checado pelo código', () => {
  it('pedido acima do estoque é recusado com aviso', async () => {
    const { ctx } = setup('5586900003333');

    const result = await runTurn(
      start,
      said({ productSizeKg: 45, quantity: 5, customerName: 'Ana' }),
      ctx,
    );

    expect(result.draft.item).toBeNull();
    expect(result.replies[0]?.text).toMatch(/Só temos 3 GLP 45KG agora/);
  });

  it('mudar só a quantidade também confere o estoque', async () => {
    const { ctx, summary } = await atSummary();

    const result = await runTurn(
      summary,
      said({ intent: 'order', quantity: 80 }),
      ctx,
    );

    expect(result.draft.item?.quantity).toBe(1);
    expect(result.replies[0]?.text).toMatch(/Só temos 40 GLP 13KG agora/);
  });

  it('antes de criar a venda consulta o estoque sem cache', async () => {
    const { ctx, revgas, summary } = await atSummary();
    const getProduct = vi.spyOn(revgas, 'getProduct');

    await runTurn(summary, tapped('confirm'), ctx);

    expect(getProduct).toHaveBeenCalledWith(SEED.products.p13);
  });

  it('sem estoque: oferece outro produto ou atendente e nunca cria a venda', async () => {
    const { ctx, fake, summary } = await atSummary();
    const salesBefore = fake.sales.length;
    fake.setStock(SEED.products.p13, 0);

    const result = await runTurn(summary, tapped('confirm'), ctx);

    expect(fake.sales).toHaveLength(salesBefore);
    expect(
      fake.requests.some((r) => r.method === 'POST' && r.path === '/sales'),
    ).toBe(false);
    expect(result.step).toBe('collecting');
    const ids = result.replies[0]?.buttons?.map((b) => b.id) ?? [];
    expect(ids).toEqual([
      `product:${SEED.products.p20}`,
      `product:${SEED.products.p45}`,
      'human',
    ]);
  });

  it('sem estoque de cliente novo: não cria o cadastro', async () => {
    const { ctx, fake } = setup('5586900004444');
    const customersBefore = fake.customers.length;
    const summary = await runTurn(
      start,
      said({
        productSizeKg: 13,
        address: fullAddress,
        paymentMethod: 'pix',
        customerName: 'Ana',
      }),
      ctx,
    );
    fake.setStock(SEED.products.p13, 0);

    await runTurn(summary, tapped('confirm'), ctx);

    expect(fake.customers).toHaveLength(customersBefore);
  });

  it('nada em estoque: só o botão de atendente', async () => {
    const { ctx, fake, summary } = await atSummary();
    for (const p of fake.products) p.stock_quantity = 0;

    const result = await runTurn(summary, tapped('confirm'), ctx);

    expect(result.replies[0]?.text).toMatch(/não temos outro botijão/);
    expect(result.replies[0]?.buttons).toEqual([
      { id: 'human', label: 'Falar com atendente' },
    ]);
  });

  it('esgotou entre a consulta e a venda: reabre as opções', async () => {
    const { ctx, fake, revgas, summary } = await atSummary();
    // A consulta diz que tem; a venda é recusada pela RevGás.
    vi.spyOn(revgas, 'getProduct').mockResolvedValue({
      id: SEED.products.p13,
      description: 'GLP 13KG',
      stockQuantity: 10,
    });
    fake.setStock(SEED.products.p13, 0);

    const result = await runTurn(summary, tapped('confirm'), ctx);

    expect(result.step).toBe('collecting');
    expect(result.events).toEqual([]);
    expect(result.replies[0]?.text).toMatch(/acabou de esgotar/);
    expect(result.replies[0]?.buttons?.at(-1)?.id).toBe('human');
  });
});

describe('estoque com cache ligado', () => {
  it('venda recusada por estoque descarta o cache: as opções vêm atualizadas', async () => {
    const { fake, revgas, catalog } = fakeRevgas({ ttlMs: 60_000 });
    const ctx = { revgas, catalog, contact: RECURRING };
    const summary = await runTurn(start, said({ intent: 'repeat_last' }), ctx);
    // A consulta individual diz que tem; a RevGás recusa a venda.
    vi.spyOn(revgas, 'getProduct').mockResolvedValue({
      id: SEED.products.p13,
      description: 'GLP 13KG',
      stockQuantity: 10,
    });
    fake.setStock(SEED.products.p13, 0);
    fake.setStock(SEED.products.p20, 0);

    const result = await runTurn(summary, tapped('confirm'), ctx);

    // Sem descartar o cache, o P20 (esgotado) ainda apareceria como opção.
    expect(result.replies[0]?.buttons?.map((b) => b.id)).toEqual([
      `product:${SEED.products.p45}`,
      'human',
    ]);
  });
});
