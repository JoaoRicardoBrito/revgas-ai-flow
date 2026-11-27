import type {
  FakeCancelMotive,
  FakeCustomer,
  FakePaymentType,
  FakeProduct,
  FakeSale,
} from './fake-revgas-api.js';

/** Dados fictícios. Nenhum cliente real. */
export const FAKE_ESTABLISHMENT_ID = 1;

export const SEED = {
  recurringCustomer: { id: 1, phone: '5586999990001' },
  customerWithoutSales: { id: 2, phone: '5586999990002' },
  products: { p13: 10, p20: 11, p45: 12 },
  cancelMotive: 1,
  lastSaleOfRecurring: 100,
  olderSalesOfRecurring: { atWork: 99, atHomeAgain: 98 },
} as const;

/** Venda antiga e conferida da cliente recorrente, num endereço dado. */
function pastSale(
  id: number,
  createdAt: string,
  address: {
    location: string;
    number: string;
    neighborhood: string;
    complement: string;
  },
): FakeSale {
  return {
    id,
    status: 'CHECK',
    total: 115,
    channel: 'DISK',
    origin: 'REVGAS',
    customer_id: SEED.recurringCustomer.id,
    customer_name: 'Maria Cliente Exemplo',
    establishment_id: FAKE_ESTABLISHMENT_ID,
    ...address,
    landmark: null,
    city: 'Teresina',
    state_federation: 'PI',
    lat: null,
    lon: null,
    observation: null,
    products: [
      {
        id: id * 10,
        product_id: SEED.products.p13,
        product_description: 'GLP 13KG',
        quantity: 1,
        value: 115,
        discount: 0,
      },
    ],
    payments: [{ id: id * 10, type: 'MONEY', value: 115 }],
    logs: [{ id: id * 10, sale_id: id, status: 'OPEN', created_at: createdAt }],
    created_at: createdAt,
  };
}

export interface FakeSeed {
  customers: FakeCustomer[];
  products: FakeProduct[];
  paymentTypes: FakePaymentType[];
  sales: FakeSale[];
  cancelMotives: FakeCancelMotive[];
}

export function createSeed(now: Date): FakeSeed {
  const daysAgo = (n: number) =>
    new Date(now.getTime() - n * 86_400_000).toISOString();
  const lastSaleAt = daysAgo(20);

  const customers: FakeCustomer[] = [
    {
      id: SEED.recurringCustomer.id,
      created_at: daysAgo(400),
      updated_at: daysAgo(20),
      name: 'Maria Cliente Exemplo',
      type: 'PHYSICAL',
      phones: [SEED.recurringCustomer.phone],
      location: 'Rua das Flores',
      number: '123',
      neighborhood: 'Centro',
      complement: 'Casa',
      landmark: 'Perto da praça',
      postal_code: '64000000',
      city: 'Teresina',
      state_federation: 'PI',
      latitude: null,
      longitude: null,
      last_sale: lastSaleAt,
    },
    {
      id: SEED.customerWithoutSales.id,
      created_at: daysAgo(5),
      updated_at: daysAgo(5),
      name: 'João Cliente Exemplo',
      type: 'PHYSICAL',
      phones: [SEED.customerWithoutSales.phone],
      location: null,
      number: null,
      neighborhood: null,
      complement: null,
      landmark: null,
      postal_code: null,
      city: null,
      state_federation: null,
      latitude: null,
      longitude: null,
      last_sale: null,
    },
  ];

  const product = (
    id: number,
    description: string,
    stock: number,
  ): FakeProduct => ({
    id,
    description,
    stock_quantity: stock,
    establishment_id: FAKE_ESTABLISHMENT_ID,
    inactive: false,
  });
  const products: FakeProduct[] = [
    product(SEED.products.p13, 'GLP 13KG', 40),
    product(SEED.products.p20, 'GLP 20KG', 8),
    product(SEED.products.p45, 'GLP 45KG', 3),
    { ...product(13, 'GLP 8KG', 0), inactive: true },
  ];

  const paymentType = (
    id: number,
    code: FakePaymentType['payment_type'],
    description: string,
    status: FakePaymentType['status'] = 'ACTIVE',
  ): FakePaymentType => ({
    id,
    payment_type: code,
    payment_type_description: description,
    status,
    establishment_id: FAKE_ESTABLISHMENT_ID,
  });
  const paymentTypes: FakePaymentType[] = [
    paymentType(1, 'MONEY', 'Dinheiro'),
    paymentType(2, 'PIX', 'PIX'),
    paymentType(3, 'CARTAO_DE_DEBITO', 'Cartão de Débito'),
    paymentType(4, 'CARTAO_DE_CREDITO', 'Cartão de Crédito'),
    paymentType(5, 'VALEGAS', 'Vale Gás'),
    paymentType(6, 'BANKDRAFT', 'Cheque', 'INACTIVE'),
  ];

  const sales: FakeSale[] = [
    {
      id: SEED.lastSaleOfRecurring,
      status: 'CHECK',
      total: 120,
      channel: 'WHATSAPP',
      origin: 'REVGAS',
      customer_id: SEED.recurringCustomer.id,
      customer_name: 'Maria Cliente Exemplo',
      establishment_id: FAKE_ESTABLISHMENT_ID,
      location: 'Rua das Flores',
      number: '123',
      neighborhood: 'Centro',
      complement: 'Casa',
      landmark: 'Perto da praça',
      city: 'Teresina',
      state_federation: 'PI',
      lat: null,
      lon: null,
      observation: null,
      products: [
        {
          id: 1,
          product_id: SEED.products.p13,
          product_description: 'GLP 13KG',
          quantity: 1,
          value: 120,
          discount: 0,
        },
      ],
      payments: [{ id: 1, type: 'PIX', value: 120 }],
      logs: [
        {
          id: 1,
          sale_id: SEED.lastSaleOfRecurring,
          status: 'OPEN',
          created_at: lastSaleAt,
        },
      ],
      created_at: lastSaleAt,
    },
    pastSale(SEED.olderSalesOfRecurring.atWork, daysAgo(40), {
      location: 'Avenida Frei Serafim',
      number: '900',
      neighborhood: 'Centro',
      complement: 'Sala 2',
    }),
    // Mesmo endereço da última venda: não deve virar opção repetida.
    pastSale(SEED.olderSalesOfRecurring.atHomeAgain, daysAgo(60), {
      location: 'Rua das Flores',
      number: '123',
      neighborhood: 'Centro',
      complement: 'Casa',
    }),
  ];

  const cancelMotives: FakeCancelMotive[] = [
    {
      id: SEED.cancelMotive,
      description: 'Desistência do cliente',
      status: true,
    },
    { id: 2, description: 'Pedido duplicado', status: true },
    { id: 3, description: 'Motivo antigo', status: false },
  ];

  return { customers, products, paymentTypes, sales, cancelMotives };
}
