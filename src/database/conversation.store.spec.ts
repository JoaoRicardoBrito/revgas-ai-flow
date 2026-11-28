import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ConversationStore } from './conversation.store.js';
import { connectDatabase, type DatabaseConnection } from './database.js';
import { conversations, messages, orderMetrics } from './schema.js';

let connection: DatabaseConnection;
let store: ConversationStore;

const t0 = new Date('2026-11-27T12:00:00Z');
const at = (seconds: number) => new Date(t0.getTime() + seconds * 1000);

beforeAll(async () => {
  // PGlite em memória, com as migrations reais de drizzle/.
  connection = await connectDatabase();
  store = new ConversationStore(connection.db);
});

afterAll(async () => {
  await connection.close();
});

beforeEach(async () => {
  await connection.db.delete(conversations);
});

describe('migrations', () => {
  it('criam as três tabelas com RLS ligado', async () => {
    const result = await connection.db.execute(
      sql`SELECT relname, relrowsecurity FROM pg_class
          WHERE relname IN ('conversations', 'messages', 'order_metrics')
          ORDER BY relname`,
    );

    expect(result).toMatchObject({
      rows: [
        { relname: 'conversations', relrowsecurity: true },
        { relname: 'messages', relrowsecurity: true },
        { relname: 'order_metrics', relrowsecurity: true },
      ],
    });
    expect(result).toHaveProperty('rows.length', 3);
  });
});

describe('ConversationStore', () => {
  it('abre a conversa com first_message_at e reaproveita a ativa', async () => {
    const first = await store.findOrStartActive(
      'whatsapp',
      '5586999990001',
      at(0),
    );
    const again = await store.findOrStartActive(
      'whatsapp',
      '5586999990001',
      at(30),
    );

    expect(first.created).toBe(true);
    expect(again.created).toBe(false);
    expect(again.conversation.id).toBe(first.conversation.id);
    const metrics = await store.getMetrics(first.conversation.id);
    expect(metrics?.firstMessageAt).toEqual(at(0));
    expect(metrics?.outcome).toBe('in_progress');
  });

  it('não abre duas conversas ativas para o mesmo contato em paralelo', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        store.findOrStartActive('simulator', 'sim-1', at(0)),
      ),
    );

    const ids = new Set(results.map((r) => r.conversation.id));
    expect(ids.size).toBe(1);
    const count = await connection.db.$count(conversations);
    expect(count).toBe(1);
  });

  it('ignora mensagem repetida pelo ID externo e conta turnos', async () => {
    const { conversation } = await store.findOrStartActive(
      'whatsapp',
      '5586999990001',
      at(0),
    );
    const msg = { conversationId: conversation.id, body: 'oi', at: at(0) };

    const a = await store.recordInbound({ ...msg, externalId: 'wamid.A' });
    const dup = await store.recordInbound({ ...msg, externalId: 'wamid.A' });
    await store.recordInbound({ ...msg, externalId: 'wamid.B', at: at(10) });

    expect(a.duplicate).toBe(false);
    expect(dup.duplicate).toBe(true);
    expect((await store.getMetrics(conversation.id))?.turns).toBe(2);
    expect(await connection.db.$count(messages)).toBe(2);
  });

  it('o banco recusa ID externo duplicado mesmo fora do store', async () => {
    const { conversation } = await store.findOrStartActive(
      'whatsapp',
      '1',
      at(0),
    );
    const row = {
      conversationId: conversation.id,
      direction: 'inbound' as const,
      externalId: 'wamid.X',
      body: 'oi',
    };
    await connection.db.insert(messages).values(row);

    await expect(connection.db.insert(messages).values(row)).rejects.toThrow();
  });

  it('o primeiro motivo de cancelamento vale; o seguinte não o troca', async () => {
    const { conversation } = await store.findOrStartActive(
      'simulator',
      'sim-6',
      at(0),
    );

    await store.markCanceled(conversation.id, at(10), 'Pedido duplicado');
    await store.markCanceled(conversation.id, at(20), 'Outro motivo');

    expect(await store.getMetrics(conversation.id)).toMatchObject({
      outcome: 'canceled',
      cancelReason: 'Pedido duplicado',
      canceledAt: at(10),
    });
  });

  it('sale_created_at fica na primeira venda, mesmo se recriada', async () => {
    const { conversation } = await store.findOrStartActive(
      'simulator',
      'sim-2',
      at(0),
    );

    await store.markSaleCreated(conversation.id, 501, at(45));
    const after = await store.markSaleCreated(conversation.id, 502, at(120));

    expect(after.saleCreatedAt).toEqual(at(45));
    expect(after.revgasSaleId).toBe(501);
    expect(after.outcome).toBe('sale_created');
  });

  it('passagem para atendente marca conversa e métrica', async () => {
    const { conversation } = await store.findOrStartActive(
      'simulator',
      'sim-3',
      at(0),
    );

    const metrics = await store.markHandedOff(
      conversation.id,
      'pediu atendente',
      at(20),
    );

    expect(metrics).toMatchObject({
      handedOff: true,
      handedOffAt: at(20),
      handoffReason: 'pediu atendente',
      outcome: 'handed_off',
    });
    expect(await store.findActive('simulator', 'sim-3')).toBeUndefined();
  });

  it('atendente depois da venda não apaga o resultado da venda', async () => {
    const { conversation } = await store.findOrStartActive(
      'simulator',
      'sim-4',
      at(0),
    );
    await store.markSaleCreated(conversation.id, 600, at(40));

    const metrics = await store.markHandedOff(
      conversation.id,
      'reclamação',
      at(90),
    );

    expect(metrics.outcome).toBe('sale_created');
    expect(metrics.handedOff).toBe(true);
  });

  it('o banco recusa venda antes da primeira mensagem', async () => {
    const { conversation } = await store.findOrStartActive(
      'simulator',
      'sim-5',
      at(60),
    );

    await expect(
      connection.db
        .update(orderMetrics)
        .set({ saleCreatedAt: at(0) })
        .where(sql`${orderMetrics.conversationId} = ${conversation.id}`),
    ).rejects.toThrow();
  });
});
