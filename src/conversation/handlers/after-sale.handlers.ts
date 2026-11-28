import type { Signal } from '../conversation.types.js';
import { RevgasError } from '../../revgas/revgas.errors.js';
import {
  handoff,
  misunderstood,
  outcome,
  type StepHandler,
} from './handler.js';
import { applyChange, proposeChange, wantsChange } from './sale-change.js';

/**
 * Venda criada, ainda não despachada (PRD 6.1): o bot altera produto e
 * endereço (com revalidação) e cancela. Regras finas de cancelamento
 * ficam na issue #12.
 */
export const saleCreatedHandler: StepHandler = async (state, signal, ctx) => {
  const saleId = state.draft.saleId;
  const { draft } = state;

  // Resposta à proposta de alteração.
  if (draft.pendingChange) {
    if (
      signal.button === 'sale_change:confirm' ||
      signal.intent === 'confirm'
    ) {
      return applyChange(draft, ctx);
    }
    if (signal.button === 'sale_change:keep' || signal.intent === 'deny') {
      return outcome(
        'sale_created',
        { ...draft, pendingChange: null, expecting: 'anything' },
        [{ text: 'Tudo bem, seu pedido continua como estava.' }],
      );
    }
  }

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

  if (signal.intent !== 'cancel' && wantsChange(signal)) {
    return proposeChange(state, signal, ctx);
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
  const status = `Seu pedido nº ${saleId ?? ''} já está registrado e logo sai para entrega.`;
  if (notUnderstood(signal)) {
    return misunderstood(state, { text: status, buttons: [HUMAN_BUTTON] });
  }
  return outcome('sale_created', state.draft, [{ text: status }]);
};

const HUMAN_BUTTON = { id: 'human', label: 'Falar com atendente' };

const notUnderstood = (signal: Signal) =>
  signal.intent === 'unknown' || signal.intent === 'other';

/**
 * Entregador a caminho (PRD 6.1): produto não muda; endereço e
 * cancelamento só com atendente, que combina com o entregador.
 */
export const dispatchedHandler: StepHandler = (state, signal) => {
  if (signal.intent === 'cancel') {
    return Promise.resolve(handoff(state.draft, 'cancelamento após despacho'));
  }
  const x = signal.extraction;
  if (
    signal.intent === 'change_address' ||
    signal.location !== null ||
    Boolean(x?.address?.street)
  ) {
    return Promise.resolve(
      handoff(state.draft, 'alterar endereço após despacho'),
    );
  }
  if (
    signal.intent === 'change_product' ||
    x?.productSizeKg ||
    x?.productRelative
  ) {
    return Promise.resolve(
      outcome('dispatched', state.draft, [
        {
          text: 'Seu pedido já saiu para entrega, então não dá mais para trocar o produto. Se precisar, chamo um atendente.',
          buttons: [{ id: 'human', label: 'Falar com atendente' }],
        },
      ]),
    );
  }
  if (notUnderstood(signal)) {
    return Promise.resolve(
      misunderstood(state, {
        text: 'Seu pedido já está a caminho!',
        buttons: [HUMAN_BUTTON],
      }),
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
