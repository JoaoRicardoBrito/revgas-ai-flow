import { and, eq, sql } from 'drizzle-orm';
import type { Database } from './database.js';
import {
  conversations,
  messages,
  orderMetrics,
  type Conversation,
  type OrderMetrics,
} from './schema.js';

export type Channel = Conversation['channel'];

export interface InboundMessage {
  conversationId: string;
  /** ID do canal (wamid). Repetido = reenvio do webhook. */
  externalId: string;
  body: string;
  at: Date;
}

export type InboundResult =
  { duplicate: false; messageId: string } | { duplicate: true };

/**
 * Persistência da conversa e das métricas do pedido. Nada aqui loga: os
 * dados têm telefone, endereço e texto do cliente.
 */
export class ConversationStore {
  constructor(private readonly db: Database) {}

  /**
   * Devolve a conversa ativa do contato ou abre uma nova, já com
   * `first_message_at`. Seguro sob concorrência: o índice único parcial
   * garante uma ativa por contato.
   */
  async findOrStartActive(
    channel: Channel,
    contact: string,
    at: Date,
  ): Promise<{ conversation: Conversation; created: boolean }> {
    const existing = await this.findActive(channel, contact);
    if (existing) return { conversation: existing, created: false };

    return this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(conversations)
        .values({
          channel,
          contact,
          createdAt: at,
          updatedAt: at,
          lastMessageAt: at,
        })
        .onConflictDoNothing({
          target: [conversations.channel, conversations.contact],
          where: sql`${conversations.status} = 'active'`,
        })
        .returning();
      if (!created) {
        const winner = await this.findActive(channel, contact, tx);
        if (!winner) throw new Error('conversa ativa sumiu durante a criação');
        return { conversation: winner, created: false };
      }
      await tx.insert(orderMetrics).values({
        conversationId: created.id,
        firstMessageAt: at,
        createdAt: at,
      });
      return { conversation: created, created: true };
    });
  }

  async findActive(
    channel: Channel,
    contact: string,
    db: Pick<Database, 'select'> = this.db,
  ): Promise<Conversation | undefined> {
    const [row] = await db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.channel, channel),
          eq(conversations.contact, contact),
          eq(conversations.status, 'active'),
        ),
      )
      .limit(1);
    return row;
  }

  /** Grava a mensagem do cliente e conta o turno; ignora reenvios. */
  async recordInbound(input: InboundMessage): Promise<InboundResult> {
    return this.db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(messages)
        .values({
          conversationId: input.conversationId,
          direction: 'inbound',
          externalId: input.externalId,
          body: input.body,
          createdAt: input.at,
        })
        .onConflictDoNothing({ target: messages.externalId })
        .returning({ id: messages.id });
      if (!inserted) return { duplicate: true };

      await tx
        .update(orderMetrics)
        .set({ turns: sql`${orderMetrics.turns} + 1` })
        .where(eq(orderMetrics.conversationId, input.conversationId));
      await tx
        .update(conversations)
        .set({ lastMessageAt: input.at, updatedAt: input.at })
        .where(eq(conversations.id, input.conversationId));
      return { duplicate: false, messageId: inserted.id };
    });
  }

  async recordOutbound(
    conversationId: string,
    body: string,
    at: Date,
    externalId?: string,
  ): Promise<void> {
    await this.db.insert(messages).values({
      conversationId,
      direction: 'outbound',
      externalId,
      body,
      createdAt: at,
    });
  }

  /**
   * Registra a venda. Só a primeira chamada conta para o tempo: alterar ou
   * recriar a venda depois não move `sale_created_at`.
   */
  async markSaleCreated(
    conversationId: string,
    revgasSaleId: number,
    at: Date,
  ): Promise<OrderMetrics> {
    const [row] = await this.db
      .update(orderMetrics)
      .set({
        saleCreatedAt: sql`COALESCE(${orderMetrics.saleCreatedAt}, ${at.toISOString()}::timestamptz)`,
        revgasSaleId: sql`COALESCE(${orderMetrics.revgasSaleId}, ${revgasSaleId})`,
        outcome: 'sale_created',
      })
      .where(eq(orderMetrics.conversationId, conversationId))
      .returning();
    if (!row)
      throw new Error(`métricas da conversa ${conversationId} não existem`);
    return row;
  }

  /** Passagem para atendente. Venda já criada continua como resultado. */
  async markHandedOff(
    conversationId: string,
    reason: string,
    at: Date,
  ): Promise<OrderMetrics> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(orderMetrics)
        .set({
          handedOff: true,
          handedOffAt: sql`COALESCE(${orderMetrics.handedOffAt}, ${at.toISOString()}::timestamptz)`,
          handoffReason: reason,
          outcome: sql`CASE WHEN ${orderMetrics.saleCreatedAt} IS NULL THEN 'handed_off'::order_outcome ELSE ${orderMetrics.outcome} END`,
        })
        .where(eq(orderMetrics.conversationId, conversationId))
        .returning();
      if (!row)
        throw new Error(`métricas da conversa ${conversationId} não existem`);
      await tx
        .update(conversations)
        .set({ status: 'handed_off', updatedAt: at })
        .where(eq(conversations.id, conversationId));
      return row;
    });
  }

  async getMetrics(conversationId: string): Promise<OrderMetrics | undefined> {
    const [row] = await this.db
      .select()
      .from(orderMetrics)
      .where(eq(orderMetrics.conversationId, conversationId));
    return row;
  }
}
