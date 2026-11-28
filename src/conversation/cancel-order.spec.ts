/** Issue #12: cancelamento por estado do pedido (PRD 6.1). */
import { describe, expect, it } from 'vitest';
import { SEED } from '../revgas/fake/seed.js';
import { emptyDraft, type SessionState } from './conversation.types.js';
import { runTurn } from './state-machine.js';
import { fakeRevgas, fullAddress, said, tapped } from './testing.js';

const RECURRING = SEED.recurringCustomer.phone;
const start: SessionState = { step: 'identifying', draft: emptyDraft() };

function setup(contact: string = RECURRING) {
  const { fake, revgas, catalog } = fakeRevgas();
  return { fake, ctx: { revgas, catalog, contact } };
}

/** Recorrente com a venda já criada. */
async function sold() {
  const s = setup();
  const summary = await runTurn(start, said({ intent: 'repeat_last' }), s.ctx);
  const sale = await runTurn(summary, tapped('confirm'), s.ctx);
  const saleId = sale.draft.saleId ?? 0;
  const fakeSale = () => s.fake.sales.find((x) => x.id === saleId);
  return { ...s, sale, saleId, fakeSale };
}

const ids = (reply: { buttons?: { id: string }[] } | undefined) =>
  reply?.buttons?.map((b) => b.id) ?? [];

describe('antes da venda: encerra a conversa', () => {
  it('coletando dados: encerra e registra a etapa como motivo', async () => {
    const { ctx, fake } = setup('5586944440001');
    const asking = await runTurn(start, said({ intent: 'greeting' }), ctx);
    const salesBefore = fake.sales.length;

    const result = await runTurn(asking, said({ intent: 'cancel' }), ctx);

    expect(result.step).toBe('closed');
    expect(result.events).toEqual([
      {
        type: 'closed',
        status: 'canceled',
        reason: 'desistiu antes da venda (coletando dados)',
      },
    ]);
    expect(fake.sales).toHaveLength(salesBefore);
  });
});

describe('venda criada e não despachada: o bot cancela, perguntando o motivo', () => {
  it('"cancela" só pergunta o motivo, com os motivos ativos da RevGás em botões', async () => {
    const { ctx, sale, fakeSale } = await sold();

    const ask = await runTurn(sale, said({ intent: 'cancel' }), ctx);

    expect(ask.step).toBe('sale_created');
    expect(ask.draft.pendingCancel).toBe(true);
    expect(ask.replies[0]?.text).toMatch(
      /Por que você quer cancelar o pedido nº/,
    );
    // O motivo inativo ("Motivo antigo") não aparece.
    expect(ids(ask.replies[0])).toEqual([
      `cancel_motive:${SEED.cancelMotive}`,
      'cancel_motive:2',
      'cancel_motive:keep',
    ]);
    expect(ask.replies[0]?.presentation).toBe('buttons');
    expect(fakeSale()?.status).not.toBe('CANCEL');
    expect(ask.events).toEqual([]);
  });

  it('o motivo escolhido vai para a RevGás e para o evento de cancelamento', async () => {
    const { ctx, sale, fake, fakeSale } = await sold();
    const stockBefore = fake.products.find(
      (p) => p.id === SEED.products.p13,
    )?.stock_quantity;
    const ask = await runTurn(sale, said({ intent: 'cancel' }), ctx);

    const result = await runTurn(ask, tapped('cancel_motive:2'), ctx);

    expect(result.step).toBe('closed');
    expect(result.replies[0]?.text).toMatch(/cancelado\./);
    expect(fakeSale()).toMatchObject({ status: 'CANCEL', cancel_motive_id: 2 });
    expect(result.events).toEqual([
      {
        type: 'sale_canceled',
        saleId: sale.draft.saleId,
        reason: 'Pedido duplicado',
      },
      { type: 'closed', status: 'canceled', reason: 'Pedido duplicado' },
    ]);
    // O estoque da venda volta.
    expect(
      fake.products.find((p) => p.id === SEED.products.p13)?.stock_quantity,
    ).toBe((stockBefore ?? 0) + 1);
  });

  it('"Não cancelar" mantém o pedido', async () => {
    const { ctx, sale, fakeSale } = await sold();
    const ask = await runTurn(sale, said({ intent: 'cancel' }), ctx);

    const result = await runTurn(ask, tapped('cancel_motive:keep'), ctx);

    expect(result.step).toBe('sale_created');
    expect(result.draft.pendingCancel).toBe(false);
    expect(result.events).toEqual([]);
    expect(fakeSale()?.status).not.toBe('CANCEL');
  });

  it('texto solto na pergunta do motivo não cancela: pergunta de novo', async () => {
    const { ctx, sale, fakeSale } = await sold();
    const ask = await runTurn(sale, said({ intent: 'cancel' }), ctx);

    const result = await runTurn(ask, said({ intent: 'cancel' }), ctx);

    expect(result.draft.pendingCancel).toBe(true);
    expect(result.replies[0]?.text).toMatch(/^Escolha um dos motivos abaixo\./);
    expect(fakeSale()?.status).not.toBe('CANCEL');
  });

  it.each(['cancel_motive:3', 'cancel_motive:999', 'cancel_motive:abc'])(
    'botão com motivo inativo ou inexistente (%s) é ignorado',
    async (button) => {
      const { ctx, sale, fakeSale } = await sold();
      const ask = await runTurn(sale, said({ intent: 'cancel' }), ctx);

      const result = await runTurn(ask, tapped(button), ctx);

      expect(result.step).toBe('sale_created');
      expect(result.draft.pendingCancel).toBe(true);
      expect(fakeSale()?.status).not.toBe('CANCEL');
    },
  );

  it('a RevGás recusa o cancelamento (ex.: já conferida): atendente', async () => {
    const { ctx, sale, fake, saleId } = await sold();
    const ask = await runTurn(sale, said({ intent: 'cancel' }), ctx);
    fake.setSaleStatus(saleId, 'CHECK');

    const result = await runTurn(ask, tapped('cancel_motive:1'), ctx);

    expect(result.step).toBe('closed');
    expect(result.events).toEqual([
      { type: 'handoff', reason: 'cancelamento recusado pela RevGás' },
    ]);
  });

  it('falha temporária ao cancelar: mantém a pergunta e dá para tentar de novo', async () => {
    const { ctx, sale, fake, saleId, fakeSale } = await sold();
    const ask = await runTurn(sale, said({ intent: 'cancel' }), ctx);
    fake.failNext(1, 500, { method: 'PUT', path: `/sales/${saleId}/cancel` });

    const failed = await runTurn(ask, tapped('cancel_motive:1'), ctx);
    expect(failed.step).toBe('sale_created');
    expect(failed.draft.pendingCancel).toBe(true);
    expect(failed.replies[0]?.text).toMatch(/Não consegui cancelar agora/);
    expect(ids(failed.replies[0])).toContain('cancel_motive:1');
    expect(failed.events).toEqual([]);

    const retried = await runTurn(failed, tapped('cancel_motive:1'), ctx);

    expect(retried.step).toBe('closed');
    expect(fakeSale()?.status).toBe('CANCEL');
  });

  it('sem motivo ativo cadastrado: atendente', async () => {
    const { ctx, sale, fake } = await sold();
    for (const m of fake.cancelMotives) m.status = false;

    const result = await runTurn(sale, said({ intent: 'cancel' }), ctx);

    expect(result.events).toEqual([
      { type: 'handoff', reason: 'cancelamento sem motivo cadastrado' },
    ]);
  });

  it('muitos motivos: 9 mais "Não cancelar", em lista', async () => {
    const { ctx, sale, fake } = await sold();
    for (let i = 0; i < 12; i++) {
      fake.cancelMotives.push({
        id: 100 + i,
        description: `Motivo ${i}`,
        status: true,
      });
    }

    const ask = await runTurn(sale, said({ intent: 'cancel' }), ctx);

    const buttons = ids(ask.replies[0]);
    expect(buttons).toHaveLength(10);
    expect(buttons.at(-1)).toBe('cancel_motive:keep');
    expect(ask.replies[0]?.presentation).toBe('list');
  });

  it('rótulos dos motivos cabem no limite de 20 caracteres', async () => {
    const { ctx, sale, fake } = await sold();
    fake.cancelMotives.push({
      id: 50,
      description: 'Cliente achou o preço do botijão muito alto',
      status: true,
    });

    const ask = await runTurn(sale, said({ intent: 'cancel' }), ctx);

    for (const b of ask.replies[0]?.buttons ?? []) {
      expect(b.label.length).toBeLessThanOrEqual(20);
    }
  });
});

describe('despachado: vai para o atendente', () => {
  it('a revenda despachou (entregador atribuído): "cancela" vira atendente, sem cancelar', async () => {
    const { ctx, sale, fake, saleId, fakeSale } = await sold();
    fake.dispatchSale(saleId);

    const result = await runTurn(sale, said({ intent: 'cancel' }), ctx);

    expect(result.step).toBe('closed');
    expect(result.events).toEqual([
      { type: 'handoff', reason: 'cancelamento ou reclamação após despacho' },
    ]);
    expect(fakeSale()?.status).not.toBe('CANCEL');
  });

  it('status WARNING (avisada) também conta como despachada', async () => {
    const { ctx, sale, fake, saleId } = await sold();
    fake.setSaleStatus(saleId, 'WARNING');

    const result = await runTurn(sale, said({ intent: 'cancel' }), ctx);

    expect(result.events[0]).toMatchObject({ type: 'handoff' });
  });

  it('despachou entre a pergunta do motivo e a resposta: não cancela', async () => {
    const { ctx, sale, fake, saleId, fakeSale } = await sold();
    const ask = await runTurn(sale, said({ intent: 'cancel' }), ctx);
    fake.dispatchSale(saleId);

    const result = await runTurn(ask, tapped('cancel_motive:1'), ctx);

    expect(result.step).toBe('dispatched');
    expect(result.draft.pendingCancel).toBe(false);
    expect(fakeSale()?.status).not.toBe('CANCEL');
    expect(fake.requests.some((r) => r.path.endsWith('/cancel'))).toBe(false);
  });

  it('reclamação depois do despacho: atendente', async () => {
    const { ctx, sale, fake, saleId } = await sold();
    fake.dispatchSale(saleId);

    const result = await runTurn(sale, said({ intent: 'complaint' }), ctx);

    expect(result.events[0]).toMatchObject({ type: 'handoff' });
  });
});

describe('entregue: sem cancelamento, reclamação vai ao atendente', () => {
  it('"cancela" depois da entrega é recusado, com botão de atendente', async () => {
    const { ctx, sale, fake, saleId, fakeSale } = await sold();
    fake.deliverSale(saleId);

    const result = await runTurn(sale, said({ intent: 'cancel' }), ctx);

    expect(result.step).toBe('delivered');
    expect(result.replies[0]?.text).toMatch(
      /já foi entregue, então não dá mais para cancelar nem alterar/,
    );
    expect(ids(result.replies[0])).toEqual(['human']);
    expect(fakeSale()?.status).not.toBe('CANCEL');
    expect(fake.requests.some((r) => r.path.endsWith('/cancel'))).toBe(false);
  });

  it('reclamação depois da entrega: atendente', async () => {
    const { ctx, sale, fake, saleId } = await sold();
    fake.deliverSale(saleId);

    const result = await runTurn(sale, said({ intent: 'complaint' }), ctx);

    expect(result.step).toBe('closed');
    expect(result.events).toEqual([
      { type: 'handoff', reason: 'reclamação após entrega' },
    ]);
  });

  it('trocar produto ou endereço depois da entrega também é recusado', async () => {
    const { ctx, sale, fake, saleId } = await sold();
    fake.deliverSale(saleId);
    const delivered = await runTurn(sale, said({ intent: 'cancel' }), ctx);

    const product = await runTurn(
      delivered,
      said({ intent: 'change_product', productSizeKg: 20 }),
      ctx,
    );
    const address = await runTurn(
      delivered,
      said({ intent: 'change_address', address: fullAddress }),
      ctx,
    );

    expect(product.step).toBe('delivered');
    expect(address.step).toBe('delivered');
  });

  it('outra mensagem depois da entrega agradece e encerra a conversa', async () => {
    const { ctx, sale, fake, saleId } = await sold();
    fake.deliverSale(saleId);

    const result = await runTurn(sale, said({ intent: 'greeting' }), ctx);

    expect(result.step).toBe('closed');
    expect(result.replies[0]?.text).toMatch(/foi entregue\. Obrigado!/);
    expect(result.events).toEqual([{ type: 'closed', status: 'completed' }]);
  });
});

describe('o estado real do pedido vem da RevGás', () => {
  it('cancelada pela revenda: avisa, encerra e registra o motivo', async () => {
    const { ctx, sale, fake, saleId } = await sold();
    fake.setSaleStatus(saleId, 'CANCEL');

    const result = await runTurn(sale, said({ intent: 'greeting' }), ctx);

    expect(result.step).toBe('closed');
    expect(result.replies[0]?.text).toMatch(/foi cancelado pela revenda/);
    expect(result.events).toEqual([
      { type: 'sale_canceled', saleId, reason: 'cancelada pela revenda' },
      { type: 'closed', status: 'canceled', reason: 'cancelada pela revenda' },
    ]);
  });

  it('RevGás fora ao conferir o pedido: não age às cegas', async () => {
    const { ctx, sale, fake, saleId } = await sold();
    fake.failNext(1, 500, { method: 'GET', path: `/sales/${saleId}` });

    const result = await runTurn(sale, said({ intent: 'cancel' }), ctx);

    expect(result.step).toBe('sale_created');
    expect(result.draft).toEqual(sale.draft);
    expect(ids(result.replies[0])).toEqual(['human']);
    expect(fake.requests.some((r) => r.path.endsWith('/cancel'))).toBe(false);
  });

  it('pedir atendente não precisa consultar a RevGás', async () => {
    const { ctx, sale, fake } = await sold();
    const callsBefore = fake.requests.length;

    const result = await runTurn(sale, tapped('human'), ctx);

    expect(result.events).toEqual([
      { type: 'handoff', reason: 'cliente pediu atendente' },
    ]);
    expect(fake.requests).toHaveLength(callsBefore);
  });
});
