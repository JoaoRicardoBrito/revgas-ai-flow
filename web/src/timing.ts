/** Cronômetro do pedido (issue #17). Só funções puras, para testar. */

export interface OrderTimer {
  /** `performance` não serve: o valor é comparado entre renderizações. */
  startedAt: number;
  /** Null até a primeira resposta do servidor. */
  conversationId: string | null;
  phase: 'running' | 'sold' | 'stopped';
  stoppedAt: number | null;
}

export interface TurnAnswer {
  conversationId: string;
  step: string;
  silenced: boolean;
}

/** Ao enviar: o relógio de um pedido novo já começa antes da resposta. */
export function onSend(timer: OrderTimer | undefined, now: number): OrderTimer {
  if (timer?.phase === 'running') return timer;
  return {
    startedAt: now,
    conversationId: null,
    phase: 'running',
    stoppedAt: null,
  };
}

/**
 * Ao receber a resposta. `previous` é o cronômetro de antes do envio: depois
 * da venda (ou do atendente), mensagens da mesma conversa não o reiniciam.
 */
export function onAnswer(
  previous: OrderTimer | undefined,
  answer: TurnAnswer,
  sentAt: number,
  now: number,
): OrderTimer {
  const same = previous?.conversationId === answer.conversationId;
  if (previous && same && previous.phase !== 'running') return previous;

  const startedAt = previous && same ? previous.startedAt : sentAt;
  const sold = ['sale_created', 'dispatched', 'delivered'].includes(
    answer.step,
  );
  const stopped = !sold && (answer.silenced || answer.step === 'closed');
  return {
    startedAt,
    conversationId: answer.conversationId,
    phase: sold ? 'sold' : stopped ? 'stopped' : 'running',
    stoppedAt: sold || stopped ? now : null,
  };
}

/** `0,8 s`, `42,0 s`, `3 min 05 s`. */
export function formatDuration(ms: number): string {
  const tenths = Math.round(ms / 100);
  if (tenths < 600) return `${(tenths / 10).toFixed(1).replace('.', ',')} s`;
  const seconds = Math.round(ms / 1000);
  const rest = String(seconds % 60).padStart(2, '0');
  return `${Math.floor(seconds / 60)} min ${rest} s`;
}

/** Frase da comparação com o atendimento de hoje. */
export function compare(ms: number, baselineMs: number): string {
  const percent = Math.round((Math.abs(baselineMs - ms) / baselineMs) * 100);
  if (ms === baselineMs) return 'o mesmo tempo de hoje';
  const word = ms < baselineMs ? 'menos' : 'mais';
  return `${percent}% ${word} que os ${formatDuration(baselineMs)} de hoje`;
}

/**
 * Onde o tempo foi gasto. O que não é LLM nem RevGás é, principalmente, o
 * cliente lendo e respondendo.
 */
export function stages(order: {
  totalMs: number;
  llmMs: number;
  revgasMs: number;
}) {
  const rest = Math.max(0, order.totalMs - order.llmMs - order.revgasMs);
  return [
    { key: 'llm', label: 'LLM', ms: order.llmMs },
    { key: 'revgas', label: 'RevGás', ms: order.revgasMs },
    { key: 'rest', label: 'Cliente e demais', ms: rest },
  ];
}
