/**
 * Testes de contrato do `RevgasClient`. A mesma suíte roda contra o fake e
 * contra a API real; contra a real, só a parte de leitura (`writes: false`),
 * porque não há ambiente de teste e um POST criaria pedido de verdade.
 */
import { describe, expect, it } from 'vitest';
import type { RevgasClient } from './revgas-client.js';
import { RevgasError } from './revgas.errors.js';
import { PAYMENT_TYPE_CODES, type Address } from './revgas.types.js';

export interface ContractTarget {
  client: () => RevgasClient;
  /** Client com chave inválida, para checar o 401. */
  clientWithBadKey: () => RevgasClient;
}

export interface WriteFixtures {
  recurringPhone: string;
  recurringCustomerId: number;
  customerWithoutSalesId: number;
  productId: number;
  cancelMotiveId: number;
}

const address: Address = {
  street: 'Rua Teste',
  number: '10',
  neighborhood: 'Bairro Teste',
  city: 'Teresina',
  state: 'PI',
};

async function expectRevgasError(
  promise: Promise<unknown>,
  code: RevgasError['code'],
): Promise<RevgasError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(error instanceof RevgasError)) {
    throw new Error(`esperava RevgasError ${code}, recebeu ${String(error)}`);
  }
  expect(error.code).toBe(code);
  return error;
}

export function readContract(target: ContractTarget): void {
  describe('leitura', () => {
    it('lista produtos ativos com estoque numérico', async () => {
      const products = await target.client().listProducts();

      expect(Array.isArray(products)).toBe(true);
      for (const p of products) {
        expect(p).toEqual({
          id: expect.any(Number),
          description: expect.any(String),
          stockQuantity: expect.any(Number),
        });
      }
    });

    it('detalha um produto com o estoque do momento', async () => {
      const client = target.client();
      const [first] = await client.listProducts();
      if (!first) return;

      const product = await client.getProduct(first.id);

      expect(product.id).toBe(first.id);
      expect(typeof product.stockQuantity).toBe('number');
    });

    it('lista formas de pagamento ativas com códigos conhecidos', async () => {
      const types = await target.client().listPaymentTypes();

      for (const t of types) {
        expect(PAYMENT_TYPE_CODES).toContain(t.code);
        expect(typeof t.description).toBe('string');
      }
    });

    it('lista motivos de cancelamento', async () => {
      const motives = await target.client().listCancelMotives();

      for (const m of motives) {
        expect(m).toEqual({
          id: expect.any(Number),
          description: expect.any(String),
        });
      }
    });

    it('busca cliente por telefone sem quebrar', async () => {
      const customers = await target
        .client()
        .findCustomersByPhone('11900000000');

      expect(Array.isArray(customers)).toBe(true);
    });

    it('não chama a API com telefone inválido', async () => {
      await expect(
        target.client().findCustomersByPhone('abc'),
      ).resolves.toEqual([]);
    });

    it('recusa chave inválida com unauthorized', async () => {
      await expectRevgasError(
        target.clientWithBadKey().listProducts(),
        'unauthorized',
      );
    });
  });
}

export function writeContract(target: ContractTarget, fx: WriteFixtures): void {
  describe('clientes', () => {
    it('acha o cliente pelo telefone, com ou sem 55', async () => {
      const client = target.client();
      const national = fx.recurringPhone.replace(/^55/, '');

      const [withCountry] = await client.findCustomersByPhone(
        fx.recurringPhone,
      );
      const [withoutCountry] = await client.findCustomersByPhone(national);

      expect(withCountry?.id).toBe(fx.recurringCustomerId);
      expect(withoutCountry?.id).toBe(fx.recurringCustomerId);
      expect(withCountry?.address?.street).toBeTruthy();
    });

    it('cria cliente novo e encontra pelo telefone', async () => {
      const client = target.client();

      const created = await client.createCustomer({
        name: 'Cliente Novo',
        phone: '(86) 98888-7777',
        address,
      });
      const [found] = await client.findCustomersByPhone('5586988887777');

      expect(created.name).toBe('Cliente Novo');
      expect(created.address).toMatchObject({
        street: 'Rua Teste',
        number: '10',
      });
      expect(found?.id).toBe(created.id);
    });

    it('troca o endereço preservando nome e telefone', async () => {
      const client = target.client();
      const before = await client.getCustomer(fx.recurringCustomerId);

      const after = await client.updateCustomerAddress(
        fx.recurringCustomerId,
        address,
      );

      expect(after.address).toMatchObject({ street: 'Rua Teste' });
      expect(after.name).toBe(before.name);
      expect(after.phones).toEqual(before.phones);
    });
  });

  describe('vendas', () => {
    it('devolve a última venda do cliente recorrente', async () => {
      const sale = await target.client().findLastSale(fx.recurringCustomerId);

      expect(sale?.customerId).toBe(fx.recurringCustomerId);
      expect(sale?.items.length).toBeGreaterThan(0);
    });

    it('devolve null para cliente sem vendas', async () => {
      await expect(
        target.client().findLastSale(fx.customerWithoutSalesId),
      ).resolves.toBeNull();
    });

    it('cria, detalha, altera e cancela uma venda', async () => {
      const client = target.client();
      const input = {
        customerId: fx.recurringCustomerId,
        address,
        items: [{ productId: fx.productId, quantity: 2, unitValue: 110.5 }],
        payments: [{ code: 'PIX' as const, value: 221 }],
      };

      const created = await client.createSale(input);
      expect(created.status).toBe('OPEN');
      expect(created.total).toBe(221);
      expect(created.items).toEqual([
        expect.objectContaining({
          productId: fx.productId,
          quantity: 2,
          unitValue: 110.5,
        }),
      ]);

      const fetched = await client.getSale(created.id);
      expect(fetched).toEqual(created);

      const updated = await client.updateSale(created.id, {
        ...input,
        items: [{ productId: fx.productId, quantity: 1, unitValue: 110.5 }],
        payments: [{ code: 'MONEY', value: 110.5 }],
      });
      expect(updated.total).toBe(110.5);
      expect(updated.payments).toEqual([{ code: 'MONEY', value: 110.5 }]);

      const canceled = await client.cancelSale(created.id, fx.cancelMotiveId);
      expect(canceled.status).toBe('CANCEL');
    });

    it('recusa venda com produto inexistente apontando o campo', async () => {
      const error = await expectRevgasError(
        target.client().createSale({
          customerId: fx.recurringCustomerId,
          address,
          items: [{ productId: 999_999, quantity: 1, unitValue: 100 }],
          payments: [{ code: 'MONEY', value: 100 }],
        }),
        'validation',
      );

      expect(error.details.fields?.[0]?.field).toMatch(/products/);
    });
  });
}
