/** Apoio aos testes da conversa: fake da RevGás e sinais prontos. */
import type { Extraction } from '../llm/extraction.schema.js';
import {
  FAKE_API_KEY,
  FAKE_BASE_URL,
  FAKE_ESTABLISHMENT_ID,
  FakeRevgasApi,
} from '../revgas/fake/fake-revgas-api.js';
import { HttpRevgasClient } from '../revgas/http/http-revgas-client.js';
import type { Signal } from './conversation.types.js';

export function fakeRevgas() {
  const fake = new FakeRevgasApi();
  const revgas = new HttpRevgasClient({
    baseUrl: FAKE_BASE_URL,
    apiKey: FAKE_API_KEY,
    establishmentId: FAKE_ESTABLISHMENT_ID,
    fetch: fake.fetch,
    minIntervalMs: 0,
  });
  return { fake, revgas };
}

export const NO_DATA: Extraction = {
  intent: 'other',
  productSizeKg: null,
  productRelative: null,
  quantity: null,
  address: null,
  paymentMethod: null,
  changeFor: null,
  customerName: null,
};

/** Sinal como se o LLM tivesse extraído estes campos. */
export function said(fields: Partial<Extraction>): Signal {
  const extraction = { ...NO_DATA, intent: 'order' as const, ...fields };
  return {
    intent: extraction.intent,
    extraction,
    button: null,
    llmUnavailable: false,
  };
}

export function tapped(button: string): Signal {
  const intents: Record<string, Signal['intent']> = {
    confirm: 'confirm',
    change: 'deny',
    cancel: 'cancel',
    human: 'human',
  };
  const prefix = button.split(':')[0] ?? '';
  return {
    intent:
      intents[button] ?? (prefix === 'change' ? 'deny' : 'change_product'),
    extraction: null,
    button,
    llmUnavailable: false,
  };
}

export const NOT_UNDERSTOOD: Signal = {
  intent: 'unknown',
  extraction: null,
  button: null,
  llmUnavailable: true,
};

export const fullAddress = {
  street: 'Rua Nova',
  number: '45',
  neighborhood: 'Fátima',
  complement: null,
  landmark: null,
};
