import { describe, expect, it } from 'vitest';
import { extractionJsonSchema, extractionSchema } from './extraction.schema.js';

type JsonSchema = {
  type?: unknown;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: unknown;
  anyOf?: JsonSchema[];
  items?: JsonSchema;
};

function objectsIn(schema: JsonSchema, path = '$'): [string, JsonSchema][] {
  const found: [string, JsonSchema][] = [];
  if (schema.properties) found.push([path, schema]);
  for (const [key, child] of Object.entries(schema.properties ?? {})) {
    found.push(...objectsIn(child, `${path}.${key}`));
  }
  for (const [i, child] of (schema.anyOf ?? []).entries()) {
    found.push(...objectsIn(child, `${path}|${i}`));
  }
  if (schema.items) found.push(...objectsIn(schema.items, `${path}[]`));
  return found;
}

describe('extractionJsonSchema (modo strict do Groq)', () => {
  const schema = extractionJsonSchema() as JsonSchema;

  it('não leva $schema', () => {
    expect(schema).not.toHaveProperty('$schema');
  });

  it('todo objeto exige todas as chaves e recusa chaves extras', () => {
    const objects = objectsIn(schema);
    expect(objects.length).toBeGreaterThanOrEqual(2);

    for (const [path, obj] of objects) {
      expect(obj.additionalProperties, path).toBe(false);
      expect([...(obj.required ?? [])].toSorted(), path).toEqual(
        Object.keys(obj.properties ?? {}).toSorted(),
      );
    }
  });

  it('não tem campo de preço, estoque ou status', () => {
    const keys = JSON.stringify(schema).toLowerCase();

    for (const forbidden of [
      'price',
      'preco',
      'value',
      'stock',
      'status',
      'discount',
      'product_id',
      'productid',
    ]) {
      expect(keys).not.toContain(`"${forbidden}"`);
    }
  });
});

describe('extractionSchema', () => {
  const empty = {
    intent: 'order',
    productSizeKg: null,
    productRelative: null,
    quantity: null,
    address: null,
    paymentMethod: null,
    changeFor: null,
    customerName: null,
  };

  it('aceita extração mínima', () => {
    expect(extractionSchema.safeParse(empty).success).toBe(true);
  });

  it('recusa chave extra, como um preço inventado', () => {
    expect(extractionSchema.safeParse({ ...empty, price: 0 }).success).toBe(
      false,
    );
  });

  it('recusa intenção fora da lista', () => {
    expect(
      extractionSchema.safeParse({ ...empty, intent: 'refund' }).success,
    ).toBe(false);
  });

  it('recusa quantidade absurda', () => {
    expect(
      extractionSchema.safeParse({ ...empty, quantity: 500 }).success,
    ).toBe(false);
  });
});
