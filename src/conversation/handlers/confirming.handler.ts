import { RevgasError } from '../../revgas/revgas.errors.js';
import type { Draft } from '../conversation.types.js';
import {
  applySignal,
  askFor,
  CHANGE_MENU,
  clearField,
  summary,
  total,
} from '../draft.js';
import {
  advance,
  canceledBeforeSale,
  loadOffer,
  misunderstood,
  outcome,
  type StepHandler,
  type TurnContext,
} from './handler.js';

/** Resumo na tela: "sim" cria a venda; o resto ajusta ou cancela. */
export const confirmingHandler: StepHandler = async (state, signal, ctx) => {
  if (signal.intent === 'cancel') return canceledBeforeSale(state.draft);

  const offer = await loadOffer(ctx.revgas);

  if (signal.button?.startsWith('change:')) {
    return advance(clearField(state.draft, signal.button), offer, []);
  }
  if (signal.intent === 'deny') {
    return outcome('confirming', state.draft, [CHANGE_MENU]);
  }

  // Mudou algo direto no texto ("troca para o de 20"): reaplica e mostra de novo.
  const applied = applySignal(state.draft, signal, offer);
  if (JSON.stringify(applied.draft) !== JSON.stringify(state.draft)) {
    return advance(
      { ...applied.draft, fromLastOrder: false },
      offer,
      applied.notices,
    );
  }

  if (signal.intent === 'confirm' || signal.intent === 'repeat_last') {
    return createSale(state.draft, ctx, offer);
  }
  return misunderstood(state, summary(state.draft, offer.paymentTypes));
};

async function createSale(
  draft: Draft,
  ctx: TurnContext,
  offer: Awaited<ReturnType<typeof loadOffer>>,
) {
  const { item, address, payment, customer } = draft;
  if (!item || !address || !payment || !customer) {
    return advance(draft, offer, []);
  }

  try {
    const customerId =
      customer.id ??
      (
        await ctx.revgas.createCustomer({
          name: customer.name ?? 'Cliente WhatsApp',
          phone: ctx.contact,
          address,
        })
      ).id;

    const sale = await ctx.revgas.createSale({
      customerId,
      address,
      items: [item],
      payments: [{ code: payment, value: total(draft) }],
    });

    return outcome(
      'sale_created',
      {
        ...draft,
        customer: { ...customer, id: customerId },
        saleId: sale.id,
        expecting: 'anything',
      },
      [{ text: `Pedido nº ${sale.id} registrado! Logo sai para entrega.` }],
      [{ type: 'sale_created', saleId: sale.id }],
    );
  } catch (error) {
    if (!(error instanceof RevgasError)) throw error;
    if (error.code === 'out_of_stock') {
      const cleared = { ...draft, item: null, fromLastOrder: false };
      const ask = askFor('product', cleared, offer);
      return outcome('collecting', { ...cleared, expecting: 'product' }, [
        { ...ask, text: `Esse produto acabou de esgotar. ${ask.text}` },
      ]);
    }
    if (error.code === 'payment_declined') {
      const cleared = { ...draft, payment: null };
      const ask = askFor('payment', cleared, offer);
      return outcome('collecting', { ...cleared, expecting: 'payment' }, [
        { ...ask, text: `O pagamento não foi aceito. ${ask.text}` },
      ]);
    }
    // Falha temporária: mantém o resumo para tentar de novo (issue #14).
    return outcome('confirming', draft, [
      {
        text: 'Não consegui registrar o pedido agora. Toque em Confirmar para tentar de novo.',
        buttons: summary(draft, offer.paymentTypes).buttons,
      },
    ]);
  }
}
