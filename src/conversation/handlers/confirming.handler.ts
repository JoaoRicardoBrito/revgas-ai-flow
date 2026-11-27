import { RevgasError } from '../../revgas/revgas.errors.js';
import type { Draft, Reply } from '../conversation.types.js';
import {
  applySignal,
  askFor,
  CHANGE_MENU,
  clearField,
  formatAddress,
  sameAddress,
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

  // Cliente novo: cria o cadastro (com o endereço confirmado no resumo) e
  // guarda o ID já, para uma falha na venda não gerar cadastro repetido.
  // O CPF sai do rascunho assim que vai para o cadastro.
  if (customer.id === null) {
    const created = await ctx.revgas.createCustomer({
      name: customer.name ?? 'Cliente WhatsApp',
      phone: ctx.contact,
      address,
      ...(customer.cpf ? { cpf: customer.cpf } : {}),
    });
    draft = {
      ...draft,
      customer: {
        ...customer,
        id: created.id,
        cpf: null,
        needsCpf: false,
        savedAddresses: [address],
      },
    };
  }
  const customerId = draft.customer?.id ?? 0;

  try {
    const sale = await ctx.revgas.createSale({
      customerId,
      address,
      items: [item],
      payments: [{ code: payment, value: total(draft) }],
    });

    // Cliente antigo com endereço que ainda não conhecíamos: oferece salvar.
    const newAddress =
      customer.id !== null &&
      !customer.savedAddresses.some((a) => sameAddress(a, address));
    const replies: Reply[] = [
      { text: `Pedido nº ${sale.id} registrado! Logo sai para entrega.` },
    ];
    if (newAddress) {
      replies.push({
        text: `Quer salvar ${formatAddress(address)} no seu cadastro para os próximos pedidos?`,
        buttons: [
          { id: 'save_address:yes', label: 'Salvar' },
          { id: 'save_address:no', label: 'Agora não' },
        ],
      });
    }

    return outcome(
      'sale_created',
      {
        ...draft,
        saleId: sale.id,
        pendingAddressSave: newAddress,
        expecting: newAddress ? 'confirmation' : 'anything',
      },
      replies,
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
