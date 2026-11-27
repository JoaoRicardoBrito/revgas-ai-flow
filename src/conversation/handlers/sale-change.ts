/**
 * Alterar produto ou endereço de uma venda já criada e ainda não
 * despachada (PRD 6.1, issue #11). O bot propõe a alteração com o novo
 * total e só chama `PUT /sales/{id}` depois do "Confirmar alteração".
 */
import { RevgasError } from '../../revgas/revgas.errors.js';
import type {
  Draft,
  SessionState,
  Signal,
  TurnOutcome,
} from '../conversation.types.js';
import {
  applySignal,
  askFor,
  formatAddress,
  money,
  sameAddress,
  total,
} from '../draft.js';
import { handoff, loadOffer, outcome, type TurnContext } from './handler.js';

export const SALE_CHANGE_BUTTONS = [
  { id: 'sale_change:confirm', label: 'Confirmar alteração' },
  { id: 'sale_change:keep', label: 'Manter pedido' },
];

/** O turno pede para mudar produto ou endereço? */
export function wantsChange(signal: Signal): boolean {
  const x = signal.extraction;
  return (
    signal.intent === 'change_product' ||
    signal.intent === 'change_address' ||
    signal.location !== null ||
    Boolean(
      signal.button?.startsWith('product:') ||
      signal.button?.startsWith('address:'),
    ) ||
    Boolean(
      x &&
      (x.productSizeKg || x.productRelative || x.quantity || x.address?.street),
    )
  );
}

/** Monta a proposta de alteração ou explica por que não dá. */
export async function proposeChange(
  state: SessionState,
  signal: Signal,
  ctx: TurnContext,
): Promise<TurnOutcome> {
  const { draft } = state;
  const offer = await loadOffer(ctx);
  if (!draft.item || !draft.address) {
    return handoff(draft, 'alteração sem dados da venda');
  }

  const applied = applySignal(
    { ...draft, fromLastOrder: false },
    signal,
    offer,
  );
  const note = applied.notices.join(' ');
  if (applied.outsideCoverage) {
    return outcome('sale_created', draft, [
      {
        text: `${note} Seu pedido continua para ${formatAddress(draft.address)}.`,
      },
    ]);
  }

  const item = applied.draft.item;
  const address = applied.draft.address;
  const unchanged =
    item !== null &&
    address !== null &&
    item.productId === draft.item.productId &&
    item.quantity === draft.item.quantity &&
    sameAddress(address, draft.address);
  if (!item || !address || unchanged) {
    // Pediu para mudar sem dizer o quê: mostra as opções.
    const field =
      signal.intent === 'change_address' || signal.location
        ? 'address'
        : 'product';
    const ask = askFor(
      field,
      { ...draft, pendingLocation: applied.draft.pendingLocation },
      offer,
    );
    return outcome(
      'sale_created',
      { ...draft, pendingLocation: applied.draft.pendingLocation },
      [
        {
          ...ask,
          text: `${note ? `${note} ` : ''}Para alterar o pedido nº ${draft.saleId ?? ''}: ${ask.text}`,
        },
      ],
    );
  }

  // Estoque: a venda atual já reservou o que tem; só confere o que aumenta.
  const extra =
    item.productId === draft.item.productId
      ? item.quantity - draft.item.quantity
      : item.quantity;
  if (extra > 0) {
    const stock = await ctx.catalog.freshStock(item.productId);
    if (stock < extra) {
      return outcome('sale_created', draft, [
        {
          text: `Não temos ${item.description} suficiente para essa alteração. Seu pedido continua como estava.`,
        },
      ]);
    }
  }

  const proposal: Draft = {
    ...draft,
    pendingChange: { item, address },
    expecting: 'confirmation',
  };
  const newTotal = total({ ...draft, item });
  return outcome('sale_created', proposal, [
    {
      text: [
        `Alterar o pedido nº ${draft.saleId ?? ''} para:`,
        `${item.quantity}x ${item.description} (${money(item.unitValue)} cada)`,
        `Entrega: ${formatAddress(address)}`,
        `Novo total: ${money(newTotal)}`,
      ].join('\n'),
      buttons: SALE_CHANGE_BUTTONS,
    },
  ]);
}

/** "Confirmar alteração": manda a venda alterada para a RevGás. */
export async function applyChange(
  draft: Draft,
  ctx: TurnContext,
): Promise<TurnOutcome> {
  const change = draft.pendingChange;
  const saleId = draft.saleId;
  const customerId = draft.customer?.id;
  if (!change || saleId === null || !customerId || !draft.payment) {
    return handoff(draft, 'alteração sem dados da venda');
  }
  const updated: Draft = {
    ...draft,
    item: change.item,
    address: change.address,
    pendingChange: null,
    expecting: 'anything',
  };
  const value = total(updated);
  try {
    await ctx.revgas.updateSale(saleId, {
      customerId,
      address: change.address,
      items: [change.item],
      payments: [{ code: draft.payment, value }],
      ...(draft.payment === 'MONEY' && draft.changeFor
        ? { observation: `Troco para ${money(draft.changeFor)}` }
        : {}),
    });
  } catch (error) {
    if (!(error instanceof RevgasError)) throw error;
    if (error.code === 'bad_request' || error.code === 'conflict') {
      // A RevGás não deixou alterar (ex.: já saiu): só o atendente resolve.
      return handoff(
        { ...draft, pendingChange: null },
        'alteração recusada pela RevGás',
      );
    }
    if (error.code === 'out_of_stock') {
      ctx.catalog.invalidate();
      return outcome('sale_created', { ...draft, pendingChange: null }, [
        { text: 'Esse produto acabou agora. Seu pedido continua como estava.' },
      ]);
    }
    return outcome('sale_created', draft, [
      {
        text: 'Não consegui alterar agora. Toque em Confirmar alteração para tentar de novo.',
        buttons: SALE_CHANGE_BUTTONS,
      },
    ]);
  }
  return outcome('sale_created', updated, [
    { text: `Pedido nº ${saleId} alterado. Novo total: ${money(value)}.` },
  ]);
}
