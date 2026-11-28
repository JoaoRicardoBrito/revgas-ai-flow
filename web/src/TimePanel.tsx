import { useEffect, useState } from 'react';
import type { Metrics, OrderTiming } from './api';
import { compare, formatDuration, stages, type OrderTimer } from './timing';

const OUTCOMES: Record<string, string> = {
  in_progress: 'em andamento',
  sale_created: 'vendido',
  abandoned: 'abandonado',
  handed_off: 'com atendente',
  canceled: 'cancelado',
};

/** Cronômetro ao vivo do pedido do cliente selecionado. */
export function Stopwatch({
  timer,
  order,
  baselineMs,
}: {
  timer: OrderTimer | undefined;
  /** Números do servidor, que valem sobre o relógio da tela. */
  order: OrderTiming | undefined;
  baselineMs: number | undefined;
}) {
  const [now, setNow] = useState(() => Date.now());
  const running = timer?.phase === 'running';

  useEffect(() => {
    if (!running) return undefined;
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(tick);
  }, [running]);

  const measured = timer?.phase === 'sold' ? (order?.totalMs ?? null) : null;
  const elapsed = timer
    ? (measured ?? Math.max(0, (timer.stoppedAt ?? now) - timer.startedAt))
    : 0;

  return (
    <p className="stopwatch">
      <strong role="timer">{formatDuration(elapsed)}</strong>
      <span>
        {!timer && 'Começa na primeira mensagem.'}
        {running && 'Pedido em andamento…'}
        {timer?.phase === 'stopped' && 'Parado sem venda.'}
        {timer?.phase === 'sold' &&
          `Venda criada${
            baselineMs ? `: ${compare(elapsed, baselineMs)}` : ''
          }.`}
      </span>
    </p>
  );
}

/** Resumo, comparação com hoje e histórico com o tempo por etapa. */
export function History({
  metrics,
  failed,
}: {
  metrics: Metrics | undefined;
  failed: boolean;
}) {
  const average = metrics?.summary.averageTotalMs ?? null;

  return (
    <aside aria-label="Tempo dos pedidos">
      <h2>Tempo dos pedidos</h2>
      {failed && <p>Não foi possível carregar o histórico.</p>}
      {metrics && (
        <>
          {average === null ? (
            <p>Ainda não há venda para comparar.</p>
          ) : (
            <div className="comparison">
              <Bar
                label="Hoje, com atendente"
                ms={metrics.baselineMs}
                max={Math.max(metrics.baselineMs, average)}
              />
              <Bar
                label={`Média de ${metrics.summary.sales} venda(s)`}
                ms={average}
                max={Math.max(metrics.baselineMs, average)}
              />
              <p>{compare(average, metrics.baselineMs)}</p>
            </div>
          )}

          <h3>Histórico</h3>
          {metrics.orders.length === 0 && <p>Nenhum pedido ainda.</p>}
          <ol>
            {metrics.orders.map((order) => (
              <Order key={order.conversationId} order={order} />
            ))}
          </ol>
        </>
      )}
    </aside>
  );
}

function Bar({ label, ms, max }: { label: string; ms: number; max: number }) {
  return (
    <div>
      <span>
        {label}: <strong>{formatDuration(ms)}</strong>
      </span>
      <span className="track">
        <span className="fill" style={{ width: `${(ms / max) * 100}%` }} />
      </span>
    </div>
  );
}

function Order({ order }: { order: OrderTiming }) {
  const { totalMs } = order;
  const parts = totalMs === null ? [] : stages({ ...order, totalMs });

  return (
    <li>
      <span>
        {new Date(order.firstMessageAt).toLocaleTimeString('pt-BR')} ·{' '}
        {OUTCOMES[order.outcome] ?? order.outcome} · {order.turns} mensagem(ns)
        {totalMs !== null && (
          <>
            {' '}
            · <strong>{formatDuration(totalMs)}</strong>
          </>
        )}
      </span>
      {totalMs !== null && (
        <>
          <span className="track" aria-hidden="true">
            {parts.map((p) => (
              <span
                key={p.key}
                className={`fill ${p.key}`}
                style={{ width: `${(p.ms / Math.max(1, totalMs)) * 100}%` }}
              />
            ))}
          </span>
          <small>
            {parts.map((p) => (
              <span key={p.key} className={`legend ${p.key}`}>
                {p.label} {formatDuration(p.ms)}
              </span>
            ))}
          </small>
        </>
      )}
    </li>
  );
}
