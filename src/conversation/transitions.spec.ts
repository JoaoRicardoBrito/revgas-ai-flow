import { describe, expect, it } from 'vitest';
import { STEPS, type Step } from './conversation.types.js';
import {
  assertTransition,
  canTransition,
  IllegalTransitionError,
  TRANSITIONS,
} from './transitions.js';

const allowed: [Step, Step][] = [
  ['identifying', 'collecting'],
  ['identifying', 'confirming'],
  ['identifying', 'closed'],
  ['collecting', 'confirming'],
  ['collecting', 'closed'],
  ['confirming', 'collecting'],
  ['confirming', 'sale_created'],
  ['confirming', 'closed'],
  ['sale_created', 'dispatched'],
  ['sale_created', 'closed'],
  ['dispatched', 'closed'],
];

describe('transições', () => {
  it('a tabela tem exatamente as transições do desenho', () => {
    const fromTable = STEPS.flatMap((from) =>
      TRANSITIONS[from].map((to) => `${from}>${to}`),
    );
    expect(fromTable.toSorted()).toEqual(
      allowed.map(([from, to]) => `${from}>${to}`).toSorted(),
    );
  });

  it.each(
    STEPS.flatMap((from) => STEPS.map((to) => [from, to] as [Step, Step])),
  )('%s → %s', (from, to) => {
    const expected =
      from === to || allowed.some(([f, t]) => f === from && t === to);
    expect(canTransition(from, to)).toBe(expected);
  });

  it('venda criada nunca volta para coleta nem confirmação', () => {
    expect(canTransition('sale_created', 'collecting')).toBe(false);
    expect(canTransition('sale_created', 'confirming')).toBe(false);
  });

  it('encerrada é final', () => {
    for (const to of STEPS.filter((s) => s !== 'closed')) {
      expect(canTransition('closed', to)).toBe(false);
    }
  });

  it('transição proibida lança erro com origem e destino', () => {
    expect(() => assertTransition('collecting', 'sale_created')).toThrow(
      IllegalTransitionError,
    );
    expect(() => assertTransition('dispatched', 'collecting')).toThrow(
      /dispatched → collecting/,
    );
  });
});
