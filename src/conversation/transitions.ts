import type { Step } from './conversation.types.js';

/**
 * Únicas transições permitidas. Toda etapa pode ir para `closed` (cancelar
 * antes da venda, atendente, fim). Ficar na mesma etapa é sempre permitido.
 */
export const TRANSITIONS: Readonly<Record<Step, readonly Step[]>> = {
  identifying: ['collecting', 'confirming', 'closed'],
  collecting: ['confirming', 'closed'],
  confirming: ['collecting', 'sale_created', 'closed'],
  sale_created: ['dispatched', 'delivered', 'closed'],
  dispatched: ['delivered', 'closed'],
  delivered: ['closed'],
  closed: [],
};

export class IllegalTransitionError extends Error {
  override readonly name = 'IllegalTransitionError';

  constructor(
    readonly from: Step,
    readonly to: Step,
  ) {
    super(`Transição não permitida: ${from} → ${to}`);
  }
}

export function canTransition(from: Step, to: Step): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}

export function assertTransition(from: Step, to: Step): void {
  if (!canTransition(from, to)) throw new IllegalTransitionError(from, to);
}
