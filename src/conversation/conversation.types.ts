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
      /**
       * Só dígitos, só quando a nota exige, só até criar o cadastro: depois
       * sai do rascunho (LGPD).
       */
      cpf: z.string().nullable().default(null),
      /** Cliente novo e a nota exige CPF (CPF_REQUIRED). */
      needsCpf: z.boolean().default(false),
      /**
       * Formas além das padrão que a revenda liberou para este cliente:
       * fiado (CREDITO_CLIENTE) e vale gás (VALEGAS). Issue #10.
       */
      authorizedPayments: z.array(z.enum(PAYMENT_TYPE_CODES)).default([]),
      /** Forma do último pedido: aparece primeiro nas opções. */
      lastPayment: z.enum(PAYMENT_TYPE_CODES).nullable().default(null),
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
  /** Troco para quanto, quando paga em dinheiro. */
  changeFor: z.number().positive().nullable().default(null),
  /** Formas recusadas nesta conversa: não são oferecidas de novo. */
  declinedPayments: z.array(z.enum(PAYMENT_TYPE_CODES)).default([]),
  /** Recusas de pagamento seguidas; na segunda, atendente. */
  paymentFailures: z.number().int().nonnegative().default(0),
  /** Venda criada a partir do último pedido ("o mesmo de sempre"). */
  fromLastOrder: z.boolean().default(false),
  saleId: z.number().nullable().default(null),
  /** Venda criada com endereço novo: perguntamos se salva no cadastro. */
  pendingAddressSave: z.boolean().default(false),
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
  /**
   * Como o canal mostra as opções: até 3 em botões, mais que isso em lista
   * (limite do WhatsApp). Preenchido pela máquina em toda resposta.
   */
  presentation?: 'buttons' | 'list';
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
  /**
   * Texto cru, para o que o código lê sozinho (CPF). Não vai para o LLM
   * de novo nem para log.
   */
  text: string | null;
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
