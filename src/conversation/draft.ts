import type { PaymentType } from '../revgas/revgas.types.js';
import {
  findBySize,
  matchPayment,
  offeredPayments,
  sellable,
  type CatalogProduct,
} from './catalog.js';
import type { Draft, Expecting, Reply, Signal } from './conversation.types.js';

export type Field = 'product' | 'address' | 'payment' | 'name';

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
  if (signal.button === 'address:saved' && next.customer?.savedAddress) {
    next.address = next.customer.savedAddress;
  }

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

  return { draft: next, notices };
}

/** Próximo campo a pedir, na ordem do PRD. `null` = pronto para o resumo. */
export function missingField(draft: Draft): Field | null {
  if (!draft.item) return 'product';
  if (!draft.address) return 'address';
  if (!draft.payment) return 'payment';
  if (draft.customer?.id === null && !draft.customer.name) return 'name';
  return null;
}

export const EXPECTING_BY_FIELD: Readonly<Record<Field, Expecting>> = {
  product: 'product',
  address: 'address',
  payment: 'payment',
  name: 'name',
};

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
      const saved = draft.customer?.savedAddress;
      return saved
        ? {
            text: `Entrego no endereço de sempre (${formatAddress(saved)}) ou em outro? Se for outro, me diga rua, número e bairro.`,
            buttons: [{ id: 'address:saved', label: 'Endereço de sempre' }],
          }
        : { text: 'Qual o endereço de entrega? Rua, número e bairro.' };
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
  const lines = [
    header ?? 'Confere o pedido:',
    item
      ? `${item.quantity}x ${item.description} (${money(item.unitValue)} cada)`
      : '',
    draft.address ? `Entrega: ${formatAddress(draft.address)}` : '',
    `Pagamento na entrega: ${payment ?? ''}`,
    `Total: ${money(total(draft))}`,
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

export function money(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function valueOf(button: string | null, prefix: string): string | null {
  return button?.startsWith(`${prefix}:`)
    ? button.slice(prefix.length + 1)
    : null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
