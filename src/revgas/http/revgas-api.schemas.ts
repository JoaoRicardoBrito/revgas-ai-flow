import { z } from 'zod';
import { PAYMENT_TYPE_CODES, SALE_STATUSES } from '../revgas.types.js';

/*
 * Formato das respostas da API da RevGás, só com os campos que usamos.
 * Campos ausentes na prática viram `null`/`undefined`, por isso o uso amplo
 * de `nullish()`: a documentação não marca nenhum campo como obrigatório.
 */

const text = z.string().nullish();
/** Valores monetários: a documentação diz `number`, mas aceitamos texto decimal. */
const money = z.union([z.number(), z.string()]).pipe(z.coerce.number());

export const paginationSchema = z.object({
  page: z.number().nullish(),
  page_size: z.number().nullish(),
  count: z.number().nullish(),
  total_count: z.number().nullish(),
  has_next: z.boolean().nullish(),
});

export const pageOf = <T extends z.ZodType>(item: T) =>
  z.object({
    data: z.array(item),
    pagination: paginationSchema.nullish(),
  });

export const customerDto = z.object({
  id: z.number(),
  name: text,
  phones: z.array(z.string()).nullish(),
  location: text,
  number: text,
  neighborhood: text,
  complement: text,
  landmark: text,
  postal_code: text,
  city: text,
  state_federation: text,
  latitude: text,
  longitude: z.union([z.string(), z.number()]).nullish(),
  last_sale: text,
});
export type CustomerDto = z.infer<typeof customerDto>;

export const productDto = z.object({
  id: z.number(),
  description: text,
  stock_quantity: z.number().nullish(),
});

export const paymentTypeDto = z.object({
  id: z.number(),
  payment_type: z.enum(PAYMENT_TYPE_CODES),
  payment_type_description: text,
  status: text,
});

export const cancelMotiveDto = z.object({
  id: z.number(),
  description: text,
  status: z.boolean().nullish(),
});

export const saleDto = z.object({
  id: z.number(),
  status: z.enum(SALE_STATUSES),
  total: money.nullish(),
  customer_id: z.number().nullish(),
  location: text,
  number: text,
  neighborhood: text,
  complement: text,
  landmark: text,
  city: text,
  state_federation: text,
  lat: text,
  lon: text,
  observation: text,
  products: z
    .array(
      z.object({
        product_id: z.number(),
        product_description: text,
        quantity: z.number(),
        value: money,
      }),
    )
    .nullish(),
  payments: z
    .array(z.object({ type: z.enum(PAYMENT_TYPE_CODES), value: money }))
    .nullish(),
});
export type SaleDto = z.infer<typeof saleDto>;

/** Corpo dos erros padrão (400, 401, 402, 403, 409, 422, 500). */
export const errorBody = z.object({
  message: z.string().nullish(),
  data: z
    .array(
      z.object({
        field: z.string().nullish(),
        message: z.string().nullish(),
        value_id: z.union([z.string(), z.number()]).nullish(),
      }),
    )
    .nullish(),
});
