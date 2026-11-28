import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConversationStore } from '../database/conversation.store.js';
import {
  connectDatabase,
  type DatabaseConnection,
} from '../database/database.js';
import { handoffView } from './handoff-view.js';
import { isLocalDemoRequest } from './local-demo.guard.js';

let connection: DatabaseConnection;
let store: ConversationStore;

beforeAll(async () => {
  connection = await connectDatabase();
  store = new ConversationStore(connection.db);
});

afterAll(async () => {
  await connection.close();
});

describe('painel do atendente', () => {
  it('lista a passagem com motivo, dados coletados e conversa, sem o CPF', async () => {
    const at = new Date('2026-11-27T23:00:00Z');
    const { conversation } = await store.findOrStartActive(
      'simulator',
      'cliente-1',
      at,
    );
    await store.recordInbound({
      conversationId: conversation.id,
      externalId: 'a-1',
      body: 'atendente',
      at,
    });
    await store.saveState(
      conversation.id,
      {
        step: 'closed',
        collected: {
          customer: { id: null, name: 'Ana Teste', cpf: '52998224725' },
          payment: 'PIX',
        },
      },
      at,
    );
    await store.recordOutbound(conversation.id, 'Vou te passar', at);
    await store.markHandedOff(conversation.id, 'cliente pediu atendente', at);

    const [handoff] = await store.listHandoffs();
    const view = handoffView(handoff!, {
      opensAt: 8 * 60,
      closesAt: 18 * 60,
      days: [1, 2, 3, 4, 5],
      timeZone: 'America/Fortaleza',
    });

    expect(view).toMatchObject({
      contact: 'cliente-1',
      reason: 'cliente pediu atendente',
      afterHours: true,
    });
    expect(view.summary).toContainEqual({ label: 'Pagamento', value: 'PIX' });
    expect(view.messages.map((m) => m.from)).toEqual(['cliente', 'bot']);
    expect(JSON.stringify(view)).not.toContain('52998224725');
  });

  it.each([
    ['127.0.0.1', { host: 'localhost:3000' }, true],
    ['::1', { host: '[::1]:3000' }, true],
    ['192.168.0.10', { host: 'localhost:3000' }, false],
    ['127.0.0.1', { host: 'algo.trycloudflare.com' }, false],
    ['127.0.0.1', { host: 'localhost', 'x-forwarded-for': '1.2.3.4' }, false],
  ])('acesso de %s com %o = %s', (remoteAddress, headers, allowed) => {
    expect(isLocalDemoRequest({ remoteAddress, headers })).toBe(allowed);
  });
});
