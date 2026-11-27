import type { RevgasClient } from '../../revgas/revgas-client.js';
import { loadCatalog } from '../catalog.js';
import type {
  Draft,
  Reply,
  SessionState,
  Signal,
  Step,
  TurnEvent,
  TurnOutcome,
} from '../conversation.types.js';
import {
  askFor,
  EXPECTING_BY_FIELD,
  missingField,
  summary,
  type Offer,
} from '../draft.js';

export interface TurnContext {
  revgas: RevgasClient;
  /** Telefone (ou ID do simulador) de quem escreve. */
  contact: string;
}

export type StepHandler = (
  state: SessionState,
  signal: Signal,
  ctx: TurnContext,
) => Promise<TurnOutcome>;

/** Monta o resultado do turno. */
export function outcome(
  step: Step,
  draft: Draft,
  replies: Reply[],
  events: TurnEvent[] = [],
): TurnOutcome {
  return { step, draft, replies, events };
}

export async function loadOffer(revgas: RevgasClient): Promise<Offer> {
  const [catalog, paymentTypes] = [
    await loadCatalog(revgas),
    await revgas.listPaymentTypes(),
  ];
  return { catalog, paymentTypes };
}

/**
 * Depois de aplicar o turno: se falta algo, pergunta (collecting); se está
 * completo, mostra o resumo (confirming). Quem decide é o código.
 */
export function advance(
  draft: Draft,
  offer: Offer,
  notices: string[],
  events: TurnEvent[] = [],
  summaryHeader?: string,
): TurnOutcome {
  const field = missingField(draft);
  const prefix = notices.length ? `${notices.join(' ')}\n` : '';
  if (field) {
    const ask = askFor(field, draft, offer);
    return outcome(
      'collecting',
      { ...draft, expecting: EXPECTING_BY_FIELD[field] },
      [{ ...ask, text: prefix + ask.text }],
      events,
    );
  }
  const reply = summary(draft, offer.paymentTypes, summaryHeader);
  return outcome(
    'confirming',
    { ...draft, expecting: 'confirmation' },
    [{ ...reply, text: prefix + reply.text }],
    events,
  );
}

/** Não entendeu: repete a pergunta com botões; na segunda vez, atendente. */
export function misunderstood(state: SessionState, retry: Reply): TurnOutcome {
  const misunderstandings = state.draft.misunderstandings + 1;
  if (misunderstandings >= 2) {
    return handoff(state.draft, 'não entendeu duas vezes');
  }
  return outcome(state.step, { ...state.draft, misunderstandings }, [
    { ...retry, text: `Não entendi. ${retry.text}` },
  ]);
}

export function handoff(draft: Draft, reason: string): TurnOutcome {
  return outcome(
    'closed',
    draft,
    [
      {
        text: 'Vou te passar para um atendente. Ele já recebe o que você me disse, não precisa repetir.',
      },
    ],
    [{ type: 'handoff', reason }],
  );
}

export function canceledBeforeSale(draft: Draft): TurnOutcome {
  return outcome(
    'closed',
    draft,
    [{ text: 'Tudo bem, pedido cancelado. Quando quiser, é só chamar.' }],
    [{ type: 'closed', status: 'canceled' }],
  );
}
