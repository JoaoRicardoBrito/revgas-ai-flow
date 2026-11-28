import type { OrderRow } from '../database/conversation.store.js';

/** Quanto um pedido leva hoje, com atendente humano. */
export const BASELINE_MS = 5 * 60_000;

/** Um pedido, sem dado pessoal (nada de telefone, endereço ou texto). */
export interface OrderTiming {
  conversationId: string;
  channel: string;
  outcome: string;
  firstMessageAt: string;
  saleCreatedAt: string | null;
  /** Mensagens do cliente até a venda. */
  turns: number;
  handedOff: boolean;
  handoffReason: string | null;
  /** Primeira mensagem até a venda criada; null sem venda. */
  totalMs: number | null;
  llmMs: number;
  revgasMs: number;
}

export interface OrderReport {
  baselineMs: number;
  /** Sobre todos os pedidos, não só os listados. */
  summary: {
    orders: number;
    /** Vendas criadas e não canceladas: só elas entram nas médias. */
    sales: number;
    canceled: number;
    abandoned: number;
    handedOff: number;
    averageTotalMs: number | null;
    medianTotalMs: number | null;
    averageLlmMs: number | null;
    averageRevgasMs: number | null;
  };
  /** Mais recentes primeiro. */
  orders: OrderTiming[];
}

export function orderReport(rows: OrderRow[], limit: number): OrderReport {
  const orders = rows.map(toTiming);
  const sales = orders.filter(
    (o) => o.totalMs !== null && o.outcome !== 'canceled',
  );
  const totals = sales.map((o) => o.totalMs ?? 0);
  const count = (test: (o: OrderTiming) => boolean) =>
    orders.filter(test).length;
  return {
    baselineMs: BASELINE_MS,
    summary: {
      orders: orders.length,
      sales: sales.length,
      canceled: count((o) => o.outcome === 'canceled'),
      abandoned: count((o) => o.outcome === 'abandoned'),
      handedOff: count((o) => o.handedOff),
      averageTotalMs: average(totals),
      medianTotalMs: median(totals),
      averageLlmMs: average(sales.map((o) => o.llmMs)),
      averageRevgasMs: average(sales.map((o) => o.revgasMs)),
    },
    orders: orders.slice(0, limit),
  };
}

function toTiming({ channel, metrics }: OrderRow): OrderTiming {
  const { firstMessageAt, saleCreatedAt } = metrics;
  return {
    conversationId: metrics.conversationId,
    channel,
    outcome: metrics.outcome,
    firstMessageAt: firstMessageAt.toISOString(),
    saleCreatedAt: saleCreatedAt?.toISOString() ?? null,
    turns: metrics.turns,
    handedOff: metrics.handedOff,
    handoffReason: metrics.handoffReason,
    totalMs: saleCreatedAt
      ? saleCreatedAt.getTime() - firstMessageAt.getTime()
      : null,
    llmMs: metrics.llmMs,
    revgasMs: metrics.revgasMs,
  };
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);
}

function median(values: number[]): number | null {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = sorted.slice(
    Math.floor((sorted.length - 1) / 2),
    Math.floor(sorted.length / 2) + 1,
  );
  return average(middle);
}
