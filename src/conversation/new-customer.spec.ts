/** Issue #8: cliente novo, cadastro e pedido na mesma conversa. */
import { describe, expect, it } from 'vitest';
import { SEED } from '../revgas/fake/seed.js';
import { emptyDraft, type SessionState } from './conversation.types.js';
import { runTurn } from './state-machine.js';
import { fakeRevgas, fullAddress, said, tapped } from './testing.js';

const NEW_PHONE = '5586988881234';
const VALID_CPF = '529.982.247-25'; // fictício
const start: SessionState = { step: 'identifying', draft: emptyDraft() };

function setup(contact: string = NEW_PHONE, cpfRequired = false) {
  const { fake, revgas } = fakeRevgas();
  return { fake, ctx: { revgas, contact, settings: { cpfRequired } } };
}

describe('pergunta só o que falta, numa mensagem com vários dados', () => {
  it('"oi" de cliente novo pede tudo de uma vez', async () => {
    const { ctx } = setup();

    const result = await runTurn(start, said({ intent: 'greeting' }), ctx);

    expect(result.step).toBe('collecting');
    expect(result.replies).toHaveLength(1);
    const text = result.replies[0]?.text ?? '';
    expect(text).toMatch(/numa mensagem só/);
    for (const hint of ['botijão', 'endereço', 'como vai pagar', 'seu nome']) {
      expect(text).toContain(hint);
    }
    expect(text).not.toMatch(/CPF/);
    expect(result.replies[0]?.buttons?.[0]?.id).toMatch(/^product:/);
  });

  it('uma mensagem com tudo vai direto ao resumo', async () => {
    const { ctx } = setup();

    const result = await runTurn(
      start,
      said({
        productSizeKg: 13,
        address: fullAddress,
        paymentMethod: 'money',
        customerName: 'Ana Teste',
      }),
      ctx,
    );

    expect(result.step).toBe('confirming');
  });

  it('lista só os campos que ainda faltam', async () => {
    const { ctx } = setup();

    const result = await runTurn(
      start,
      said({ productSizeKg: 13, customerName: 'Ana Teste' }),
      ctx,
    );

    const text = result.replies[0]?.text ?? '';
    expect(text).toContain('endereço');
    expect(text).toContain('como vai pagar');
    expect(text).not.toContain('botijão');
    expect(text).not.toContain('seu nome');
    expect(result.replies[0]?.buttons?.[0]?.id).toMatch(/^payment:/);
  });

  it('com um campo só faltando, pergunta só ele', async () => {
    const { ctx } = setup();

    const result = await runTurn(
      start,
      said({ productSizeKg: 13, address: fullAddress, paymentMethod: 'pix' }),
      ctx,
    );

    expect(result.replies[0]?.text).toMatch(
      /^Oi! Vou anotar seu pedido\.\nPara o cadastro, qual o seu nome\?$/,
    );
    expect(result.draft.expecting).toBe('name');
  });

  it('cliente recorrente continua com uma pergunta por vez', async () => {
    const { ctx, fake } = setup(SEED.recurringCustomer.phone);
    fake.setStock(SEED.products.p13, 0);
    for (const t of fake.paymentTypes) {
      if (t.payment_type === 'PIX') t.status = 'INACTIVE';
    }

    const result = await runTurn(start, said({ intent: 'repeat_last' }), ctx);

    expect(result.replies[0]?.text).not.toMatch(/numa mensagem só/);
    expect(result.draft.expecting).toBe('product');
  });
});

describe('CPF só quando a nota fiscal exigir', () => {
  const complete = said({
    productSizeKg: 13,
    address: fullAddress,
    paymentMethod: 'pix',
    customerName: 'Ana Teste',
  });

  it('por padrão não pede nem guarda CPF', async () => {
    const { ctx, fake } = setup();
    const summary = await runTurn(start, complete, ctx);
    expect(summary.step).toBe('confirming');
    expect(summary.replies[0]?.text).not.toMatch(/CPF/);

    await runTurn(summary, tapped('confirm'), ctx);

    expect(fake.customers.at(-1)?.cpf).toBeNull();
  });

  it('com CPF_REQUIRED, pede, valida e manda no cadastro', async () => {
    const { ctx, fake } = setup(NEW_PHONE, true);

    const ask = await runTurn(start, complete, ctx);
    expect(ask.draft.expecting).toBe('cpf');
    expect(ask.replies[0]?.text).toMatch(/A nota fiscal exige CPF/);

    const invalid = await runTurn(ask, said({}, '529.982.247-24'), ctx);
    expect(invalid.step).toBe('collecting');
    expect(invalid.replies[0]?.text).toMatch(/não parece válido/);

    const summary = await runTurn(
      invalid,
      said({}, `meu cpf é ${VALID_CPF}`),
      ctx,
    );
    expect(summary.step).toBe('confirming');
    expect(summary.replies[0]?.text).toContain('CPF: ***.***.***-25');
    expect(summary.replies[0]?.text).not.toContain(VALID_CPF);

    const done = await runTurn(summary, tapped('confirm'), ctx);
    expect(fake.customers.at(-1)?.cpf).toBe('52998224725');
    expect(done.draft.customer?.cpf).toBeNull();
  });

  it('cliente já cadastrado nunca é perguntado o CPF', async () => {
    const { ctx } = setup(SEED.recurringCustomer.phone, true);

    const result = await runTurn(start, said({ intent: 'repeat_last' }), ctx);

    expect(result.step).toBe('confirming');
    expect(result.draft.customer?.needsCpf).toBe(false);
  });
});

describe('cadastro e endereço salvos com confirmação', () => {
  it('o resumo do cliente novo mostra o nome e avisa que o endereço fica salvo', async () => {
    const { ctx } = setup();

    const summary = await runTurn(
      start,
      said({
        productSizeKg: 13,
        address: fullAddress,
        paymentMethod: 'pix',
        customerName: 'Ana Teste',
      }),
      ctx,
    );

    const text = summary.replies[0]?.text ?? '';
    expect(text).toContain('Nome: Ana Teste');
    expect(text).toMatch(/cadastro e este endereço ficam salvos/);
  });

  it('só cria o cadastro depois do Confirmar', async () => {
    const { ctx, fake } = setup();
    const before = fake.customers.length;
    const summary = await runTurn(
      start,
      said({
        productSizeKg: 13,
        address: fullAddress,
        paymentMethod: 'pix',
        customerName: 'Ana Teste',
      }),
      ctx,
    );
    expect(fake.customers).toHaveLength(before);

    await runTurn(summary, tapped('confirm'), ctx);

    expect(fake.customers).toHaveLength(before + 1);
    expect(fake.customers.at(-1)).toMatchObject({
      name: 'Ana Teste',
      phones: [NEW_PHONE],
      location: 'Rua Nova',
      number: '45',
      neighborhood: 'Fátima',
    });
  });

  it('falha na venda depois do cadastro não cria cadastro repetido', async () => {
    const { ctx, fake } = setup();
    const before = fake.customers.length;
    const summary = await runTurn(
      start,
      said({
        productSizeKg: 13,
        address: fullAddress,
        paymentMethod: 'pix',
        customerName: 'Ana Teste',
      }),
      ctx,
    );
    fake.failNext(1, 500, { method: 'POST', path: '/sales' });

    const failed = await runTurn(summary, tapped('confirm'), ctx);
    expect(failed.step).toBe('confirming');
    expect(failed.draft.customer?.id).not.toBeNull();

    const retried = await runTurn(failed, tapped('confirm'), ctx);

    expect(retried.step).toBe('sale_created');
    expect(fake.customers).toHaveLength(before + 1);
  });

  it('cliente antigo com endereço novo: oferece salvar e salva ao tocar', async () => {
    const { ctx, fake } = setup(SEED.recurringCustomer.phone);
    const summary = await runTurn(
      start,
      said({ intent: 'repeat_last', address: fullAddress }),
      ctx,
    );
    expect(summary.replies[0]?.text).toMatch(/Rua Nova, 45/);

    const sold = await runTurn(summary, tapped('confirm'), ctx);
    expect(sold.replies).toHaveLength(2);
    expect(sold.replies[1]?.text).toMatch(/Quer salvar Rua Nova, 45 - Fátima/);
    expect(sold.replies[1]?.buttons?.map((b) => b.id)).toEqual([
      'save_address:yes',
      'save_address:no',
    ]);

    const saved = await runTurn(sold, tapped('save_address:yes'), ctx);

    expect(saved.step).toBe('sale_created');
    expect(saved.replies[0]?.text).toMatch(/Endereço salvo/);
    const customer = fake.customers.find(
      (c) => c.id === SEED.recurringCustomer.id,
    );
    expect(customer).toMatchObject({ location: 'Rua Nova', number: '45' });
    // O PUT reenviou o resto do cadastro.
    expect(customer).toMatchObject({
      name: 'Maria Cliente Exemplo',
      cpf: '52998224725',
    });
  });

  it('"Agora não" não mexe no cadastro', async () => {
    const { ctx, fake } = setup(SEED.recurringCustomer.phone);
    const summary = await runTurn(
      start,
      said({ intent: 'repeat_last', address: fullAddress }),
      ctx,
    );
    const sold = await runTurn(summary, tapped('confirm'), ctx);

    const result = await runTurn(sold, tapped('save_address:no'), ctx);

    expect(result.replies[0]?.text).toMatch(/não salvei/);
    expect(
      fake.customers.find((c) => c.id === SEED.recurringCustomer.id)?.location,
    ).toBe('Rua das Flores');
  });

  it('endereço já conhecido não gera a pergunta', async () => {
    const { ctx } = setup(SEED.recurringCustomer.phone);
    const summary = await runTurn(start, said({ intent: 'repeat_last' }), ctx);

    const sold = await runTurn(summary, tapped('confirm'), ctx);

    expect(sold.replies).toHaveLength(1);
    expect(sold.draft.pendingAddressSave).toBe(false);
  });
});
