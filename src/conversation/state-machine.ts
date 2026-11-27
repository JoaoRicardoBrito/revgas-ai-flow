import type { ExtractionResult } from '../llm/message-extractor.js';
import { RevgasError } from '../revgas/revgas.errors.js';
import type {
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
  } else {
    try {
      result = await handlers[state.step](state, signal, ctx);
    } catch (error) {
      if (!(error instanceof RevgasError)) throw error;
      // RevGás fora: não perde a conversa nem o rascunho (PRD seção 7).
      result = outcome(state.step, state.draft, [SYSTEM_UNAVAILABLE]);
    }
  }

  assertTransition(state.step, result.step);
  return result;
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
};

/** Toque em botão: vira intenção direto, sem passar pelo LLM. */
export function signalFromButton(buttonId: string): Signal {
  const [prefix = ''] = buttonId.split(':');
  const intent =
    BUTTON_INTENTS[prefix] ?? (prefix === 'change' ? 'deny' : 'unknown');
  return { intent, extraction: null, button: buttonId, llmUnavailable: false };
}

export function signalFromExtraction(result: ExtractionResult): Signal {
  if (result.ok) {
    return {
      intent: result.extraction.intent,
      extraction: result.extraction,
      button: null,
      llmUnavailable: false,
    };
  }
  return {
    intent: 'unknown',
    extraction: null,
    button: null,
    llmUnavailable: result.reason !== 'empty_message',
  };
}
