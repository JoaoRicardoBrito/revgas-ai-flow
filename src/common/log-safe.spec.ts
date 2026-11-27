import { describe, expect, it } from 'vitest';
import { redactText, toLogSafe } from './log-safe.js';

describe('redactText', () => {
  it.each([
    ['meu cpf é 123.456.789-09', 'meu cpf é [número removido]'],
    ['cpf 12345678909', 'cpf [número removido]'],
    ['cnpj 12.345.678/0001-95', 'cnpj [número removido]'],
    ['cep 64000-000', 'cep [número removido]'],
    ['ligue (86) 99999-0001', 'ligue [número removido]'],
    ['whats +55 86 99999-0001', 'whats [número removido]'],
  ])('%s', (input, expected) => {
    expect(redactText(input)).toBe(expected);
  });

  it('mantém números curtos', () => {
    expect(redactText('quero 2 botijões, casa 123')).toBe(
      'quero 2 botijões, casa 123',
    );
  });
});

describe('toLogSafe', () => {
  it('remove endereço, CPF e texto em qualquer nível', () => {
    const safe = toLogSafe({
      conversationId: 'c1',
      step: 'confirm',
      collected: { name: 'Maria', address: { street: 'Rua X' } },
      customer: { cpf: '12345678909', postalCode: '64000000', id: 7 },
      message: { body: 'Rua das Flores, 123', externalId: 'wamid.1' },
    });

    expect(safe).toEqual({
      conversationId: 'c1',
      step: 'confirm',
      collected: '[removido]',
      customer: { cpf: '[removido]', postalCode: '[removido]', id: 7 },
      message: { body: '[removido]', externalId: 'wamid.1' },
    });
  });

  it('não devolve CPF nem endereço em nenhum campo', () => {
    const input = {
      sale: {
        location: 'Rua das Flores',
        number: '123',
        neighborhood: 'Centro',
      },
      note: 'cliente informou cpf 123.456.789-09',
      list: [{ lat: '-5.08', lon: '-42.8' }],
    };

    const out = JSON.stringify(toLogSafe(input));

    for (const secret of [
      'Rua das Flores',
      'Centro',
      '123.456.789-09',
      '-42.8',
    ]) {
      expect(out).not.toContain(secret);
    }
  });

  it('não altera o objeto original', () => {
    const input = { cpf: '12345678909' };

    toLogSafe(input);

    expect(input.cpf).toBe('12345678909');
  });

  it('mascara a mensagem de erros', () => {
    expect(toLogSafe(new Error('cliente 86999990001 não achado'))).toEqual({
      name: 'Error',
      message: 'cliente [número removido] não achado',
    });
  });
});
