import type {
  Channel,
  ConversationStore,
} from '../database/conversation.store.js';
import { findCpf, isValidCpf, maskCpf } from '../common/cpf.js';
import type { Conversation } from '../database/schema.js';
import { EXPECTING, type MessageExtractor } from '../llm/message-extractor.js';
import type { RevgasClient } from '../revgas/revgas-client.js';
import type { Catalog } from './catalog.js';
import type { Coverage } from './coverage.js';
import {
  draftSchema,
  emptyDraft,
  STEPS,
  type Draft,
  type Reply,
  type SessionState,
  type Signal,
  type Step,
  type TurnOutcome,
} from './conversation.types.js';
import {
  markDispatched,
  runTurn,
  signalFromButton,
  signalFromExtraction,
} from './state-machine.js';

export interface IncomingMessage {
  channel: Channel;
  /** Telefone no WhatsApp; ID da sessão no simulador. */
  contact: string;
  /** ID da mensagem no canal (wamid). Base da idempotência. */
  externalId: string;
  at: Date;
  text?: string;
  /** ID do botão tocado, quando a mensagem é um toque. */
  buttonId?: string;
  /**
   * Localização do WhatsApp. `address` vem quando o cliente compartilha um
   * local com endereço escrito (issue #11).
   */
  location?: { latitude: number; longitude: number; address?: string };
}

export interface HandleResult {
  conversationId: string;
  /** Reenvio do mesmo `externalId`: nada foi processado. */
  duplicate: boolean;
  /** Com atendente: o bot não responde. */
  silenced: boolean;
  step: Step;
  replies: Reply[];
}

export interface ConversationServiceOptions {
  /** Tempo parado até a sessão expirar (abandono). */
  ttlMs: number;
  /** A nota fiscal exige CPF de cliente novo. Padrão: não. */
  cpfRequired?: boolean;
  /** Pix fictício depois da venda (só modo mock). */
  pixDemo?: boolean;
  /** Área de entrega da revenda. */
  coverage?: Coverage;
}

/**
 * Orquestra um turno: sessão, idempotência, LLM, máquina de estados e
 * persistência. A máquina decide o próximo passo; o LLM só preenche campos.
 */
export class ConversationService {
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(
    private readonly store: ConversationStore,
    private readonly extractor: MessageExtractor,
    private readonly revgas: RevgasClient,
    private readonly catalog: Catalog,
    private readonly options: ConversationServiceOptions,
  ) {}

  handleIncoming(message: IncomingMessage): Promise<HandleResult> {
    // Um turno por contato por vez: mensagens seguidas não pisam no estado.
    return this.withLock(`${message.channel}:${message.contact}`, () =>
      this.process(message),
    );
  }

  /** A revenda despachou: avisa o cliente e muda a etapa. */
  async notifyDispatched(conversationId: string, at: Date): Promise<Reply[]> {
    const conversation = await this.store.getConversation(conversationId);
    if (!conversation) throw new Error(`Conversa ${conversationId} não existe`);
    return this.withLock(
      `${conversation.channel}:${conversation.contact}`,
      async () => {
        const state = loadState(conversation);
        const result = markDispatched(state);
        await this.persist(conversation, result, at);
        return result.replies;
      },
    );
  }

  /** Encerra sessões paradas além do TTL. Chamado periodicamente. */
  expireIdle(now: Date): Promise<number> {
    return this.store.expireIdle(
      new Date(now.getTime() - this.options.ttlMs),
      now,
    );
  }

  private async process(message: IncomingMessage): Promise<HandleResult> {
    const { channel, contact, at } = message;
    const since = new Date(at.getTime() - this.options.ttlMs);

    // Com atendente: só registra a mensagem, sem responder (issue #13).
    const withHuman = await this.store.findRecentHandedOff(
      channel,
      contact,
      since,
    );
    if (withHuman) {
      const recorded = await this.store.recordInbound({
        conversationId: withHuman.id,
        externalId: message.externalId,
        body: bodyOf(message),
        at,
      });
      return {
        conversationId: withHuman.id,
        duplicate: recorded.duplicate,
        silenced: true,
        step: 'closed',
        replies: [],
      };
    }

    // Sessão parada além do TTL: encerra (abandono) e começa outra.
    const active = await this.store.findActive(channel, contact);
    if (active && active.lastMessageAt < since) {
      const metrics = await this.store.getMetrics(active.id);
      await this.store.closeConversation(
        active.id,
        metrics?.saleCreatedAt ? 'completed' : 'abandoned',
        at,
      );
    }

    const { conversation } = await this.store.findOrStartActive(
      channel,
      contact,
      at,
    );
    const recorded = await this.store.recordInbound({
      conversationId: conversation.id,
      externalId: message.externalId,
      body: bodyOf(message),
      at,
    });
    if (recorded.duplicate) {
      return {
        conversationId: conversation.id,
        duplicate: true,
        silenced: false,
        step: loadState(conversation).step,
        replies: [],
      };
    }

    const state = loadState(conversation);
    const text = message.text ?? '';
    let signal: Signal;
    if (message.buttonId) {
      signal = signalFromButton(message.buttonId);
    } else if (message.location) {
      signal = await this.locationSignal(conversation.id, message.location);
    } else if (state.draft.expecting === 'cpf' && findCpf(text)) {
      // Resposta ao pedido de CPF: o código lê, o texto não vai ao LLM.
      signal = { ...signalFromButton(''), intent: 'order', button: null, text };
    } else {
      const expecting =
        EXPECTING.find((e) => e === state.draft.expecting) ?? 'anything';
      const extraction = await this.extractor.extract(redactCpfs(text), {
        expecting,
      });
      await this.store.addLlmTime(conversation.id, extraction.durationMs);
      signal = signalFromExtraction(extraction, text);
    }

    const result = await runTurn(state, signal, {
      revgas: this.revgas,
      catalog: this.catalog,
      contact,
      settings: {
        cpfRequired: this.options.cpfRequired ?? false,
        pixDemo: this.options.pixDemo ?? false,
        coverage: this.options.coverage,
      },
    });
    await this.persist(conversation, result, at);

    return {
      conversationId: conversation.id,
      duplicate: false,
      silenced: false,
      step: result.step,
      replies: result.replies,
    };
  }

  private async persist(
    conversation: Conversation,
    result: TurnOutcome,
    at: Date,
  ) {
    const id = conversation.id;
    await this.store.saveState(
      id,
      {
        step: result.step,
        collected: result.draft,
        revgasCustomerId: result.draft.customer?.id ?? null,
      },
      at,
    );

    for (const event of result.events) {
      switch (event.type) {
        case 'sale_created':
          await this.store.markSaleCreated(id, event.saleId, at);
          break;
        case 'sale_canceled':
          await this.store.markCanceled(id, at, event.reason);
          break;
        case 'handoff':
          await this.store.markHandedOff(id, event.reason, at);
          break;
        case 'closed':
          if (event.status === 'canceled')
            await this.store.markCanceled(id, at, event.reason);
          await this.store.closeConversation(id, 'completed', at);
          break;
        case 'customer_identified':
          break;
      }
    }

    for (const reply of result.replies) {
      await this.store.recordOutbound(id, reply.text, at);
    }
  }

  /** Ponto no mapa: o endereço escrito (se houver) passa pelo extrator. */
  private async locationSignal(
    conversationId: string,
    location: NonNullable<IncomingMessage['location']>,
  ): Promise<Signal> {
    const point = {
      latitude: location.latitude,
      longitude: location.longitude,
    };
    if (location.address) {
      const extraction = await this.extractor.extract(location.address, {
        expecting: 'address',
      });
      await this.store.addLlmTime(conversationId, extraction.durationMs);
      return { ...signalFromExtraction(extraction, null), location: point };
    }
    return {
      ...signalFromButton(''),
      intent: 'change_address',
      button: null,
      location: point,
    };
  }

  private async withLock<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    const run = previous.then(task, task);
    const settled = run.catch(() => undefined);
    this.locks.set(key, settled);
    try {
      return await run;
    } finally {
      if (this.locks.get(key) === settled) this.locks.delete(key);
    }
  }
}

/** Etapa e rascunho salvos; formato inválido recomeça do zero. */
export function loadState(conversation: Conversation): SessionState {
  const step = STEPS.find((s) => s === conversation.step) ?? 'identifying';
  const parsed = draftSchema.safeParse(conversation.collected);
  const draft: Draft = parsed.success ? parsed.data : emptyDraft();
  return { step, draft };
}

/** Texto gravado no banco: CPF só com os dois últimos dígitos. */
function bodyOf(message: IncomingMessage): string {
  // Coordenadas ficam só no rascunho, não no texto da mensagem.
  if (message.location) return '[localização]';
  if (message.text !== undefined) {
    return replaceCpfs(message.text, (cpf) => maskCpf(cpf));
  }
  return message.buttonId ? `[botão] ${message.buttonId}` : '';
}

/** Texto que vai ao LLM: sem CPF. */
export function redactCpfs(text: string): string {
  return replaceCpfs(text, () => '[cpf]');
}

function replaceCpfs(text: string, by: (cpf: string) => string): string {
  return text.replace(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/g, (match) =>
    isValidCpf(match) ? by(match) : match,
  );
}
