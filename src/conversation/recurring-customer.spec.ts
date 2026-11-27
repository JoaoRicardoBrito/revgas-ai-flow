/** Issue #7: cliente recorrente, "o mesmo de sempre". */
import { describe, expect, it } from 'vitest';
import { SEED } from '../revgas/fake/seed.js';
import { emptyDraft, type SessionState } from './conversation.types.js';
import { buttonLabel, BUTTON_LABEL_MAX, distinctAddresses } from './draft.js';
import { runTurn } from './state-machine.js';
import { fakeRevgas, NOT_UNDERSTOOD, said, tapped } from './testing.js';

const RECURRING = SEED.recurringCustomer.phone;
const start: SessionState = { step: 'identifying', draft: emptyDraft() };

function setup(contact: string = RECURRING) {
  const { fake, revgas, catalog } = fakeRevgas();
  return { fake, ctx: { revgas, catalog, contact } };
}

describe('cliente recorrente', () => {
  it('é reconhecido pelo telefone, com ou sem o 55', async () => {
    for (const phone of [RECURRING, RECURRING.replace(/^55/, '')]) {
      const { ctx } = setup(phone);

      const result = await runTurn(start, said({ intent: 'greeting' }), ctx);

      expect(result.events[0]).toEqual({
        type: 'customer_identified',
        customerId: SEED.recurringCustomer.id,
      });
    }
  });

  it('recebe o último pedido completo numa mensagem só', async () => {
    const { ctx } = setup();

    const result = await runTurn(start, said({ intent: 'greeting' }), ctx);

    expect(result.step).toBe('confirming');
    expect(result.replies).toHaveLength(1);
    const text = result.replies[0]?.text ?? '';
    expect(text).toMatch(/Oi, Maria! Mesmo pedido de sempre\?/);
    expect(text).toMatch(/1x GLP 13KG/);
    expect(text).toMatch(/Rua das Flores, 123 - Centro/);
    expect(text).toMatch(/Pagamento na entrega: PIX/);
    expect(text).toMatch(/Total: R\$\s?120,00/);
  });

  it('confirma com um toque depois do "oi", sem digitar mais nada', async () => {
    const { ctx, fake } = setup();

    const offer = await runTurn(start, said({ intent: 'greeting' }), ctx);
    const done = await runTurn(offer, tapped('confirm'), ctx);

    expect(done.step).toBe('sale_created');
    expect(fake.sales.at(-1)).toMatchObject({
      customer_id: SEED.recurringCustomer.id,
      location: 'Rua das Flores',
      number: '123',
      total: 120,
      payments: [expect.objectContaining({ type: 'PIX', value: 120 })],
    });
  });

  it('oferece o último pedido mesmo quando o LLM não entende o "oi"', async () => {
    const { ctx } = setup();

    const result = await runTurn(start, NOT_UNDERSTOOD, ctx);

    expect(result.step).toBe('confirming');
    expect(result.replies[0]?.text).toMatch(/Mesmo pedido de sempre\?/);
  });

  it('mantém o preço do último pedido, não o da tabela provisória', async () => {
    const { ctx, fake } = setup();
    const last = fake.sales.find((s) => s.id === SEED.lastSaleOfRecurring);
    const [item] = last?.products ?? [];
    if (!last || !item) throw new Error('seed sem a última venda');
    item.value = 110;
    last.total = 110;

    const result = await runTurn(start, said({ intent: 'repeat_last' }), ctx);

    expect(result.draft.item?.unitValue).toBe(110);
    expect(result.replies[0]?.text).toMatch(/Total: R\$\s?110,00/);
  });
});

describe('vários endereços', () => {
  it('guarda os endereços das últimas vendas sem repetir', async () => {
    const { ctx } = setup();

    const result = await runTurn(start, said({ intent: 'greeting' }), ctx);

    expect(
      result.draft.customer?.savedAddresses.map(
        (a) => `${a.street}, ${a.number}`,
      ),
    ).toEqual(['Rua das Flores, 123', 'Avenida Frei Serafim, 900']);
  });

  it('escolhe outro endereço por botão e volta ao resumo', async () => {
    const { ctx, fake } = setup();
    const offer = await runTurn(start, said({ intent: 'greeting' }), ctx);
    const menu = await runTurn(offer, tapped('change'), ctx);
    const ask = await runTurn(menu, tapped('change:address'), ctx);

    expect(ask.step).toBe('collecting');
    expect(ask.replies[0]?.buttons?.map((b) => b.id)).toEqual([
      'address:0',
      'address:1',
    ]);
    expect(ask.replies[0]?.text).toMatch(
      /2\. Avenida Frei Serafim, 900 - Centro \(Sala 2\)/,
    );

    const summary = await runTurn(ask, tapped('address:1'), ctx);
    expect(summary.step).toBe('confirming');
    expect(summary.replies[0]?.text).toMatch(/Avenida Frei Serafim, 900/);

    await runTurn(summary, tapped('confirm'), ctx);
    expect(fake.sales.at(-1)?.location).toBe('Avenida Frei Serafim');
  });

  it('botão de endereço inexistente não muda nada', async () => {
    const { ctx } = setup();
    const offer = await runTurn(start, said({ intent: 'greeting' }), ctx);
    const menu = await runTurn(offer, tapped('change'), ctx);
    const ask = await runTurn(menu, tapped('change:address'), ctx);

    const result = await runTurn(ask, tapped('address:7'), ctx);

    expect(result.draft.address).toBeNull();
    expect(result.replies[0]?.text).toMatch(/^Não entendi\./);
  });

  it('rótulos dos botões cabem no limite do WhatsApp', async () => {
    const { ctx } = setup();
    const offer = await runTurn(start, said({ intent: 'greeting' }), ctx);
    const menu = await runTurn(offer, tapped('change'), ctx);
    const ask = await runTurn(menu, tapped('change:address'), ctx);

    for (const button of ask.replies[0]?.buttons ?? []) {
      expect(button.label.length).toBeLessThanOrEqual(BUTTON_LABEL_MAX);
    }
  });
});

describe('último pedido que não dá para repetir igual', () => {
  it('produto esgotado: avisa e pergunta o produto', async () => {
    const { ctx, fake } = setup();
    fake.setStock(SEED.products.p13, 0);

    const result = await runTurn(start, said({ intent: 'repeat_last' }), ctx);

    expect(result.step).toBe('collecting');
    expect(result.draft.item).toBeNull();
    expect(result.draft.address?.street).toBe('Rua das Flores');
    expect(result.replies[0]?.text).toMatch(
      /GLP 13KG do seu último pedido está em falta/,
    );
    expect(result.replies[0]?.buttons?.[0]?.id).toMatch(/^product:/);
  });

  it('forma de pagamento desativada: pergunta só o pagamento', async () => {
    const { ctx, fake } = setup();
    for (const t of fake.paymentTypes) {
      if (t.payment_type === 'PIX') t.status = 'INACTIVE';
    }

    const result = await runTurn(start, said({ intent: 'repeat_last' }), ctx);

    expect(result.step).toBe('collecting');
    expect(result.draft.item?.description).toBe('GLP 13KG');
    expect(result.draft.payment).toBeNull();
    expect(result.draft.expecting).toBe('payment');
  });
});

describe('quem não é recorrente', () => {
  it('telefone diferente do cadastrado é cliente novo', async () => {
    const { ctx } = setup('5511912345678');

    const result = await runTurn(start, said({ intent: 'greeting' }), ctx);

    expect(result.events[0]).toEqual({
      type: 'customer_identified',
      customerId: null,
    });
    expect(result.draft.customer).toMatchObject({
      id: null,
      name: null,
      savedAddresses: [],
    });
    expect(result.draft.fromLastOrder).toBe(false);
    expect(result.replies[0]?.text).not.toMatch(/Mesmo pedido/);
  });

  it('cadastrado sem compras: usa o endereço do cadastro e não pede o nome', async () => {
    const { ctx, fake } = setup(SEED.customerWithoutSales.phone);
    const customer = fake.customers.find(
      (c) => c.id === SEED.customerWithoutSales.id,
    );
    if (customer) {
      Object.assign(customer, {
        location: 'Rua Sete',
        number: '7',
        neighborhood: 'Norte',
      });
    }

    const result = await runTurn(
      start,
      said({ productSizeKg: 13, paymentMethod: 'money' }),
      ctx,
    );

    expect(result.step).toBe('confirming');
    expect(result.replies[0]?.text).toMatch(/Rua Sete, 7 - Norte/);
    expect(result.replies[0]?.text).not.toMatch(/Mesmo pedido/);
  });
});

function addr(street: string, number = '1') {
  return { street, number, neighborhood: 'Centro' };
}

describe('apoio', () => {
  it('distinctAddresses ignora caixa, acento e vazios, até 3', () => {
    expect(
      distinctAddresses([
        addr('Rua São José'),
        null,
        addr('rua sao jose'),
        addr('B'),
        addr('C'),
        addr('D'),
      ]),
    ).toEqual([addr('Rua São José'), addr('B'), addr('C')]);
  });

  it('buttonLabel corta com reticências', () => {
    expect(buttonLabel('curto')).toBe('curto');
    expect(buttonLabel('1. Avenida Frei Serafim, 900')).toHaveLength(
      BUTTON_LABEL_MAX,
    );
    expect(buttonLabel('1. Avenida Frei Serafim, 900').endsWith('…')).toBe(
      true,
    );
  });
});
