import { describeHours, isOpen } from '../attendant/business-hours.js';
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
  if (signal.intent === 'human' && state.step !== 'closed') {
    result = handoff(state.draft, 'cliente pediu atendente');
  } else if (signal.intent === 'complaint' && state.step !== 'closed') {
    result = handoff(state.draft, 'reclamação');
  } else {
    try {
      result = resetMisunderstandings(
        state,
        await handlers[state.step](state, signal, ctx),
      );
    } catch (error) {
      if (!(error instanceof RevgasError)) throw error;
      // RevGás fora: não perde a conversa nem o rascunho (PRD seção 7).
      result = outcome(state.step, state.draft, [SYSTEM_UNAVAILABLE]);
    }
  }

  assertTransition(state.step, result.step);
  const replies = afterHoursReplies(result, ctx) ?? result.replies;
  return { ...result, replies: replies.map(present) };
}

/** As falhas de entendimento só contam quando são seguidas. */
function resetMisunderstandings(
  before: SessionState,
  result: TurnOutcome,
): TurnOutcome {
  const count = result.draft.misunderstandings;
  if (result.step === 'closed' || count === 0) return result;
  if (count > before.draft.misunderstandings) return result;
  return { ...result, draft: { ...result.draft, misunderstandings: 0 } };
}

/** Passagem fora do horário: informa o horário e registra o pedido. */
function afterHoursReplies(
  result: TurnOutcome,
  ctx: TurnContext,
): Reply[] | null {
  const hours = ctx.settings?.businessHours;
  if (!hours || !result.events.some((e) => e.type === 'handoff')) return null;
  if (isOpen(hours, ctx.now ?? new Date())) return null;
  return [
    {
      text: `Nosso atendimento está fechado agora. Funciona ${describeHours(hours)}. Seu pedido de atendimento foi registrado com o que você me disse.`,
    },
  ];
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
  'sale_change:confirm': 'confirm',
  'sale_change:keep': 'deny',
};

/**
 * Sem LLM, o código ainda reconhece o pedido de atendente: o cliente pode
 * pedir a qualquer momento (issue #13).
 */
const ASKS_FOR_HUMAN =
  /\batendente\b|\bfalar com (um |uma )?(pessoa|humano|algu[eé]m)/i;

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
    intent: ASKS_FOR_HUMAN.test(text ?? '') ? 'human' : 'unknown',
    extraction: null,
    button: null,
    llmUnavailable: result.reason !== 'empty_message',
    text,
    location: null,
  };
}
