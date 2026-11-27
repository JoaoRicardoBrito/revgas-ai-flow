import type { Draft } from '../conversation.types.js';
import { applySignal } from '../draft.js';
import { advance, loadOffer, type StepHandler } from './handler.js';

/**
 * Primeira mensagem. Busca o cliente pelo telefone; se ele já comprou,
 * pré-preenche o último pedido ("o mesmo de sempre", issue #7). Em seguida
 * aplica o que a própria mensagem já trouxe e segue para o que falta.
 */
export const identifyingHandler: StepHandler = async (state, signal, ctx) => {
  const [customer] = await ctx.revgas.findCustomersByPhone(ctx.contact);
  let draft: Draft = {
    ...state.draft,
    customer: customer
      ? { id: customer.id, name: customer.name, savedAddress: customer.address }
      : { id: null, name: null, savedAddress: null },
  };

  const last = customer ? await ctx.revgas.findLastSale(customer.id) : null;
  const [lastItem] = last?.items ?? [];
  if (last && lastItem) {
    draft = {
      ...draft,
      item: { ...lastItem },
      address: last.address ?? customer?.address ?? null,
      payment: last.payments[0]?.code ?? null,
      fromLastOrder: true,
    };
  }

  const offer = await loadOffer(ctx.revgas);
  const applied = applySignal(draft, signal, offer);
  const firstName = customer?.name.split(' ')[0];
  const header = draft.fromLastOrder
    ? `Oi${firstName ? `, ${firstName}` : ''}! Mesmo pedido de sempre?`
    : undefined;
  const greeting = customer ? [] : ['Oi! Vou anotar seu pedido.'];

  return advance(
    applied.draft,
    offer,
    [...greeting, ...applied.notices],
    [{ type: 'customer_identified', customerId: customer?.id ?? null }],
    header,
  );
};
