import { describe, expect, it } from 'vitest';
import { compare, formatDuration, onAnswer, onSend, stages } from './timing';

const answer = (step: string, conversationId = 'a') => ({
  conversationId,
  step,
  silenced: false,
});

describe('cronômetro do pedido (issue #17)', () => {
  it('conta da primeira mensagem até a venda', () => {
    const first = onAnswer(undefined, answer('confirming'), 1000, 1500);
    expect(first).toMatchObject({ startedAt: 1000, phase: 'running' });
    expect(onSend(first, 9000)).toBe(first);

    const sold = onAnswer(first, answer('sale_created'), 9000, 9400);
    expect(sold).toMatchObject({
      startedAt: 1000,
      phase: 'sold',
      stoppedAt: 9400,
    });
  });

  it('mensagem depois da venda não reinicia; outra conversa sim', () => {
    const sold = onAnswer(undefined, answer('sale_created'), 0, 400);

    expect(onAnswer(sold, answer('closed'), 5000, 5100)).toBe(sold);
    expect(onAnswer(sold, answer('confirming', 'b'), 6000, 6100)).toMatchObject(
      { startedAt: 6000, phase: 'running' },
    );
  });

  it('para sem venda quando a conversa vai para o atendente', () => {
    const stopped = onAnswer(undefined, answer('closed'), 0, 300);
    expect(stopped).toMatchObject({ phase: 'stopped', stoppedAt: 300 });
  });

  it('sessão expirada recomeça a contagem', () => {
    const first = onAnswer(undefined, answer('confirming'), 0, 100);
    const next = onAnswer(first, answer('confirming', 'b'), 9000, 9100);
    expect(next.startedAt).toBe(9000);
  });

  it('formata, compara com hoje e separa as etapas', () => {
    expect(formatDuration(820)).toBe('0,8 s');
    expect(formatDuration(185_000)).toBe('3 min 05 s');
    expect(formatDuration(59_990)).toBe('1 min 00 s');
    expect(compare(30_000, 300_000)).toBe(
      '90% menos que os 5 min 00 s de hoje',
    );
    expect(compare(360_000, 300_000)).toBe(
      '20% mais que os 5 min 00 s de hoje',
    );
    expect(
      stages({ totalMs: 1000, llmMs: 200, revgasMs: 300 }).map((s) => s.ms),
    ).toEqual([200, 300, 500]);
  });
});
