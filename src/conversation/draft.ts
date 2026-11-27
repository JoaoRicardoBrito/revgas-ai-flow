import { findCpf, maskCpf } from '../common/cpf.js';
import type { Address, PaymentType } from '../revgas/revgas.types.js';
import {
  findBySize,
  matchPayment,
  offeredPayments,
  sellable,
  type CatalogProduct,
} from './catalog.js';
import type { Draft, Expecting, Reply, Signal } from './conversation.types.js';

export type Field = 'product' | 'address' | 'payment' | 'name' | 'cpf';

export interface Offer {
  catalog: CatalogProduct[];
  paymentTypes: PaymentType[];
}

/**
 * Aplica ao rascunho o que veio no turno (texto extraído ou botão). Só
 * aceita produto e forma de pagamento que existem na revenda.
 */
export function applySignal(
  draft: Draft,
  signal: Signal,
  offer: Offer,
): { draft: Draft; notices: string[] } {
  const next: Draft = { ...draft };
  const notices: string[] = [];
  const x = signal.extraction;

  // Produto: botão `product:<id>` ou peso citado no texto.
  const buttonProductId = valueOf(signal.button, 'product');
  const product = buttonProductId
    ? sellable(offer.catalog).find((p) => p.id === Number(buttonProductId))
    : x?.productSizeKg
      ? findBySize(offer.catalog, x.productSizeKg)
      : undefined;
  if (x?.productSizeKg && !product) {
    notices.push(`No momento não temos botijão de ${x.productSizeKg} kg.`);
  }
  if (product && product.unitValue !== null) {
    const keepLastPrice =
      next.fromLastOrder && next.item?.productId === product.id;
    next.item = {
      productId: product.id,
      description: product.description,
      quantity: x?.quantity ?? next.item?.quantity ?? 1,
      unitValue:
        keepLastPrice && next.item ? next.item.unitValue : product.unitValue,
    };
  } else if (x?.quantity && next.item) {
    next.item = { ...next.item, quantity: x.quantity };
  }

  // Endereço: completo no texto, ou o salvo por botão.
  const a = x?.address;
  if (a?.street && a.number && a.neighborhood) {
    next.address = {
      street: a.street,
      number: a.number,
      neighborhood: a.neighborhood,
      ...(a.complement ? { complement: a.complement } : {}),
      ...(a.landmark ? { landmark: a.landmark } : {}),
    };
  } else if (a?.street || a?.number || a?.neighborhood) {
    notices.push('Preciso da rua, do número e do bairro.');
  }
  const savedIndex = valueOf(signal.button, 'address');
  const saved =
    savedIndex === null
      ? undefined
      : next.customer?.savedAddresses[Number(savedIndex)];
  if (saved) next.address = saved;

  // Pagamento: botão `payment:<código>` ou forma citada no texto.
  const accepted = offeredPayments(offer.paymentTypes);
  const buttonPayment = valueOf(signal.button, 'payment');
  const payment = buttonPayment
    ? accepted.find((t) => t.code === buttonPayment)?.code
    : x?.paymentMethod
      ? matchPayment(x.paymentMethod, accepted)
      : undefined;
  if (x?.paymentMethod && !payment) {
    notices.push('Essa forma de pagamento não é aceita aqui.');
  }
  if (payment) next.payment = payment;

  // Nome: só para cliente novo.
  if (x?.customerName && next.customer && next.customer.id === null) {
    next.customer = { ...next.customer, name: x.customerName };
  }

  // CPF: lido pelo código no texto cru, e só quando a nota exige.
  if (next.customer?.needsCpf && !next.customer.cpf && signal.text) {
    const cpf = findCpf(signal.text);
    if (cpf) {
      next.customer = { ...next.customer, cpf };
    } else if (
      draft.expecting === 'cpf' &&
      /\d{6,}/.test(signal.text.replace(/\D/g, ''))
    ) {
      notices.push('Esse CPF não parece válido. Confere os números?');
    }
  }

  return { draft: next, notices };
}

/** Tudo o que falta, na ordem do PRD. Vazio = pronto para o resumo. */
export function missingFields(draft: Draft): Field[] {
  const isNew = draft.customer?.id === null;
  return [
    !draft.item && 'product',
    !draft.address && 'address',
    !draft.payment && 'payment',
    isNew && !draft.customer?.name && 'name',
    isNew && draft.customer?.needsCpf && !draft.customer.cpf && 'cpf',
  ].filter((f): f is Field => typeof f === 'string');
}

/** Próximo campo a pedir. `null` = pronto para o resumo. */
export function missingField(draft: Draft): Field | null {
  return missingFields(draft)[0] ?? null;
}

export const EXPECTING_BY_FIELD: Readonly<Record<Field, Expecting | 'cpf'>> = {
  product: 'product',
  address: 'address',
  payment: 'payment',
  name: 'name',
  cpf: 'cpf',
};

const FIELD_HINTS: Readonly<Record<Field, string>> = {
  product: 'qual botijão (P13, P20, P45...)',
  address: 'o endereço: rua, número e bairro',
  payment: 'como vai pagar na entrega (dinheiro, Pix, cartão)',
  name: 'seu nome',
  cpf: 'seu CPF (a nota fiscal exige)',
};

/**
 * Cliente novo sem vários dados: pede tudo de uma vez, para ele poder
 * responder numa mensagem só (issue #8). Os botões são do primeiro campo
 * com opções fechadas, para quem prefere tocar.
 */
export function askForMany(fields: Field[], draft: Draft, offer: Offer): Reply {
  const list = fields.map((f) => `- ${FIELD_HINTS[f]}`).join('\n');
  const closed = fields.find((f) => f === 'product' || f === 'payment');
  return {
    text: `Para anotar seu pedido, me diga numa mensagem só:\n${list}`,
    ...(closed ? { buttons: askFor(closed, draft, offer).buttons ?? [] } : {}),
  };
}

/** Pergunta pelo campo, com botões sempre que houver opções fechadas. */
export function askFor(field: Field, draft: Draft, offer: Offer): Reply {
  switch (field) {
    case 'product':
      return {
        text: 'Qual botijão você quer?',
        buttons: sellable(offer.catalog).map((p) => ({
          id: `product:${p.id}`,
          label: `${p.description} - ${money(p.unitValue ?? 0)}`,
        })),
      };
    case 'address': {
      const saved = draft.customer?.savedAddresses ?? [];
      if (saved.length === 0) {
        return { text: 'Qual o endereço de entrega? Rua, número e bairro.' };
      }
      const list = saved
        .map(
          (a, i) =>
            `${i + 1}. ${formatAddress(a)}${a.complement ? ` (${a.complement})` : ''}`,
        )
        .join('\n');
      return {
        text: `Onde entrego?\n${list}\nSe for outro, me diga rua, número e bairro.`,
        buttons: saved.map((a, i) => ({
          id: `address:${i}`,
          label: buttonLabel(`${i + 1}. ${a.street}, ${a.number}`),
        })),
      };
    }
    case 'payment':
      return {
        text: 'Como você vai pagar? O pagamento é na entrega.',
        buttons: offeredPayments(offer.paymentTypes).map((t) => ({
          id: `payment:${t.code}`,
          label: t.description,
        })),
      };
    case 'name':
      return { text: 'Para o cadastro, qual o seu nome?' };
    case 'cpf':
      return { text: 'A nota fiscal exige CPF. Qual o seu CPF?' };
    default: {
      const unknownField: never = field;
      throw new Error(`Campo desconhecido: ${String(unknownField)}`);
    }
  }
}

export function total(draft: Draft): number {
  return draft.item ? round2(draft.item.quantity * draft.item.unitValue) : 0;
}

export function summary(
  draft: Draft,
  paymentTypes: PaymentType[],
  header?: string,
): Reply {
  const item = draft.item;
  const payment =
    paymentTypes.find((t) => t.code === draft.payment)?.description ??
    draft.payment;
  const isNew = draft.customer?.id === null;
  const lines = [
    header ?? 'Confere o pedido:',
    isNew && draft.customer?.name ? `Nome: ${draft.customer.name}` : '',
    isNew && draft.customer?.cpf ? `CPF: ${maskCpf(draft.customer.cpf)}` : '',
    item
      ? `${item.quantity}x ${item.description} (${money(item.unitValue)} cada)`
      : '',
    draft.address ? `Entrega: ${formatAddress(draft.address)}` : '',
    `Pagamento na entrega: ${payment ?? ''}`,
    `Total: ${money(total(draft))}`,
    isNew
      ? 'Ao confirmar, seu cadastro e este endereço ficam salvos para os próximos pedidos.'
      : '',
  ].filter(Boolean);
  return {
    text: lines.join('\n'),
    buttons: [
      { id: 'confirm', label: 'Confirmar' },
      { id: 'change', label: 'Alterar' },
      { id: 'cancel', label: 'Cancelar' },
    ],
  };
}

export const CHANGE_MENU: Reply = {
  text: 'O que você quer mudar?',
  buttons: [
    { id: 'change:product', label: 'Produto' },
    { id: 'change:address', label: 'Endereço' },
    { id: 'change:payment', label: 'Pagamento' },
  ],
};

/** Botão `change:<campo>` limpa o campo para ser perguntado de novo. */
export function clearField(draft: Draft, button: string | null): Draft {
  switch (valueOf(button, 'change')) {
    case 'product':
      return { ...draft, item: null, fromLastOrder: false };
    case 'address':
      return { ...draft, address: null };
    case 'payment':
      return { ...draft, payment: null };
    default:
      return draft;
  }
}

export function formatAddress(a: {
  street: string;
  number: string;
  neighborhood: string;
}): string {
  return `${a.street}, ${a.number} - ${a.neighborhood}`;
}

/** Limite de título de botão do WhatsApp. */
export const BUTTON_LABEL_MAX = 20;

export function buttonLabel(text: string): string {
  return text.length <= BUTTON_LABEL_MAX
    ? text
    : `${text.slice(0, BUTTON_LABEL_MAX - 1).trimEnd()}…`;
}

/** Chave de comparação de endereço: sem caixa, acento nem espaços extras. */
function addressKey(x: Address): string {
  return [x.street, x.number, x.neighborhood]
    .join('|')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Mesmo endereço, ignorando caixa, acento e espaços. */
export function sameAddress(a: Address, b: Address): boolean {
  return addressKey(a) === addressKey(b);
}

/** Endereços distintos, na ordem dada, até `max`. */
export function distinctAddresses(
  candidates: (Address | null | undefined)[],
  max = 3,
): Address[] {
  const result: Address[] = [];
  for (const candidate of candidates) {
    if (!candidate || result.some((a) => sameAddress(a, candidate))) continue;
    result.push(candidate);
    if (result.length === max) break;
  }
  return result;
}

export function money(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function valueOf(button: string | null, prefix: string): string | null {
  return button?.startsWith(`${prefix}:`)
    ? button.slice(prefix.length + 1)
    : null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
