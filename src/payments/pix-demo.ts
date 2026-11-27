/**
 * Pix "copia e cola" FICTÍCIO, só para a demonstração (PRD 6.3, nível 2).
 *
 * Segue o formato do BR Code (EMV) para parecer real na tela, mas tem duas
 * travas para nenhum dinheiro se mover se alguém colar no banco:
 *
 * 1. A chave é um e-mail no domínio `.invalid` (RFC 2606): não existe e não
 *    pode ser cadastrada como chave Pix.
 * 2. O CRC16 do fim é invertido de propósito: o app do banco recusa o código
 *    como inválido antes de procurar a chave.
 */

export const DEMO_PIX_KEY = 'pix-demonstracao@revgas-ai-flow.invalid';
const DEMO_MERCHANT = 'DEMONSTRACAO NAO PAGAR';
const DEMO_CITY = 'TERESINA';

function field(id: string, value: string): string {
  return `${id}${String(value.length).padStart(2, '0')}${value}`;
}

/** CRC16-CCITT-FALSE, o mesmo do BR Code. */
export function crc16(payload: string): string {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(payload)) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export function buildDemoPixCode(input: {
  amount: number;
  saleId: number;
}): string {
  const body =
    field('00', '01') +
    field('26', field('00', 'br.gov.bcb.pix') + field('01', DEMO_PIX_KEY)) +
    field('52', '0000') +
    field('53', '986') +
    field('54', input.amount.toFixed(2)) +
    field('58', 'BR') +
    field('59', DEMO_MERCHANT) +
    field('60', DEMO_CITY) +
    field('62', field('05', `DEMO${input.saleId}`.slice(0, 25))) +
    '6304';
  // Trava 2: CRC invertido, para o código nunca ser aceito por um banco.
  const wrongCrc = (Number.parseInt(crc16(body), 16) ^ 0xffff)
    .toString(16)
    .toUpperCase()
    .padStart(4, '0');
  return body + wrongCrc;
}

export function demoPixMessage(input: {
  amount: number;
  saleId: number;
}): string {
  return [
    'Pix copia e cola (DEMONSTRAÇÃO, não pague, nenhum dinheiro é movimentado):',
    buildDemoPixCode(input),
    'Na entrega, o entregador confirma o pagamento.',
  ].join('\n');
}
