import type { ExtractionResult } from '../llm/message-extractor.js';
import { RevgasError } from '../revgas/revgas.errors.js';
import type {
  Reply,
  SessionState,
  Signal,
  Step,
  TurnOutcome,
} from './conversation.types.js';
import {
  closedHandler,
  deliveredHandler,
  dispatchedHandler,
  saleCreatedHandler,
} from './handlers/after-sale.handlers.js';
import { collectingHandler } from './handlers/collecting.handler.js';
import { confirmingHandler } from './handlers/confirming.handler.js';
import {
  handoff,
  outcome,
  type StepHandler,
  type TurnContext,
} from './handlers/handler.js';
import { identifyingHandler } from './handlers/identifying.handler.js';
import { assertTransition } from './transitions.js';

/** Um handler por etapa. */
export const HANDLERS: Readonly<Record<Step, StepHandler>> = {
  identifying: identifyingHandler,
  collecting: collectingHandler,
  confirming: confirmingHandler,
  sale_created: saleCreatedHandler,
  dispatched: dispatchedHandler,
  delivered: deliveredHandler,
  closed: closedHandler,
};

/**
 * Um turno da conversa. Regras que valem em qualquer etapa vêm antes do
 * handler; depois, a transição devolvida é conferida contra a tabela.
 */
export async function runTurn(
  state: SessionState,
  signal: Signal,
  ctx: TurnContext,
  /** Trocável só em teste. */
  handlers: Readonly<Record<Step, StepHandler>> = HANDLERS,
): Promise<TurnOutcome> {
  let result: TurnOutcome;
  let current = state;
  if (signal.intent === 'human' && state.step !== 'closed') {
    result = handoff(state.draft, 'cliente pediu atendente');
  } else {
    try {
      // Depois da venda, o estado real do pedido está na RevGás (issue #12).
      const synced = await reconcile(state, ctx);
      if ('ended' in synced) {
        assertTransition(state.step, synced.ended.step);
        return { ...synced.ended, replies: synced.ended.replies.map(present) };
      }
      current = synced.state;
      assertTransition(state.step, current.step);
      result = await handlers[current.step](current, signal, ctx);
    } catch (error) {
      if (!(error instanceof RevgasError)) throw error;
      // RevGás fora: não perde a conversa nem o rascunho (PRD seção 7).
      result = outcome(state.step, state.draft, [SYSTEM_UNAVAILABLE]);
      current = state;
    }
  }

  assertTransition(current.step, result.step);
  return { ...result, replies: result.replies.map(present) };
}

/** Etapas em que o pedido pode mudar de estado fora da conversa. */
const TRACKED_STEPS: readonly Step[] = ['sale_created', 'dispatched'];

type Reconciled = { state: SessionState } | { ended: TurnOutcome };

/**
 * Confere o pedido na RevGás antes de responder. Quem cancela, despacha ou
 * entrega é a revenda, não a conversa, então o bot age pelo estado real:
 *
 * - cancelada pela revenda: encerra e avisa;
 * - entregue (`delivered_at`): etapa `delivered`;
 * - despachada: entregador atribuído ou status WARNING. SUPOSIÇÃO: a
 *   documentação não descreve os estados da venda (pergunta 3 da issue #1).
 */
async function reconcile(
  state: SessionState,
  ctx: TurnContext,
): Promise<Reconciled> {
  const saleId = state.draft.saleId;
  if (!TRACKED_STEPS.includes(state.step) || saleId === null) return { state };

  const sale = await ctx.revgas.getSale(saleId);
  if (sale.status === 'CANCEL') {
    const reason = 'cancelada pela revenda';
    return {
      ended: outcome(
        'closed',
        { ...state.draft, pendingChange: null, pendingCancel: false },
        [
          {
            text: `O pedido nº ${saleId} foi cancelado pela revenda. Se quiser, é só fazer um novo pedido.`,
          },
        ],
        [
          { type: 'sale_canceled', saleId, reason },
          { type: 'closed', status: 'canceled', reason },
        ],
      ),
    };
  }

  let step: Step = state.step;
  if (sale.deliveredAt) {
    step = 'delivered';
  } else if (
    state.step === 'sale_created' &&
    (sale.delivererId !== null || sale.status === 'WARNING')
  ) {
    step = 'dispatched';
  }
  if (step === state.step) return { state };
  // Mudou de etapa: o que estava pendente (alteração, motivo) perdeu o sentido.
  return {
    state: {
      step,
      draft: { ...state.draft, pendingChange: null, pendingCancel: false },
    },
  };
}

/** WhatsApp aceita até 3 botões; mais que isso vira lista (issue #10). */
export const MAX_BUTTONS = 3;

export function present(reply: Reply): Reply {
  const count = reply.buttons?.length ?? 0;
  if (count === 0) return reply;
  return { ...reply, presentation: count > MAX_BUTTONS ? 'list' : 'buttons' };
}

export const SYSTEM_UNAVAILABLE = {
  text: 'Tive um problema para falar com o sistema da revenda. Pode repetir em instantes? Se preferir, chamo um atendente.',
  buttons: [{ id: 'human', label: 'Falar com atendente' }],
};

/** Evento externo: a revenda despachou a venda. */
export function markDispatched(state: SessionState): TurnOutcome {
  const result = outcome('dispatched', state.draft, [
    { text: 'Seu pedido saiu para entrega!' },
  ]);
  assertTransition(state.step, result.step);
  return result;
}

const BUTTON_INTENTS: Readonly<Record<string, Signal['intent']>> = {
  confirm: 'confirm',
  change: 'deny',
  cancel: 'cancel',
  human: 'human',
  repeat: 'repeat_last',
  product: 'change_product',
  payment: 'change_payment',
  address: 'change_address',
  'save_address:yes': 'confirm',
  'save_address:no': 'deny',
  'cancel_motive:keep': 'deny',
  'sale_change:confirm': 'confirm',
  'sale_change:keep': 'deny',
};

/** Toque em botão: vira intenção direto, sem passar pelo LLM. */
export function signalFromButton(buttonId: string): Signal {
  const [prefix = ''] = buttonId.split(':');
  const intent =
    BUTTON_INTENTS[buttonId] ??
    BUTTON_INTENTS[prefix] ??
    (prefix === 'change' ? 'deny' : 'unknown');
  return {
    intent,
    extraction: null,
    button: buttonId,
    llmUnavailable: false,
    text: null,
    location: null,
  };
}

export function signalFromExtraction(
  result: ExtractionResult,
  text: string | null = null,
): Signal {
  if (result.ok) {
    return {
      intent: result.extraction.intent,
      extraction: result.extraction,
      button: null,
      llmUnavailable: false,
      text,
      location: null,
    };
  }
  return {
    intent: 'unknown',
    extraction: null,
    button: null,
    llmUnavailable: result.reason !== 'empty_message',
    text,
    location: null,
  };
}
