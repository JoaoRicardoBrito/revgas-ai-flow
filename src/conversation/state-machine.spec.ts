import { describe, expect, it } from 'vitest';
import { SEED } from '../revgas/fake/seed.js';
import { emptyDraft, type SessionState } from './conversation.types.js';
import {
  HANDLERS,
  markDispatched,
  runTurn,
  signalFromButton,
} from './state-machine.js';
import {
  fakeRevgas,
  fullAddress,
  NOT_UNDERSTOOD,
  said,
  tapped,
} from './testing.js';
import { IllegalTransitionError } from './transitions.js';

const RECURRING = SEED.recurringCustomer.phone;
const NEW_PHONE = '5586988880000';

function setup(contact = NEW_PHONE) {
  const { fake, revgas, catalog } = fakeRevgas();
  const ctx = { revgas, catalog, contact };
  const start: SessionState = { step: 'identifying', draft: emptyDraft() };
  return { fake, revgas, ctx, start };
}

async function atSummary(contact = RECURRING) {
  const s = setup(contact);
  const summary = await runTurn(
    s.start,
    said({ intent: 'repeat_last' }),
    s.ctx,
  );
  return { ...s, summary };
}

async function afterSale() {
  const s = await atSummary();
  const sold = await runTurn(s.summary, tapped('confirm'), s.ctx);
  return { ...s, sold };
}

describe('cliente recorrente', () => {
  it('"o mesmo de sempre" vai direto ao resumo e cria a venda com um toque', async () => {
    const { fake, ctx, start } = setup(RECURRING);

    const offer = await runTurn(start, said({ intent: 'repeat_last' }), ctx);

    expect(offer.step).toBe('confirming');
    expect(offer.events).toContainEqual({
      type: 'customer_identified',
      customerId: SEED.recurringCustomer.id,
    });
    expect(offer.replies[0]?.text).toMatch(/Mesmo pedido de sempre\?/);
    expect(offer.replies[0]?.text).toMatch(/GLP 13KG/);
    expect(offer.replies[0]?.buttons?.map((b) => b.id)).toEqual([
      'confirm',
      'change',
      'cancel',
    ]);

    const done = await runTurn(offer, tapped('confirm'), ctx);

    expect(done.step).toBe('sale_created');
    const saleEvent = done.events.find((e) => e.type === 'sale_created');
    expect(saleEvent).toBeDefined();
    const sale = fake.sales.at(-1);
    expect(sale).toMatchObject({
      channel: 'WHATSAPP',
      origin: 'INTEGRATION',
      customer_id: SEED.recurringCustomer.id,
      total: 120,
    });
  });
});

describe('cliente novo', () => {
  it('pede só o que falta e cria cliente e venda', async () => {
    const { fake, ctx, start } = setup();

    const first = await runTurn(
      start,
      said({ productSizeKg: 13, address: fullAddress, paymentMethod: 'pix' }),
      ctx,
    );
    expect(first.step).toBe('collecting');
    expect(first.draft.expecting).toBe('name');
    expect(first.replies[0]?.text).toMatch(/nome/);

    const named = await runTurn(
      first,
      said({ customerName: 'Ana Teste' }),
      ctx,
    );
    expect(named.step).toBe('confirming');
    expect(named.replies[0]?.text).toMatch(/Rua Nova, 45 - Fátima/);
    expect(named.replies[0]?.text).toMatch(/Total: R\$\s?120,00/);

    const done = await runTurn(named, tapped('confirm'), ctx);
    expect(done.step).toBe('sale_created');
    const customer = fake.customers.find((c) => c.name === 'Ana Teste');
    expect(customer?.phones).toEqual([NEW_PHONE]);
    expect(fake.sales.at(-1)?.customer_id).toBe(customer?.id);
  });

  it('oferece produtos e formas de pagamento em botões', async () => {
    const { ctx, start } = setup();

    // Cliente novo: a pergunta pede tudo junto, com os botões de produto.
    const askProduct = await runTurn(start, said({ intent: 'greeting' }), ctx);
    expect(askProduct.draft.expecting).toBe('anything');
    const productButtons = askProduct.replies[0]?.buttons ?? [];
    expect(productButtons.map((b) => b.id)).toEqual([
      `product:${SEED.products.p13}`,
      `product:${SEED.products.p20}`,
      `product:${SEED.products.p45}`,
    ]);

    const askAddress = await runTurn(
      askProduct,
      tapped(`product:${SEED.products.p20}`),
      ctx,
    );
    expect(askAddress.draft.item?.description).toBe('GLP 20KG');
    expect(askAddress.replies[0]?.text).toMatch(/endereço/);
    expect(askAddress.replies[0]?.text).not.toMatch(/botijão/);

    const askPayment = await runTurn(
      askAddress,
      said({ address: fullAddress }),
      ctx,
    );
    expect(askPayment.replies[0]?.text).toMatch(/como vai pagar/);
    expect(askPayment.replies[0]?.buttons?.map((b) => b.id)).toContain(
      'payment:PIX',
    );
    expect(askPayment.replies[0]?.buttons?.map((b) => b.id)).not.toContain(
      'payment:VALEGAS',
    );
  });

  it('avisa quando o tamanho pedido não existe', async () => {
    const { ctx, start } = setup();

    const result = await runTurn(start, said({ productSizeKg: 90 }), ctx);

    expect(result.replies[0]?.text).toMatch(/não temos botijão de 90 kg/);
    expect(result.draft.item).toBeNull();
  });
});

describe('confirmação', () => {
  it('"Alterar" mostra o menu e limpa só o campo escolhido', async () => {
    const { ctx, summary } = await atSummary();

    const menu = await runTurn(summary, tapped('change'), ctx);
    expect(menu.step).toBe('confirming');
    expect(menu.replies[0]?.buttons?.map((b) => b.id)).toEqual([
      'change:product',
      'change:address',
      'change:payment',
    ]);

    const askAddress = await runTurn(menu, tapped('change:address'), ctx);
    expect(askAddress.step).toBe('collecting');
    expect(askAddress.draft.address).toBeNull();
    expect(askAddress.draft.item).not.toBeNull();
    expect(askAddress.replies[0]?.buttons?.[0]?.id).toBe('address:0');
  });

  it('produto esgotado antes de confirmar volta a perguntar o produto', async () => {
    const { fake, ctx, summary } = await atSummary();
    fake.setStock(SEED.products.p13, 0);

    const result = await runTurn(summary, tapped('confirm'), ctx);

    expect(result.step).toBe('collecting');
    expect(result.draft.item).toBeNull();
    expect(result.replies[0]?.text).toMatch(/acabou agora/);
    expect(result.events).toEqual([]);
  });

  it('pagamento recusado volta a perguntar a forma de pagamento', async () => {
    const { fake, ctx, summary } = await atSummary();
    fake.declinePayment();

    const result = await runTurn(summary, tapped('confirm'), ctx);

    expect(result.step).toBe('collecting');
    expect(result.draft.payment).toBeNull();
    expect(result.draft.expecting).toBe('payment');
  });

  it('falha ao criar a venda mantém o resumo para tentar de novo', async () => {
    const { fake, ctx, summary } = await atSummary();
    fake.failNext(1, 500, { method: 'POST', path: '/sales' });

    const result = await runTurn(summary, tapped('confirm'), ctx);

    expect(result.step).toBe('confirming');
    expect(result.events).toEqual([]);
    expect(result.replies[0]?.buttons?.[0]?.id).toBe('confirm');

    const retried = await runTurn(result, tapped('confirm'), ctx);
    expect(retried.step).toBe('sale_created');
  });

  it('RevGás fora numa consulta: mantém etapa e rascunho e oferece atendente', async () => {
    const { fake, ctx, summary } = await atSummary();
    fake.failNext(1, 500, { method: 'GET', path: '/products' });

    const result = await runTurn(summary, tapped('confirm'), ctx);

    expect(result.step).toBe('confirming');
    expect(result.draft).toEqual(summary.draft);
    expect(result.replies[0]?.buttons).toEqual([
      { id: 'human', label: 'Falar com atendente' },
    ]);
  });

  it('cancelar antes da venda encerra sem criar nada', async () => {
    const { fake, ctx, summary } = await atSummary();
    const salesBefore = fake.sales.length;

    const result = await runTurn(summary, tapped('cancel'), ctx);

    expect(result.step).toBe('closed');
    expect(result.events).toEqual([
      {
        type: 'closed',
        status: 'canceled',
        reason: 'desistiu antes da venda (no resumo)',
      },
    ]);
    expect(fake.sales).toHaveLength(salesBefore);
  });
});

describe('depois da venda', () => {
  it('cancelar antes do despacho pergunta o motivo e só então cancela', async () => {
    const { fake, ctx, sold } = await afterSale();

    const ask = await runTurn(sold, said({ intent: 'cancel' }), ctx);
    expect(ask.step).toBe('sale_created');
    expect(fake.sales.at(-1)?.status).not.toBe('CANCEL');

    const result = await runTurn(ask, tapped('cancel_motive:1'), ctx);

    expect(result.step).toBe('closed');
    expect(fake.sales.at(-1)?.status).toBe('CANCEL');
    expect(result.events.map((e) => e.type)).toEqual([
      'sale_canceled',
      'closed',
    ]);
  });

  it('despachado: cancelar vai para o atendente', async () => {
    const { ctx, sold } = await afterSale();
    const dispatched = markDispatched(sold);
    expect(dispatched.step).toBe('dispatched');

    const result = await runTurn(dispatched, said({ intent: 'cancel' }), ctx);

    expect(result.step).toBe('closed');
    expect(result.events[0]).toMatchObject({ type: 'handoff' });
  });

  it('não marca despacho de quem ainda não comprou', () => {
    expect(() =>
      markDispatched({ step: 'collecting', draft: emptyDraft() }),
    ).toThrow(IllegalTransitionError);
  });
});

describe('regras de qualquer etapa', () => {
  it('handler que devolve transição proibida é barrado', async () => {
    const { ctx } = setup();
    const broken = {
      ...HANDLERS,
      collecting: (state: SessionState) =>
        Promise.resolve({
          ...state,
          step: 'sale_created' as const,
          replies: [],
          events: [],
        }),
    };

    await expect(
      runTurn(
        { step: 'collecting', draft: emptyDraft() },
        said({}),
        ctx,
        broken,
      ),
    ).rejects.toThrow(IllegalTransitionError);
  });

  it.each([
    'identifying',
    'collecting',
    'confirming',
    'sale_created',
    'dispatched',
  ] as const)('pedir atendente em %s encerra com handoff', async (step) => {
    const { ctx } = setup();

    const result = await runTurn(
      { step, draft: emptyDraft() },
      signalFromButton('human'),
      ctx,
    );

    expect(result.step).toBe('closed');
    expect(result.events).toEqual([
      { type: 'handoff', reason: 'cliente pediu atendente' },
    ]);
  });

  it('sem entender duas vezes passa para o atendente', async () => {
    const { ctx, start } = setup();
    const asking = await runTurn(start, said({ intent: 'greeting' }), ctx);

    const once = await runTurn(asking, NOT_UNDERSTOOD, ctx);
    expect(once.step).toBe('collecting');
    expect(once.replies[0]?.text).toMatch(/^Não entendi\./);
    expect(once.replies[0]?.buttons?.length).toBeGreaterThan(0);

    const twice = await runTurn(once, NOT_UNDERSTOOD, ctx);
    expect(twice.step).toBe('closed');
    expect(twice.events[0]).toMatchObject({ type: 'handoff' });
  });

  it('entender de novo zera a contagem', async () => {
    const { ctx, start } = setup();
    const asking = await runTurn(start, said({ intent: 'greeting' }), ctx);
    const once = await runTurn(asking, NOT_UNDERSTOOD, ctx);

    const understood = await runTurn(once, said({ productSizeKg: 13 }), ctx);

    expect(understood.draft.misunderstandings).toBe(0);
  });
});
