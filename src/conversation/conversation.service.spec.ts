import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { ConversationStore } from '../database/conversation.store.js';
import {
  connectDatabase,
  type DatabaseConnection,
} from '../database/database.js';
import { conversations, messages } from '../database/schema.js';
import type { Extraction } from '../llm/extraction.schema.js';
import {
  LlmError,
  type JsonCompletion,
  type JsonCompletionRequest,
  type LlmClient,
} from '../llm/llm-client.js';
import { MessageExtractor } from '../llm/message-extractor.js';
import { SEED } from '../revgas/fake/seed.js';
import {
  ConversationService,
  type IncomingMessage,
} from './conversation.service.js';
import { fakeRevgas, fullAddress, NO_DATA } from './testing.js';

/** LLM que responde por texto exato; texto desconhecido = fora do ar. */
class LookupLlm implements LlmClient {
  readonly provider = 'lookup';
  calls = 0;
  /** Tudo o que foi enviado ao LLM. */
  readonly sent: string[] = [];

  constructor(private readonly answers: Record<string, Partial<Extraction>>) {}

  completeJson(request: JsonCompletionRequest): Promise<JsonCompletion> {
    this.calls++;
    this.sent.push(request.system, request.user);
    const text =
      /<mensagem>\n([\s\S]*)\n<\/mensagem>/.exec(request.user)?.[1] ?? '';
    const answer = this.answers[text];
    if (!answer) return Promise.reject(new LlmError('unavailable', 'fora'));
    return Promise.resolve({
      content: JSON.stringify({ ...NO_DATA, intent: 'order', ...answer }),
      model: 'lookup',
    });
  }
}

const TTL_MS = 30 * 60_000;
const t0 = new Date('2026-11-27T12:00:00Z');
const at = (seconds: number) => new Date(t0.getTime() + seconds * 1000);

let connection: DatabaseConnection;
let store: ConversationStore;

beforeAll(async () => {
  connection = await connectDatabase();
  store = new ConversationStore(connection.db);
});

afterAll(async () => {
  await connection.close();
});

beforeEach(async () => {
  await connection.db.delete(conversations);
});

function setup(options: { cpfRequired?: boolean } = {}) {
  const { fake, revgas, catalog } = fakeRevgas();
  const llm = new LookupLlm({
    'quero um P13 na rua nova 45, fátima, no pix, sou Ana Teste': {
      productSizeKg: 13,
      address: fullAddress,
      paymentMethod: 'pix',
      customerName: 'Ana Teste',
    },
    'quero um P13, cpf [cpf]': { productSizeKg: 13 },
    'Rua Nova, 45 - Fátima': { intent: 'change_address', address: fullAddress },
    'o mesmo de sempre': { intent: 'repeat_last' },
    'quero um P13 na rua nova 45, fátima, no pix': {
      productSizeKg: 13,
      address: fullAddress,
      paymentMethod: 'pix',
    },
    'Ana Teste': { customerName: 'Ana Teste' },
    cancela: { intent: 'cancel' },
  });
  const service = new ConversationService(
    store,
    new MessageExtractor(llm),
    revgas,
    catalog,
    {
      ttlMs: TTL_MS,
      cpfRequired: options.cpfRequired ?? false,
      // Turno instantâneo, para os horários esperados serem exatos.
      clock: () => 0,
    },
  );
  let seq = 0;
  const send = (
    contact: string,
    content: Pick<IncomingMessage, 'text' | 'buttonId' | 'location'>,
    when: Date,
  ) => {
    const message: IncomingMessage = {
      channel: 'whatsapp',
      contact,
      externalId: `wamid.${++seq}`,
      at: when,
      ...content,
    };
    return { message, result: service.handleIncoming(message) };
  };
  return { fake, llm, service, send };
}

const RECURRING = SEED.recurringCustomer.phone;

describe('ConversationService', () => {
  it('recorrente: dois toques do "oi" até a venda, com métricas', async () => {
    const { send, llm, fake } = setup();

    const offer = await send(RECURRING, { text: 'o mesmo de sempre' }, at(0))
      .result;
    expect(offer.step).toBe('confirming');
    const done = await send(RECURRING, { buttonId: 'confirm' }, at(8)).result;

    expect(done.step).toBe('sale_created');
    expect(llm.calls).toBe(1); // botão não passa pelo LLM
    const metrics = await store.getMetrics(done.conversationId);
    expect(metrics).toMatchObject({
      firstMessageAt: at(0),
      saleCreatedAt: at(8),
      turns: 2,
      outcome: 'sale_created',
      revgasSaleId: fake.sales.at(-1)?.id,
    });
  });

  it('novo: coleta na mesma conversa e grava etapa e rascunho', async () => {
    const { send, fake } = setup();
    const phone = '5586977776666';

    const ask = await send(
      phone,
      { text: 'quero um P13 na rua nova 45, fátima, no pix' },
      at(0),
    ).result;
    expect(ask.step).toBe('collecting');
    const stored = await store.getConversation(ask.conversationId);
    expect(stored?.step).toBe('collecting');
    expect(stored?.collected).toMatchObject({
      expecting: 'name',
      payment: 'PIX',
    });

    await send(phone, { text: 'Ana Teste' }, at(20)).result;
    const done = await send(phone, { buttonId: 'confirm' }, at(30)).result;

    expect(done.step).toBe('sale_created');
    expect(fake.customers.some((c) => c.name === 'Ana Teste')).toBe(true);
    expect(
      (await store.getConversation(done.conversationId))?.revgasCustomerId,
    ).toBe(fake.customers.at(-1)?.id);
  });

  it('reenvio do mesmo ID não processa de novo nem cria segunda venda', async () => {
    const { service, send, fake } = setup();
    await send(RECURRING, { text: 'o mesmo de sempre' }, at(0)).result;
    const { message, result } = send(RECURRING, { buttonId: 'confirm' }, at(5));
    await result;
    const salesAfterFirst = fake.sales.length;

    const again = await service.handleIncoming({ ...message, at: at(6) });

    expect(again).toMatchObject({ duplicate: true, replies: [] });
    expect(fake.sales).toHaveLength(salesAfterFirst);
  });

  it('LLM fora do ar: responde com botões em vez de travar', async () => {
    const { send } = setup();

    const result = await send(
      '5586911112222',
      { text: 'texto que o LLM não conhece' },
      at(0),
    ).result;

    expect(result.step).toBe('collecting');
    expect(result.replies[0]?.buttons?.length).toBeGreaterThan(0);
  });

  it('sessão parada além do TTL vira abandono e a próxima mensagem abre outra', async () => {
    const { send } = setup();
    const phone = '5586933334444';
    const first = await send(
      phone,
      { text: 'quero um P13 na rua nova 45, fátima, no pix' },
      at(0),
    ).result;

    const later = await send(phone, { text: 'o mesmo de sempre' }, at(31 * 60))
      .result;

    expect(later.conversationId).not.toBe(first.conversationId);
    expect((await store.getConversation(first.conversationId))?.status).toBe(
      'abandoned',
    );
    expect((await store.getMetrics(first.conversationId))?.outcome).toBe(
      'abandoned',
    );
  });

  it('expireIdle encerra sessões paradas: abandono sem venda, concluída com venda', async () => {
    const { service, send } = setup();
    const noSale = await send('5586955556666', { text: 'Ana Teste' }, at(0))
      .result;
    await send(RECURRING, { text: 'o mesmo de sempre' }, at(0)).result;
    const sold = await send(RECURRING, { buttonId: 'confirm' }, at(5)).result;

    const expired = await service.expireIdle(at(40 * 60));

    expect(expired).toBe(2);
    expect((await store.getConversation(noSale.conversationId))?.status).toBe(
      'abandoned',
    );
    expect((await store.getConversation(sold.conversationId))?.status).toBe(
      'completed',
    );
  });

  it('com atendente, o bot registra e fica em silêncio', async () => {
    const { send } = setup();
    const phone = '5586977778888';
    const handed = await send(phone, { buttonId: 'human' }, at(0)).result;
    expect(handed.step).toBe('closed');

    const after = await send(phone, { text: 'alô?' }, at(30)).result;

    expect(after).toMatchObject({
      silenced: true,
      replies: [],
      conversationId: handed.conversationId,
    });
    expect((await store.getMetrics(handed.conversationId))?.turns).toBe(2);
  });

  it('cancelar antes da venda encerra e registra cancelamento', async () => {
    const { send } = setup();
    const phone = '5586999998888';
    await send(
      phone,
      { text: 'quero um P13 na rua nova 45, fátima, no pix' },
      at(0),
    ).result;

    const canceled = await send(phone, { text: 'cancela' }, at(10)).result;

    expect(canceled.step).toBe('closed');
    const conversation = await store.getConversation(canceled.conversationId);
    expect(conversation?.status).toBe('completed');
    const metrics = await store.getMetrics(canceled.conversationId);
    expect(metrics?.outcome).toBe('canceled');
    expect(metrics?.cancelReason).toBe(
      'desistiu antes da venda (coletando dados)',
    );
  });

  it('despacho avisado pela revenda muda a etapa', async () => {
    const { service, send } = setup();
    await send(RECURRING, { text: 'o mesmo de sempre' }, at(0)).result;
    const sold = await send(RECURRING, { buttonId: 'confirm' }, at(5)).result;

    const replies = await service.notifyDispatched(
      sold.conversationId,
      at(300),
    );

    expect(replies[0]?.text).toMatch(/saiu para entrega/);
    expect((await store.getConversation(sold.conversationId))?.step).toBe(
      'dispatched',
    );
  });

  it('mensagens simultâneas do mesmo contato são processadas em ordem', async () => {
    const { send, fake } = setup();
    await send(RECURRING, { text: 'o mesmo de sempre' }, at(0)).result;
    const salesBefore = fake.sales.length;

    const results = await Promise.all([
      send(RECURRING, { buttonId: 'confirm' }, at(5)).result,
      send(RECURRING, { buttonId: 'confirm' }, at(5)).result,
    ]);

    expect(results.map((r) => r.step)).toEqual([
      'sale_created',
      'sale_created',
    ]);
    expect(fake.sales).toHaveLength(salesBefore + 1);
  });

  it('não grava CPF, endereço nem texto em log (não há log no turno)', async () => {
    const { send } = setup();
    const writes: string[] = [];
    const spy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        writes.push(String(chunk));
        return true;
      });
    try {
      await send(
        '5586900001111',
        { text: 'quero um P13 na rua nova 45, fátima, no pix' },
        at(0),
      ).result;
    } finally {
      spy.mockRestore();
    }

    expect(writes.join('')).not.toMatch(/Rua Nova|Fátima|5586900001111/);
  });
});

async function bodies(): Promise<string[]> {
  const rows = await connection.db
    .select({ body: messages.body })
    .from(messages);
  return rows.map((r) => r.body);
}

describe('ConversationService: CPF (issue #8)', () => {
  const CPF = '529.982.247-25'; // fictício
  const order = 'quero um P13 na rua nova 45, fátima, no pix, sou Ana Teste';

  it('a resposta ao pedido de CPF não passa pelo LLM', async () => {
    const { send, llm, fake } = setup({ cpfRequired: true });
    const phone = '5586944443333';
    const ask = await send(phone, { text: order }, at(0)).result;
    expect(ask.replies[0]?.text).toMatch(/CPF/);
    const callsBefore = llm.calls;

    const summary = await send(phone, { text: CPF }, at(10)).result;
    expect(summary.step).toBe('confirming');
    expect(llm.calls).toBe(callsBefore);

    await send(phone, { buttonId: 'confirm' }, at(20)).result;
    expect(fake.customers.at(-1)?.cpf).toBe('52998224725');
    expect(llm.sent.join('\n')).not.toMatch(/529\.?982\.?247-?25/);
  });

  it('CPF no meio de outra mensagem é trocado por [cpf] antes do LLM', async () => {
    const { send, llm } = setup();

    await send('5586944442222', { text: `quero um P13, cpf ${CPF}` }, at(0))
      .result;

    expect(llm.sent.join('\n')).toContain('quero um P13, cpf [cpf]');
    expect(llm.sent.join('\n')).not.toMatch(/529\.?982\.?247-?25/);
  });

  it('a mensagem gravada no banco tem o CPF mascarado', async () => {
    const { send } = setup({ cpfRequired: true });
    const phone = '5586944441111';
    await send(phone, { text: order }, at(0)).result;

    await send(phone, { text: `meu cpf é ${CPF}` }, at(10)).result;

    const stored = await bodies();
    expect(stored).toContain('meu cpf é ***.***.***-25');
    expect(stored.join('\n')).not.toMatch(/529\.?982\.?247-?25/);
  });

  it('o rascunho gravado não guarda o CPF depois do cadastro', async () => {
    const { send } = setup({ cpfRequired: true });
    const phone = '5586944440000';
    await send(phone, { text: order }, at(0)).result;
    await send(phone, { text: CPF }, at(10)).result;

    const done = await send(phone, { buttonId: 'confirm' }, at(20)).result;

    const conversation = await store.getConversation(done.conversationId);
    expect(JSON.stringify(conversation?.collected)).not.toContain(
      '52998224725',
    );
  });
});

describe('ConversationService: localização (issue #11)', () => {
  it('localização com endereço escrito passa pelo extrator e grava só o marcador', async () => {
    const { send, llm } = setup();
    const phone = '5586933332222';
    await send(phone, { text: 'Ana Teste' }, at(0)).result;

    await send(
      phone,
      {
        location: {
          latitude: -5.09,
          longitude: -42.8,
          address: 'Rua Nova, 45 - Fátima',
        },
      },
      at(10),
    ).result;

    expect(llm.sent.join('\n')).toContain('Rua Nova, 45 - Fátima');
    const stored = await bodies();
    expect(stored).toContain('[localização]');
    expect(stored.join('\n')).not.toMatch(/-5\.09|-42\.8/);
  });

  it('localização sem endereço não chama o LLM', async () => {
    const { send, llm } = setup();
    const phone = '5586933331111';
    await send(phone, { text: 'Ana Teste' }, at(0)).result;
    const before = llm.calls;

    const result = await send(
      phone,
      { location: { latitude: -5.09, longitude: -42.8 } },
      at(10),
    ).result;

    expect(llm.calls).toBe(before);
    expect(result.replies[0]?.text).toMatch(/Recebi sua localização/);
  });
});

async function withSale() {
  const s = setup();
  await s.send(RECURRING, { text: 'o mesmo de sempre' }, at(0)).result;
  const sold = await s.send(RECURRING, { buttonId: 'confirm' }, at(5)).result;
  return { ...s, sold };
}

describe('ConversationService: cancelamento (issue #12)', () => {
  it('cancelar a venda grava o motivo escolhido nas métricas', async () => {
    const { send, sold, fake } = await withSale();

    const ask = await send(RECURRING, { text: 'cancela' }, at(20)).result;
    expect(ask.replies[0]?.buttons?.map((b) => b.id)).toContain(
      'cancel_motive:2',
    );
    const done = await send(RECURRING, { buttonId: 'cancel_motive:2' }, at(30))
      .result;

    expect(done.step).toBe('closed');
    const metrics = await store.getMetrics(sold.conversationId);
    expect(metrics).toMatchObject({
      outcome: 'canceled',
      cancelReason: 'Pedido duplicado',
      canceledAt: at(30),
      // O tempo do pedido não muda por cancelar depois.
      saleCreatedAt: at(5),
    });
    expect(fake.sales.at(-1)).toMatchObject({
      status: 'CANCEL',
      cancel_motive_id: 2,
    });
    expect((await store.getConversation(sold.conversationId))?.status).toBe(
      'completed',
    );
  });

  it('despacho pela revenda muda a etapa salva e manda cancelamento ao atendente', async () => {
    const { send, sold, fake } = await withSale();
    fake.dispatchSale(fake.sales.at(-1)?.id ?? 0);

    const result = await send(RECURRING, { text: 'cancela' }, at(20)).result;

    expect(result.step).toBe('closed');
    const metrics = await store.getMetrics(sold.conversationId);
    expect(metrics).toMatchObject({ handedOff: true, outcome: 'sale_created' });
    expect(fake.sales.at(-1)?.status).not.toBe('CANCEL');
  });

  it('entrega pela revenda grava a etapa delivered, e a conversa segue aberta', async () => {
    const { send, sold, fake } = await withSale();
    fake.deliverSale(fake.sales.at(-1)?.id ?? 0);

    const result = await send(RECURRING, { text: 'cancela' }, at(20)).result;

    expect(result.step).toBe('delivered');
    const conversation = await store.getConversation(sold.conversationId);
    expect(conversation).toMatchObject({ step: 'delivered', status: 'active' });
    expect((await store.getMetrics(sold.conversationId))?.outcome).toBe(
      'sale_created',
    );
  });

  it('venda cancelada pela revenda fecha a conversa e registra o motivo', async () => {
    const { send, sold, fake } = await withSale();
    fake.setSaleStatus(fake.sales.at(-1)?.id ?? 0, 'CANCEL');

    const result = await send(RECURRING, { text: 'oi' }, at(20)).result;

    expect(result.step).toBe('closed');
    const metrics = await store.getMetrics(sold.conversationId);
    expect(metrics).toMatchObject({
      outcome: 'canceled',
      cancelReason: 'cancelada pela revenda',
    });
  });
});
