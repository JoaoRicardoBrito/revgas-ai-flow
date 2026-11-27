import { RevgasError } from '../../revgas/revgas.errors.js';
import type { PaymentTypeCode } from '../../revgas/revgas.types.js';
import { demoPixMessage } from '../../payments/pix-demo.js';
import type { Offer } from '../catalog.js';
import type { Draft, Reply } from '../conversation.types.js';
import {
  applySignal,
  askFor,
  CHANGE_MENU,
  clearField,
  formatAddress,
  money,
  sameAddress,
  summary,
  total,
} from '../draft.js';
import {
  advance,
  canceledBeforeSale,
  handoff,
  loadOffer,
  misunderstood,
  outcome,
  outOfStock,
  type StepHandler,
  type TurnContext,
} from './handler.js';

/** Resumo na tela: "sim" cria a venda; o resto ajusta ou cancela. */
export const confirmingHandler: StepHandler = async (state, signal, ctx) => {
  if (signal.intent === 'cancel') return canceledBeforeSale(state.draft);

  const offer = await loadOffer(ctx);

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

  // Quer mudar algo, mas sem dizer para o quê ("quero outro"): mostra as
  // opções em botões em vez de adivinhar (issue #9).
  const field = CHANGE_INTENT_FIELD[signal.intent];
  if (field) {
    return advance(
      clearField(state.draft, `change:${field}`),
      offer,
      applied.notices,
    );
  }

  // Entendeu, mas não pôde aplicar (ex.: quantidade acima do estoque):
  // explica e mostra o resumo de novo, sem contar como "não entendi".
  if (applied.notices.length > 0) {
    const again = summary(state.draft, offer.paymentTypes);
    return outcome('confirming', state.draft, [
      { ...again, text: `${applied.notices.join(' ')}\n${again.text}` },
    ]);
  }

  if (signal.intent === 'confirm' || signal.intent === 'repeat_last') {
    return createSale(state.draft, ctx, offer);
  }
  return misunderstood(state, summary(state.draft, offer.paymentTypes));
};

const CHANGE_INTENT_FIELD: Partial<
  Record<string, 'product' | 'address' | 'payment'>
> = {
  change_product: 'product',
  change_address: 'address',
  change_payment: 'payment',
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

  // Estoque conferido pelo código antes de confirmar, sem cache (issue #9).
  // Vem antes do cadastro, para não criar cliente de um pedido que não sai.
  const stock = await ctx.catalog.freshStock(item.productId);
  if (stock < item.quantity) {
    ctx.catalog.invalidate();
    return outOfStock(
      draft,
      await loadOffer(ctx),
      stock > 0
        ? `Só temos ${stock} ${item.description} agora.`
        : `O ${item.description} acabou agora.`,
    );
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
      ...(payment === 'MONEY' && draft.changeFor
        ? { observation: `Troco para ${money(draft.changeFor)}` }
        : {}),
    });

    // Cliente antigo com endereço que ainda não conhecíamos: oferece salvar.
    const newAddress =
      customer.id !== null &&
      !customer.savedAddresses.some((a) => sameAddress(a, address));
    const replies: Reply[] = [
      { text: `Pedido nº ${sale.id} registrado! Logo sai para entrega.` },
    ];
    // Pix copia e cola fictício, só no modo mock (issue #10).
    if (payment === 'PIX' && ctx.settings?.pixDemo) {
      replies.push({
        text: demoPixMessage({ amount: total(draft), saleId: sale.id }),
      });
    }
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
      // Esgotou entre a consulta e a venda: recarrega e reabre as opções.
      ctx.catalog.invalidate();
      return outOfStock(
        draft,
        await loadOffer(ctx),
        'Esse produto acabou de esgotar.',
      );
    }
    if (error.code === 'payment_declined') {
      return paymentDeclined(draft, payment, offer);
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

/**
 * Pagamento recusado (issue #10): a venda não foi criada, então nada é
 * despachado. Oferece outra forma, sem a recusada; na segunda recusa,
 * passa para o atendente.
 */
function paymentDeclined(
  draft: Draft,
  declined: PaymentTypeCode,
  offer: Offer,
) {
  const failures = draft.paymentFailures + 1;
  const next: Draft = {
    ...draft,
    payment: null,
    changeFor: null,
    paymentFailures: failures,
    declinedPayments: [...new Set([...draft.declinedPayments, declined])],
  };
  if (failures >= 2) return handoff(next, 'problema de pagamento');
  const ask = askFor('payment', next, offer);
  const options = ask.buttons ?? [];
  if (options.length === 0) return handoff(next, 'problema de pagamento');
  return outcome('collecting', { ...next, expecting: 'payment' }, [
    {
      ...ask,
      text: `O pagamento não foi aceito. Pode escolher outra forma? ${ask.text}`,
    },
  ]);
}
