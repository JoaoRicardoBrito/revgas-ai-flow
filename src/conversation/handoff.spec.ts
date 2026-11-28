import { describe, expect, it } from 'vitest';
import { SEED } from '../revgas/fake/seed.js';
import { emptyDraft, type SessionState } from './conversation.types.js';
import { runTurn, signalFromExtraction } from './state-machine.js';
import { fakeRevgas, said, tapped } from './testing.js';

function setup() {
  const { revgas, catalog } = fakeRevgas();
  const ctx = { revgas, catalog, contact: SEED.recurringCustomer.phone };
  const start: SessionState = { step: 'identifying', draft: emptyDraft() };
  return { ctx, start };
}

async function sold() {
  const { ctx, start } = setup();
  const offer = await runTurn(start, said({ intent: 'repeat_last' }), ctx);
  return { ctx, state: await runTurn(offer, tapped('confirm'), ctx) };
}

const gibberish = said({ intent: 'other' });

describe('passagem para atendente (issue #13)', () => {
  it('reclamação passa em qualquer etapa', async () => {
    const { ctx, start } = setup();
    const result = await runTurn(start, said({ intent: 'complaint' }), ctx);
    expect(result.step).toBe('closed');
    expect(result.events).toEqual([{ type: 'handoff', reason: 'reclamação' }]);
  });

  it('depois da venda, duas falhas de entendimento seguidas passam', async () => {
    const { ctx, state } = await sold();
    // A primeira resposta depois da venda não é sobre salvar endereço.
    const once = await runTurn(state, gibberish, ctx);
    expect(once.step).toBe('sale_created');
    const twice = await runTurn(once, gibberish, ctx);
    expect(twice.events).toEqual([
      { type: 'handoff', reason: 'não entendeu duas vezes' },
    ]);
  });

  it('um turno entendido zera a contagem de falhas', async () => {
    const { ctx, state } = await sold();
    const once = await runTurn(state, gibberish, ctx);
    const fine = await runTurn(once, said({ intent: 'greeting' }), ctx);
    expect(fine.draft.misunderstandings).toBe(0);
  });

  it('fora do horário informa o horário e registra o pedido', async () => {
    const { ctx, start } = setup();
    const result = await runTurn(start, tapped('human'), {
      ...ctx,
      now: new Date('2026-11-29T15:00:00Z'),
      settings: {
        cpfRequired: false,
        businessHours: {
          opensAt: 8 * 60,
          closesAt: 18 * 60,
          days: [1, 2, 3, 4, 5],
          timeZone: 'America/Fortaleza',
        },
      },
    });
    expect(result.replies[0]?.text).toMatch(/das 08:00 às 18:00/);
    expect(result.replies[0]?.text).toMatch(/registrado/);
    expect(result.events[0]).toMatchObject({ type: 'handoff' });
  });

  it.each([
    'atendente',
    'quero falar com uma pessoa',
    'Quero falar com alguém',
  ])('com o LLM fora do ar, "%s" ainda pede atendente', (text) => {
    const signal = signalFromExtraction(
      { ok: false, reason: 'unavailable', attempts: 1, durationMs: 0 },
      text,
    );
    expect(signal.intent).toBe('human');
  });
});
