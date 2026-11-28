import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';
import type { RevgasClient } from '../revgas/revgas-client.js';

/** Acumulador de um turno. */
interface Timer {
  /** Chamadas em andamento: paralelas não contam o tempo duas vezes. */
  active: number;
  since: number;
  total: number;
}

const turn = new AsyncLocalStorage<Timer>();

/** Roda um turno e mede quanto dele foi esperando a RevGás. */
export async function measureRevgas<T>(
  task: () => Promise<T>,
): Promise<{ result: T; revgasMs: number }> {
  const timer: Timer = { active: 0, since: 0, total: 0 };
  const result = await turn.run(timer, task);
  return { result, revgasMs: timer.total };
}

/** Client que soma o tempo de cada chamada no turno que a fez. */
export function timedRevgas(client: RevgasClient): RevgasClient {
  return new Proxy(client, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property);
      if (typeof value !== 'function') return value;
      return async (...args: unknown[]): Promise<unknown> => {
        const timer = turn.getStore();
        if (timer && timer.active++ === 0) timer.since = performance.now();
        try {
          const result: unknown = Reflect.apply(value, target, args);
          return await result;
        } finally {
          if (timer && --timer.active === 0) {
            timer.total += performance.now() - timer.since;
          }
        }
      };
    },
  });
}
