import { z } from 'zod';
import type { Extraction, Intent } from '../llm/extraction.schema.js';
import type { Expecting } from '../llm/message-extractor.js';
import { PAYMENT_TYPE_CODES, type Address } from '../revgas/revgas.types.js';

/** Etapas da conversa (issue #6). */
export const STEPS = [
  /** Primeira mensagem: busca o cliente pelo telefone. */
  'identifying',
  /** Falta produto, endereço, pagamento ou nome. */
  'collecting',
  /** Resumo mostrado, esperando o "sim". */
  'confirming',
  /** Venda criada na RevGás, aguardando despacho. */
  'sale_created',
  /** Entregador a caminho (avisado pela revenda). */
  'dispatched',
  /** Conversa terminada: concluída, cancelada, abandonada ou com atendente. */
  'closed',
] as const;
export type Step = (typeof STEPS)[number];

const addressSchema = z.object({
  street: z.string(),
  number: z.string(),
  neighborhood: z.string(),
  complement: z.string().optional(),
  landmark: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postalCode: z.string().optional(),
  latitude: z.string().optional(),
  longitude: z.string().optional(),
}) satisfies z.ZodType<Address>;

/**
 * Rascunho do pedido, guardado em `conversations.collected`. Validado ao
 * carregar: um formato antigo ou corrompido recomeça o rascunho.
 */
export const draftSchema = z.object({
  customer: z
    .object({
      id: z.number().nullable(),
      name: z.string().nullable(),
      /**
       * Até 3 endereços conhecidos, mais recente primeiro: o das últimas
       * vendas e o do cadastro (a API guarda um só no cliente).
       */
      savedAddresses: z.array(addressSchema).max(3).default([]),
    })
    .nullable()
    .default(null),
  item: z
    .object({
      productId: z.number(),
      description: z.string(),
      quantity: z.number().int().positive(),
      unitValue: z.number().nonnegative(),
    })
    .nullable()
    .default(null),
  address: addressSchema.nullable().default(null),
  payment: z.enum(PAYMENT_TYPE_CODES).nullable().default(null),
  /** Venda criada a partir do último pedido ("o mesmo de sempre"). */
  fromLastOrder: z.boolean().default(false),
  saleId: z.number().nullable().default(null),
  /** Mensagens seguidas que o bot não entendeu. */
  misunderstandings: z.number().int().nonnegative().default(0),
  /** O que a última pergunta pediu, para ler a próxima resposta. */
  expecting: z.string().default('anything'),
});
export type Draft = z.infer<typeof draftSchema>;

export const emptyDraft = (): Draft => draftSchema.parse({});

export interface Button {
  /** Volta como `buttonId` quando o cliente toca. */
  id: string;
  label: string;
}

export interface Reply {
  text: string;
  buttons?: Button[];
}

/**
 * O que o cliente fez neste turno, já normalizado. Botão e texto chegam
 * iguais aos handlers: o botão vira uma intenção sem passar pelo LLM.
 */
export interface Signal {
  intent: Intent | 'unknown';
  /** Campos extraídos do texto (null quando veio de botão ou o LLM falhou). */
  extraction: Extraction | null;
  /** Valor do botão, ex.: `product:10`, `payment:PIX`, `change:address`. */
  button: string | null;
  /** O LLM falhou: o handler deve oferecer botões. */
  llmUnavailable: boolean;
}

export type TurnEvent =
  | { type: 'customer_identified'; customerId: number | null }
  | { type: 'sale_created'; saleId: number }
  | { type: 'sale_canceled'; saleId: number }
  | { type: 'handoff'; reason: string }
  | { type: 'closed'; status: 'completed' | 'canceled' };

export interface SessionState {
  step: Step;
  draft: Draft;
}

export interface TurnOutcome extends SessionState {
  replies: Reply[];
  events: TurnEvent[];
}

export type { Expecting };
