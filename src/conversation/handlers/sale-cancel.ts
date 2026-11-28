/**
 * Cancelar uma venda já criada e ainda não despachada (PRD 6.1, issue #12).
 * O bot pergunta o motivo, com os motivos ativos da RevGás em botões, e só
 * cancela depois do toque. O motivo vai para a RevGás e para as métricas.
 */
import { RevgasError } from '../../revgas/revgas.errors.js';
import type { CancelMotive } from '../../revgas/revgas.types.js';
import type { Draft, Signal, TurnOutcome } from '../conversation.types.js';
import { buttonLabel } from '../draft.js';
import { handoff, outcome, type TurnContext } from './handler.js';

const KEEP_BUTTON = { id: 'cancel_motive:keep', label: 'Não cancelar' };

/** Lista do WhatsApp aceita 10 linhas: 9 motivos mais "Não cancelar". */
const MAX_MOTIVES = 9;

function motiveButtons(motives: CancelMotive[]) {
  return [
    ...motives.slice(0, MAX_MOTIVES).map((m) => ({
      id: `cancel_motive:${m.id}`,
      label: buttonLabel(m.description),
    })),
    KEEP_BUTTON,
  ];
}

/** "Quero cancelar": pergunta o motivo. Ainda não cancela nada. */
export async function askCancelMotive(
  draft: Draft,
  ctx: TurnContext,
  prefix = '',
): Promise<TurnOutcome> {
  const motives = await ctx.revgas.listCancelMotives();
  if (motives.length === 0) {
    return handoff(draft, 'cancelamento sem motivo cadastrado');
  }
  return outcome(
    'sale_created',
    { ...draft, pendingCancel: true, expecting: 'anything' },
    [
      {
        text: `${prefix}Por que você quer cancelar o pedido nº ${draft.saleId ?? ''}?`,
        buttons: motiveButtons(motives),
      },
    ],
  );
}

/** Resposta à pergunta do motivo: cancela, mantém ou pergunta de novo. */
export async function answerCancelMotive(
  draft: Draft,
  signal: Signal,
  ctx: TurnContext,
): Promise<TurnOutcome> {
  const saleId = draft.saleId;
  if (saleId === null) return handoff(draft, 'cancelamento sem dados da venda');

  if (signal.button === 'cancel_motive:keep' || signal.intent === 'deny') {
    return outcome(
      'sale_created',
      { ...draft, pendingCancel: false, expecting: 'anything' },
      [{ text: 'Tudo bem, seu pedido continua.' }],
    );
  }

  const motives = await ctx.revgas.listCancelMotives();
  const id = signal.button?.startsWith('cancel_motive:')
    ? Number(signal.button.slice('cancel_motive:'.length))
    : null;
  const motive = motives.find((m) => m.id === id);
  if (!motive) {
    // Texto solto ou botão que não existe: pergunta de novo, sem cancelar.
    return askCancelMotive(draft, ctx, 'Escolha um dos motivos abaixo. ');
  }

  try {
    await ctx.revgas.cancelSale(saleId, motive.id);
  } catch (error) {
    if (!(error instanceof RevgasError)) throw error;
    if (['bad_request', 'conflict', 'forbidden'].includes(error.code)) {
      // A RevGás não deixou cancelar (ex.: já saiu para entrega).
      return handoff(
        { ...draft, pendingCancel: false },
        'cancelamento recusado pela RevGás',
      );
    }
    return outcome('sale_created', draft, [
      {
        text: 'Não consegui cancelar agora. Escolha o motivo de novo para tentar outra vez.',
        buttons: motiveButtons(motives),
      },
    ]);
  }

  return outcome(
    'closed',
    { ...draft, pendingCancel: false },
    [{ text: `Pedido nº ${saleId} cancelado.` }],
    [
      { type: 'sale_canceled', saleId, reason: motive.description },
      { type: 'closed', status: 'canceled', reason: motive.description },
    ],
  );
}
