import { RevgasError } from '../../revgas/revgas.errors.js';
import { handoff, outcome, type StepHandler } from './handler.js';

/**
 * Venda criada, ainda não despachada: o bot cancela (PRD 6.1).
 * Regras finas de cancelamento ficam na issue #12.
 */
export const saleCreatedHandler: StepHandler = async (state, signal, ctx) => {
  const saleId = state.draft.saleId;
  const { draft } = state;

  // Resposta ao "quer salvar este endereço?" (issue #8).
  const answer =
    signal.button === 'save_address:yes' || signal.intent === 'confirm'
      ? 'yes'
      : signal.button === 'save_address:no' || signal.intent === 'deny'
        ? 'no'
        : null;
  if (draft.pendingAddressSave && answer) {
    const done = { ...draft, pendingAddressSave: false, expecting: 'anything' };
    if (answer === 'no' || !draft.customer?.id || !draft.address) {
      return outcome('sale_created', done, [{ text: 'Tudo bem, não salvei.' }]);
    }
    try {
      await ctx.revgas.updateCustomerAddress(draft.customer.id, draft.address);
      return outcome(
        'sale_created',
        {
          ...done,
          customer: {
            ...draft.customer,
            savedAddresses: [
              draft.address,
              ...draft.customer.savedAddresses,
            ].slice(0, 3),
          },
        },
        [{ text: 'Endereço salvo para os próximos pedidos.' }],
      );
    } catch (error) {
      if (!(error instanceof RevgasError)) throw error;
      return outcome('sale_created', done, [
        {
          text: 'Não consegui salvar o endereço agora, mas seu pedido está confirmado.',
        },
      ]);
    }
  }

  if (signal.intent === 'cancel' && saleId !== null) {
    try {
      const [motive] = await ctx.revgas.listCancelMotives();
      if (!motive)
        return handoff(state.draft, 'cancelamento sem motivo cadastrado');
      await ctx.revgas.cancelSale(saleId, motive.id);
      return outcome(
        'closed',
        state.draft,
        [{ text: `Pedido nº ${saleId} cancelado.` }],
        [
          { type: 'sale_canceled', saleId },
          { type: 'closed', status: 'canceled' },
        ],
      );
    } catch (error) {
      if (!(error instanceof RevgasError)) throw error;
      return handoff(state.draft, 'falha ao cancelar a venda');
    }
  }
  return outcome('sale_created', state.draft, [
    {
      text: `Seu pedido nº ${saleId ?? ''} já está registrado e logo sai para entrega.`,
    },
  ]);
};

/** Entregador a caminho: cancelar só com atendente (PRD 6.1). */
export const dispatchedHandler: StepHandler = (state, signal) => {
  if (signal.intent === 'cancel' || signal.intent === 'complaint') {
    return Promise.resolve(
      handoff(state.draft, 'cancelamento ou reclamação após despacho'),
    );
  }
  return Promise.resolve(
    outcome('dispatched', state.draft, [
      { text: 'Seu pedido já está a caminho!' },
    ]),
  );
};

/** Não deveria receber mensagem: o serviço abre conversa nova. */
export const closedHandler: StepHandler = (state) =>
  Promise.resolve(outcome('closed', state.draft, []));
