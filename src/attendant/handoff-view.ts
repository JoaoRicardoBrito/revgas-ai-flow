import { maskCpf } from '../common/cpf.js';
import { loadState } from '../conversation/conversation.service.js';
import { formatAddress, money, total } from '../conversation/draft.js';
import type { Handoff } from '../database/conversation.store.js';
import { isOpen, type BusinessHours } from './business-hours.js';

/** O que o atendente vê de uma passagem. Dado pessoal: não logar. */
export interface HandoffView {
  id: string;
  channel: string;
  contact: string;
  reason: string;
  at: string;
  /** Pedido de atendimento feito fora do horário. */
  afterHours: boolean;
  /** Dados já coletados, para o cliente não repetir. */
  summary: { label: string; value: string }[];
  messages: { from: 'cliente' | 'bot'; text: string }[];
}

export function handoffView(
  handoff: Handoff,
  hours?: BusinessHours,
): HandoffView {
  const { conversation, metrics, messages } = handoff;
  const { draft } = loadState(conversation);
  const { customer, item, address, pendingLocation } = draft;
  const at = metrics.handedOffAt ?? conversation.updatedAt;
  const fields: [string, string | null][] = [
    [
      'Cliente',
      customer &&
        `${customer.name ?? 'nome não informado'} (${customer.id === null ? 'novo' : `cadastro ${customer.id}`})`,
    ],
    ['CPF', customer?.cpf ? maskCpf(customer.cpf) : null],
    ['Produto', item && `${item.quantity}x ${item.description}`],
    ['Total', item && money(total(draft))],
    ['Endereço', address && formatAddress(address)],
    [
      'Localização',
      pendingLocation &&
        `${pendingLocation.latitude}, ${pendingLocation.longitude}`,
    ],
    ['Pagamento', draft.payment],
    ['Troco para', draft.changeFor ? money(draft.changeFor) : null],
    ['Pagamentos recusados', draft.declinedPayments.join(', ')],
    ['Venda', metrics.revgasSaleId ? `nº ${metrics.revgasSaleId}` : null],
  ];
  return {
    id: conversation.id,
    channel: conversation.channel,
    contact: conversation.contact,
    reason: metrics.handoffReason ?? '',
    at: at.toISOString(),
    afterHours: hours ? !isOpen(hours, at) : false,
    summary: fields.flatMap(([label, value]) =>
      value ? [{ label, value }] : [],
    ),
    messages: messages.map((m) => ({
      from: m.direction === 'inbound' ? 'cliente' : 'bot',
      text: m.body,
    })),
  };
}
