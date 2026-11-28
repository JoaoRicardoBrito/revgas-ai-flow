import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ConversationService } from '../conversation/conversation.service.js';
import { fakeRevgas } from '../conversation/testing.js';
import { ConversationStore } from '../database/conversation.store.js';
import {
  connectDatabase,
  type DatabaseConnection,
} from '../database/database.js';
import { conversations } from '../database/schema.js';
import { DisabledLlmClient } from '../llm/llm-client.js';
import { MessageExtractor } from '../llm/message-extractor.js';
import { SEED } from '../revgas/fake/seed.js';
import { orderReport } from './order-report.js';
import { measureRevgas, timedRevgas } from './revgas-timing.js';

let connection: DatabaseConnection;
let store: ConversationStore;

beforeAll(async () => {
  connection = await connectDatabase();
  store = new ConversationStore(connection.db);
});

afterAll(async () => {
  await connection.close();
});

beforeEach(async () => {
  await connection.db.delete(conversations);
});

const slow = () => new Promise((resolve) => setTimeout(resolve, 50));

const t0 = new Date('2026-11-27T12:00:00Z');
const at = (seconds: number) => new Date(t0.getTime() + seconds * 1000);

function setup() {
  const { revgas, catalog } = fakeRevgas();
  // Cada leitura do relógio anda 200 ms: o turno "leva" 200 ms.
  let now = 0;
  const service = new ConversationService(
    store,
    new MessageExtractor(new DisabledLlmClient()),
    timedRevgas(revgas),
    catalog,
    { ttlMs: 30 * 60_000, clock: () => (now += 200) },
  );
  let seq = 0;
  const tap = (buttonId: string, when: Date) =>
    service.handleIncoming({
      channel: 'whatsapp',
      contact: SEED.recurringCustomer.phone,
      externalId: `m-${++seq}`,
      at: when,
      buttonId,
    });
  return { tap };
}

const report = async () => orderReport(await store.listOrderMetrics(), 50);

describe('métrica do tempo do pedido (issue #15)', () => {
  it('conta o processamento do turno da venda no tempo total', async () => {
    const { tap } = setup();
    await tap('repeat', at(0));
    await tap('confirm', at(8));

    const [order] = (await report()).orders;

    expect(order).toMatchObject({ totalMs: 8200, turns: 2 });
    expect(order?.revgasMs).toBeGreaterThanOrEqual(0);
  });

  it('o que acontece depois da venda não muda tempo, turnos nem etapas', async () => {
    const { tap } = setup();
    await tap('repeat', at(0));
    const sold = await tap('confirm', at(8));
    const before = await store.getMetrics(sold.conversationId);

    await tap('product', at(60));
    await store.addLlmTime(sold.conversationId, 500);
    await store.addRevgasTime(sold.conversationId, 500);

    expect(await store.getMetrics(sold.conversationId)).toEqual(before);
  });

  it('pedido cancelado fica registrado, fora das médias', async () => {
    const { tap } = setup();
    await tap('repeat', at(0));
    await tap('confirm', at(8));
    await tap('cancel', at(20));

    const result = await report();

    expect(result.summary).toMatchObject({
      orders: 1,
      sales: 0,
      canceled: 1,
      averageTotalMs: null,
      medianTotalMs: null,
    });
    expect(result.orders[0]?.totalMs).toBe(8200);
    expect(JSON.stringify(result)).not.toContain(SEED.recurringCustomer.phone);
  });

  it('mede a espera pela RevGás sem somar chamadas paralelas duas vezes', async () => {
    const { revgas } = fakeRevgas();
    revgas.listProducts = async () => {
      await slow();
      return [];
    };
    const client = timedRevgas(revgas);

    const { revgasMs } = await measureRevgas(() =>
      Promise.all([client.listProducts(), client.listProducts()]),
    );

    expect(revgasMs).toBeGreaterThanOrEqual(40);
    expect(revgasMs).toBeLessThan(95);
  });
});
