import { describe, expect, it } from 'vitest';
import {
  buildDemoPixCode,
  crc16,
  DEMO_PIX_KEY,
  demoPixMessage,
} from './pix-demo.js';

/** Lê os campos TLV de um BR Code. */
function parse(code: string): Map<string, string> {
  const fields = new Map<string, string>();
  let i = 0;
  while (i < code.length) {
    const id = code.slice(i, i + 2);
    const length = Number(code.slice(i + 2, i + 4));
    fields.set(id, code.slice(i + 4, i + 4 + length));
    i += 4 + length;
  }
  return fields;
}

describe('crc16', () => {
  it('bate com o valor de referência do CRC16-CCITT-FALSE', () => {
    expect(crc16('123456789')).toBe('29B1');
  });
});

describe('buildDemoPixCode', () => {
  const code = buildDemoPixCode({ amount: 120, saleId: 1234 });
  const fields = parse(code);

  it('tem o formato do BR Code', () => {
    expect(fields.get('00')).toBe('01');
    expect(fields.get('53')).toBe('986');
    expect(fields.get('54')).toBe('120.00');
    expect(fields.get('58')).toBe('BR');
    expect(parse(fields.get('62') ?? '').get('05')).toBe('DEMO1234');
  });

  it('trava 1: a chave é de um domínio que não existe', () => {
    const account = parse(fields.get('26') ?? '');
    expect(account.get('00')).toBe('br.gov.bcb.pix');
    expect(account.get('01')).toBe(DEMO_PIX_KEY);
    expect(DEMO_PIX_KEY.endsWith('.invalid')).toBe(true);
  });

  it('trava 2: o CRC está errado de propósito', () => {
    const body = code.slice(0, -4);
    expect(code.slice(-4)).not.toBe(crc16(body));
    expect(code.slice(-4)).toMatch(/^[0-9A-F]{4}$/);
  });

  it('diz que é demonstração no nome do recebedor', () => {
    expect(fields.get('59')).toBe('DEMONSTRACAO NAO PAGAR');
  });
});

describe('demoPixMessage', () => {
  it('avisa que é demonstração e que não movimenta dinheiro', () => {
    const message = demoPixMessage({ amount: 99.9, saleId: 1 });

    expect(message).toMatch(/DEMONSTRAÇÃO, não pague/);
    expect(message).toMatch(/nenhum dinheiro é movimentado/);
    expect(message).toContain('540599.90');
  });
});
