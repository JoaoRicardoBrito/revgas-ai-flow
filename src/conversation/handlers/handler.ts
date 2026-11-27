import type { RevgasClient } from '../../revgas/revgas-client.js';
import type { Catalog } from '../catalog.js';
import type { Coverage } from '../coverage.js';
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
  askForMany,
  EXPECTING_BY_FIELD,
  missingFields,
  summary,
  type Offer,
} from '../draft.js';

export interface TurnContext {
  revgas: RevgasClient;
  /** Produtos, preços e formas de pagamento, com cache. */
  catalog: Catalog;
  /** Telefone (ou ID do simulador) de quem escreve. */
  contact: string;
  settings?: ConversationSettings;
}

export interface ConversationSettings {
  /**
   * A nota fiscal da revenda exige CPF do consumidor. Na NFC-e ele é
   * opcional, então o padrão é não pedir (CPF_REQUIRED).
   */
  cpfRequired: boolean;
  /**
   * Manda o Pix copia e cola fictício depois da venda. Só no modo mock:
   * cliente real nunca recebe código de demonstração.
   */
  pixDemo?: boolean;
  /** Área de entrega (COVERAGE_*). */
  coverage?: Coverage;
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

export async function loadOffer(ctx: TurnContext): Promise<Offer> {
  return { ...(await ctx.catalog.offer()), coverage: ctx.settings?.coverage };
}

/**
 * Sem estoque (issue #9): oferece os outros produtos à venda e o atendente.
 * Nunca segue para a venda. Mais de 3 opções o canal mostra como lista.
 */
export function outOfStock(
  draft: Draft,
  offer: Offer,
  message: string,
): TurnOutcome {
  const cleared: Draft = { ...draft, item: null, fromLastOrder: false };
  const ask = askFor('product', cleared, offer);
  const options = ask.buttons ?? [];
  return outcome('collecting', { ...cleared, expecting: 'product' }, [
    {
      text: options.length
        ? `${message} ${ask.text}`
        : `${message} No momento não temos outro botijão. Quer falar com um atendente?`,
      buttons: [...options, { id: 'human', label: 'Falar com atendente' }],
    },
  ]);
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
  const fields = missingFields(draft);
  const [field] = fields;
  const prefix = notices.length ? `${notices.join(' ')}\n` : '';
  if (field && fields.length >= 2 && draft.customer?.id === null) {
    // Cliente novo: pede tudo o que falta numa mensagem só.
    const ask = askForMany(fields, draft, offer);
    return outcome(
      'collecting',
      { ...draft, expecting: 'anything' },
      [{ ...ask, text: prefix + ask.text }],
      events,
    );
  }
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

/**
 * Endereço fora da área de entrega (issue #11): não aceita o endereço,
 * oferece os salvos que são atendidos ou o atendente.
 */
export function outsideCoverage(
  draft: Draft,
  offer: Offer,
  notices: string[],
): TurnOutcome {
  const ask = askFor('address', { ...draft, pendingLocation: null }, offer);
  return outcome('collecting', { ...draft, expecting: 'address' }, [
    {
      text: `${notices.join(' ')}\nPode me passar outro endereço? Se preferir, chamo um atendente.`,
      buttons: [
        ...(ask.buttons ?? []),
        { id: 'human', label: 'Falar com atendente' },
      ],
    },
  ]);
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
