import { z } from 'zod';

/*
 * O que o LLM pode devolver. É só extração do texto do cliente: não há campo
 * de preço, estoque, desconto, status do pedido ou ID de produto. Esses vêm
 * do código, com dados da API.
 *
 * Todos os campos existem sempre (podem ser null): exigência do modo
 * `strict` do Groq e garantia de formato fixo para quem consome.
 */

export const INTENTS = [
  /** Quer pedir gás ou está informando dados do pedido. */
  'order',
  /** "O mesmo de sempre", repetir o último pedido. */
  'repeat_last',
  /** Concorda com a pergunta ou o resumo ("sim", "pode mandar"). */
  'confirm',
  /** Discorda ("não", "errado"). */
  'deny',
  'change_product',
  'change_address',
  'change_payment',
  'cancel',
  /** Quer falar com uma pessoa. */
  'human',
  'complaint',
  'greeting',
  /** Qualquer outra coisa (inclui pedido fora de gás). */
  'other',
] as const;

export const PAYMENT_METHODS = [
  'money',
  'pix',
  'debit_card',
  'credit_card',
  'vale_gas',
  'other',
] as const;

const nullableText = z.string().max(200).nullable();

export const extractionSchema = z.strictObject({
  intent: z.enum(INTENTS),
  /** Peso do botijão citado (13 para P13). */
  productSizeKg: z.number().int().min(1).max(90).nullable(),
  /** "Um maior" / "um menor" que o atual. */
  productRelative: z.enum(['bigger', 'smaller']).nullable(),
  quantity: z.number().int().min(1).max(99).nullable(),
  address: z
    .strictObject({
      street: nullableText,
      number: nullableText,
      neighborhood: nullableText,
      complement: nullableText,
      landmark: nullableText,
    })
    .nullable(),
  paymentMethod: z.enum(PAYMENT_METHODS).nullable(),
  /** Troco para quanto, em reais, quando paga em dinheiro. */
  changeFor: z.number().min(0).max(10_000).nullable(),
  customerName: nullableText,
});

export type Extraction = z.infer<typeof extractionSchema>;
export type Intent = (typeof INTENTS)[number];

/** JSON Schema para o `response_format` do provedor. */
export function extractionJsonSchema(): Record<string, unknown> {
  const { $schema: _ignored, ...schema } = z.toJSONSchema(extractionSchema, {
    target: 'draft-7',
  });
  return schema;
}
