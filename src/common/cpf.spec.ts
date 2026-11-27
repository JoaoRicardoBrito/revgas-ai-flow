import { describe, expect, it } from 'vitest';
import { findCpf, isValidCpf, maskCpf } from './cpf.js';

// CPFs fictícios, gerados só para teste.
describe('isValidCpf', () => {
  it.each(['529.982.247-25', '52998224725', '111.444.777-35'])(
    'aceita %s',
    (cpf) => {
      expect(isValidCpf(cpf)).toBe(true);
    },
  );

  it.each(['529.982.247-24', '11111111111', '123', '5299822472a', ''])(
    'recusa %s',
    (cpf) => {
      expect(isValidCpf(cpf)).toBe(false);
    },
  );
});

describe('findCpf', () => {
  it('acha o CPF no meio do texto e devolve só dígitos', () => {
    expect(findCpf('meu cpf é 529.982.247-25, obrigado')).toBe('52998224725');
  });

  it('ignora sequência inválida e pega a próxima válida', () => {
    expect(findCpf('12345678900 ou 11144477735')).toBe('11144477735');
  });

  it('não confunde telefone com CPF', () => {
    expect(findCpf('meu número é 86999990001')).toBeNull();
  });
});

describe('maskCpf', () => {
  it('mostra só os dois últimos dígitos', () => {
    expect(maskCpf('52998224725')).toBe('***.***.***-25');
  });
});
