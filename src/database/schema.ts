import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/*
 * Dados pessoais: `conversations.contact` (telefone), `conversations.collected`
 * (pode ter nome e endereço) e `messages.body`. Ficam só no banco; nunca vão
 * para log. Ver `src/common/log-safe.ts`.
 */

export const channel = pgEnum('channel', ['simulator', 'whatsapp']);

export const conversationStatus = pgEnum('conversation_status', [
  'active',
  'completed',
  'abandoned',
  'handed_off',
]);

export const messageDirection = pgEnum('message_direction', [
  'inbound',
  'outbound',
]);

export const orderOutcome = pgEnum('order_outcome', [
  'in_progress',
  'sale_created',
  'abandoned',
  'handed_off',
  'canceled',
]);

const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/** Sessão da conversa: uma por contato enquanto estiver ativa. */
export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    channel: channel('channel').notNull(),
    /** Telefone (WhatsApp) ou ID do simulador. Dado pessoal. */
    contact: text('contact').notNull(),
    status: conversationStatus('status').notNull().default('active'),
    /** Etapa da máquina de estados (issue #6). */
    step: text('step').notNull().default('identifying'),
    /** Dados já coletados no pedido. Pode conter endereço: não logar. */
    collected: jsonb('collected')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    revgasCustomerId: integer('revgas_customer_id'),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('conversations_one_active_per_contact')
      .on(t.channel, t.contact)
      .where(sql`${t.status} = 'active'`),
    index('conversations_last_message_at').on(t.lastMessageAt),
  ],
).enableRLS();

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    direction: messageDirection('direction').notNull(),
    /**
     * ID da mensagem no canal (wamid no WhatsApp). Único: um reenvio do
     * webhook não grava a mensagem de novo (base da idempotência, #14).
     */
    externalId: text('external_id'),
    /** Texto da mensagem. Dado pessoal: não logar. */
    body: text('body').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('messages_external_id_unique').on(t.externalId),
    index('messages_conversation_created_at').on(t.conversationId, t.createdAt),
  ],
).enableRLS();

/** Métricas do pedido: uma linha por conversa. Tempo = sale − first. */
export const orderMetrics = pgTable(
  'order_metrics',
  {
    conversationId: uuid('conversation_id')
      .primaryKey()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    firstMessageAt: timestamp('first_message_at', {
      withTimezone: true,
    }).notNull(),
    /** Primeira criação da venda. Alterar ou recriar depois não muda. */
    saleCreatedAt: timestamp('sale_created_at', { withTimezone: true }),
    revgasSaleId: integer('revgas_sale_id'),
    /** Mensagens do cliente nesta conversa. */
    turns: integer('turns').notNull().default(0),
    handedOff: boolean('handed_off').notNull().default(false),
    handedOffAt: timestamp('handed_off_at', { withTimezone: true }),
    handoffReason: text('handoff_reason'),
    outcome: orderOutcome('outcome').notNull().default('in_progress'),
    canceledAt: timestamp('canceled_at', { withTimezone: true }),
    /** Tempo acumulado em chamadas ao LLM e à RevGás (issue #15). */
    llmMs: integer('llm_ms').notNull().default(0),
    revgasMs: integer('revgas_ms').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    check('order_metrics_turns_non_negative', sql`${t.turns} >= 0`),
    check(
      'order_metrics_timings_non_negative',
      sql`${t.llmMs} >= 0 AND ${t.revgasMs} >= 0`,
    ),
    check(
      'order_metrics_sale_after_first_message',
      sql`${t.saleCreatedAt} IS NULL OR ${t.saleCreatedAt} >= ${t.firstMessageAt}`,
    ),
    check(
      'order_metrics_handoff_consistent',
      sql`${t.handedOff} = (${t.handedOffAt} IS NOT NULL)`,
    ),
    index('order_metrics_first_message_at').on(t.firstMessageAt),
  ],
).enableRLS();

export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type OrderMetrics = typeof orderMetrics.$inferSelect;
