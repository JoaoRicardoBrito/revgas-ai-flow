/** Issue #10: formas de pagamento, Pix fictício e pagamento recusado. */
import { describe, expect, it } from 'vitest';
import { SEED } from '../revgas/fake/seed.js';
import type { PaymentType } from '../revgas/revgas.types.js';
import { authorizedPaymentsFor, offeredPayments } from './catalog.js';
import { emptyDraft, type SessionState } from './conversation.types.js';
import { present, runTurn } from './state-machine.js';
import { fakeRevgas, fullAddress, said, tapped } from './testing.js';

const RECURRING = SEED.recurringCustomer.phone;
const NEW_PHONE = '5586911110000';
const start: SessionState = { step: 'identifying', draft: emptyDraft() };

function setup(contact: string = NEW_PHONE, pixDemo = true) {
  const { fake, revgas, catalog } = fakeRevgas();
  return {
    fake,
    ctx: {
      revgas,
      catalog,
      contact,
      settings: { cpfRequired: false, pixDemo },
    },
  };
}

const newOrder = (fields = {}) =>
  said({
    productSizeKg: 13,
    address: fullAddress,
    customerName: 'Ana Teste',
    ...fields,
  });

function buttonsOf(n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: `${i}`, label: `${i}` }));
}

function pt(code: PaymentType['code']): PaymentType {
  return { id: 1, code, description: code };
}

const ids = (reply: { buttons?: { id: string }[] } | undefined) =>
  reply?.buttons?.map((b) => b.id) ?? [];

describe('formas listadas da API, em botões ou lista', () => {
  it('cliente novo vê dinheiro, Pix e cartões, nessa ordem, em lista', async () => {
    const { ctx } = setup();

    const ask = await runTurn(start, newOrder(), ctx);

    expect(ask.draft.expecting).toBe('payment');
    expect(ids(ask.replies[0])).toEqual([
      'payment:MONEY',
      'payment:PIX',
      'payment:CARTAO_DE_DEBITO',
      'payment:CARTAO_DE_CREDITO',
    ]);
    expect(ask.replies[0]?.presentation).toBe('list');
    expect(ask.replies[0]?.text).toMatch(/na entrega/);
  });

  it('só oferece formas ativas na revenda', async () => {
    const { ctx, fake } = setup();
    for (const t of fake.paymentTypes) {
      if (t.payment_type === 'CARTAO_DE_CREDITO') t.status = 'INACTIVE';
    }

    const ask = await runTurn(start, newOrder(), ctx);

    expect(ids(ask.replies[0])).toEqual([
      'payment:MONEY',
      'payment:PIX',
      'payment:CARTAO_DE_DEBITO',
    ]);
    expect(ask.replies[0]?.presentation).toBe('buttons');
  });

  it('recorrente vê primeiro a forma do último pedido', async () => {
    const { ctx } = setup(RECURRING);
    const summary = await runTurn(start, said({ intent: 'repeat_last' }), ctx);
    const menu = await runTurn(summary, tapped('change'), ctx);

    const ask = await runTurn(menu, tapped('change:payment'), ctx);

    expect(ids(ask.replies[0])[0]).toBe('payment:PIX');
  });

  it('não oferece boleto nem transferência (cobrança antecipada)', async () => {
    const { ctx } = setup(RECURRING);
    const summary = await runTurn(start, said({ intent: 'repeat_last' }), ctx);
    const menu = await runTurn(summary, tapped('change'), ctx);

    const ask = await runTurn(menu, tapped('change:payment'), ctx);

    expect(ids(ask.replies[0])).not.toContain('payment:FETLOCK');
  });

  it('present: até 3 opções em botões, mais que isso em lista, sem opções nada', () => {
    expect(present({ text: 'x', buttons: buttonsOf(3) }).presentation).toBe(
      'buttons',
    );
    expect(present({ text: 'x', buttons: buttonsOf(4) }).presentation).toBe(
      'list',
    );
    expect(present({ text: 'x' }).presentation).toBeUndefined();
  });
});

describe('fiado e vale gás só para clientes autorizados', () => {
  it('cliente novo não vê fiado nem vale gás', async () => {
    const { ctx } = setup();

    const ask = await runTurn(start, newOrder(), ctx);

    expect(ids(ask.replies[0])).not.toContain('payment:CREDITO_CLIENTE');
    expect(ids(ask.replies[0])).not.toContain('payment:VALEGAS');
  });

  it('cliente autorizado vê fiado e vale gás', async () => {
    const { ctx } = setup(RECURRING);
    const summary = await runTurn(start, said({ intent: 'repeat_last' }), ctx);
    const menu = await runTurn(summary, tapped('change'), ctx);

    const ask = await runTurn(menu, tapped('change:payment'), ctx);

    expect(ids(ask.replies[0])).toEqual(
      expect.arrayContaining(['payment:CREDITO_CLIENTE', 'payment:VALEGAS']),
    );
  });

  it('cliente cadastrado sem crédito nem categoria não vê fiado nem vale gás', async () => {
    const { ctx } = setup(SEED.customerWithoutSales.phone);

    const ask = await runTurn(
      start,
      said({ productSizeKg: 13, address: fullAddress }),
      ctx,
    );

    expect(ids(ask.replies[0])).not.toContain('payment:CREDITO_CLIENTE');
    expect(ids(ask.replies[0])).not.toContain('payment:VALEGAS');
  });

  it('pedir vale gás sem autorização avisa e pergunta de novo', async () => {
    const { ctx } = setup();

    const result = await runTurn(
      start,
      newOrder({ paymentMethod: 'vale_gas' }),
      ctx,
    );

    expect(result.draft.payment).toBeNull();
    expect(result.replies[0]?.text).toMatch(/não está disponível/);
  });

  it('botão forjado de forma restrita é ignorado', async () => {
    const { ctx } = setup();
    const ask = await runTurn(start, newOrder(), ctx);

    const result = await runTurn(ask, tapped('payment:CREDITO_CLIENTE'), ctx);

    expect(result.draft.payment).toBeNull();
  });

  it('authorizedPaymentsFor: limite de crédito e categoria "vale gás" (sem acento)', () => {
    expect(authorizedPaymentsFor({ creditLimit: 0, category: null })).toEqual(
      [],
    );
    expect(authorizedPaymentsFor({ creditLimit: 50, category: 'VIP' })).toEqual(
      ['CREDITO_CLIENTE'],
    );
    expect(
      authorizedPaymentsFor({ creditLimit: 0, category: 'Programa Vale Gas' }),
    ).toEqual(['VALEGAS']);
  });

  it('offeredPayments põe dinheiro, Pix e cartões primeiro, seja qual for a ordem da API', () => {
    const accepted = [
      pt('ELO'),
      pt('CARTAO_DE_CREDITO'),
      pt('PIX'),
      pt('CARTAO_DE_DEBITO'),
      pt('MONEY'),
    ];

    expect(offeredPayments(accepted).map((p) => p.code)).toEqual([
      'MONEY',
      'PIX',
      'CARTAO_DE_DEBITO',
      'CARTAO_DE_CREDITO',
      'ELO',
    ]);
  });

  it('offeredPayments respeita exclusão e preferência', () => {
    const accepted = [
      pt('CARTAO_DE_CREDITO'),
      pt('MONEY'),
      pt('PIX'),
      pt('VALEGAS'),
    ];

    expect(
      offeredPayments(accepted, {
        exclude: ['MONEY'],
        preferred: 'CARTAO_DE_CREDITO',
      }).map((p) => p.code),
    ).toEqual(['CARTAO_DE_CREDITO', 'PIX']);
  });
});

describe('Pix copia e cola fictício', () => {
  it('depois da venda com Pix, no modo mock, manda o código marcado como demonstração', async () => {
    const { ctx } = setup();
    const summary = await runTurn(
      start,
      newOrder({ paymentMethod: 'pix' }),
      ctx,
    );

    const sold = await runTurn(summary, tapped('confirm'), ctx);

    expect(sold.step).toBe('sale_created');
    const pix = sold.replies.find((r) => r.text.includes('Pix copia e cola'));
    expect(pix?.text).toMatch(/DEMONSTRAÇÃO, não pague/);
    expect(pix?.text).toMatch(/000201/);
  });

  it('fora do modo mock não manda Pix nenhum', async () => {
    const { ctx } = setup(NEW_PHONE, false);
    const summary = await runTurn(
      start,
      newOrder({ paymentMethod: 'pix' }),
      ctx,
    );

    const sold = await runTurn(summary, tapped('confirm'), ctx);

    expect(sold.replies.some((r) => r.text.includes('Pix'))).toBe(false);
  });

  it('pagamento em dinheiro não gera Pix', async () => {
    const { ctx } = setup();
    const summary = await runTurn(
      start,
      newOrder({ paymentMethod: 'money' }),
      ctx,
    );

    const sold = await runTurn(summary, tapped('confirm'), ctx);

    expect(sold.replies.some((r) => r.text.includes('Pix'))).toBe(false);
  });
});

describe('troco', () => {
  it('dinheiro com troco aparece no resumo e vai na observação da venda', async () => {
    const { ctx, fake } = setup();
    const summary = await runTurn(
      start,
      newOrder({ paymentMethod: 'money', changeFor: 200 }),
      ctx,
    );
    expect(summary.replies[0]?.text).toMatch(/Troco para R\$\s?200,00/);

    await runTurn(summary, tapped('confirm'), ctx);

    expect(fake.sales.at(-1)?.observation).toMatch(/Troco para R\$\s?200,00/);
  });

  it('troco dito numa mensagem depois de escolher dinheiro', async () => {
    const { ctx } = setup();
    const summary = await runTurn(
      start,
      newOrder({ paymentMethod: 'money' }),
      ctx,
    );

    const updated = await runTurn(
      summary,
      said({ intent: 'order', changeFor: 50 }),
      ctx,
    );

    expect(updated.replies[0]?.text).toMatch(/Troco para R\$\s?50,00/);
  });

  it('trocar de dinheiro para Pix apaga o troco', async () => {
    const { ctx } = setup();
    const summary = await runTurn(
      start,
      newOrder({ paymentMethod: 'money', changeFor: 100 }),
      ctx,
    );

    const updated = await runTurn(
      summary,
      said({ intent: 'change_payment', paymentMethod: 'pix' }),
      ctx,
    );

    expect(updated.draft.changeFor).toBeNull();
  });

  it('troco é ignorado em pagamento que não é dinheiro', async () => {
    const { ctx } = setup();

    const summary = await runTurn(
      start,
      newOrder({ paymentMethod: 'pix', changeFor: 200 }),
      ctx,
    );

    expect(summary.draft.changeFor).toBeNull();
    expect(summary.replies[0]?.text).not.toMatch(/Troco/);
  });
});

async function pixSummary() {
  const s = setup();
  const summary = await runTurn(
    start,
    newOrder({ paymentMethod: 'pix' }),
    s.ctx,
  );
  return { ...s, summary };
}

describe('pagamento recusado (simulado no mock)', () => {
  it('não cria a venda e oferece outra forma, sem a recusada', async () => {
    const { ctx, fake, summary } = await pixSummary();
    const salesBefore = fake.sales.length;
    fake.declinePayment();

    const result = await runTurn(summary, tapped('confirm'), ctx);

    expect(fake.sales).toHaveLength(salesBefore);
    expect(result.step).toBe('collecting');
    expect(result.replies[0]?.text).toMatch(/não foi aceito/);
    expect(ids(result.replies[0])).not.toContain('payment:PIX');
    expect(ids(result.replies[0])).toContain('payment:MONEY');
  });

  it('com outra forma, a venda sai', async () => {
    const { ctx, fake, summary } = await pixSummary();
    fake.declinePayment();
    const declined = await runTurn(summary, tapped('confirm'), ctx);

    const again = await runTurn(declined, tapped('payment:MONEY'), ctx);
    const sold = await runTurn(again, tapped('confirm'), ctx);

    expect(sold.step).toBe('sale_created');
    expect(fake.sales.at(-1)?.payments[0]?.type).toBe('MONEY');
  });

  it('na segunda recusa, passa para o atendente', async () => {
    const { ctx, fake, summary } = await pixSummary();
    fake.declinePayment(2);
    const first = await runTurn(summary, tapped('confirm'), ctx);
    const again = await runTurn(first, tapped('payment:MONEY'), ctx);

    const second = await runTurn(again, tapped('confirm'), ctx);

    expect(second.step).toBe('closed');
    expect(second.events).toEqual([
      { type: 'handoff', reason: 'problema de pagamento' },
    ]);
  });
});
