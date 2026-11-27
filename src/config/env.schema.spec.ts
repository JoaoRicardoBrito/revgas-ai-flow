import { describe, expect, it } from 'vitest';
import { validateEnv } from './env.schema.js';

describe('validateEnv', () => {
  it('sobe só com valores padrão, em modo mock', () => {
    const env = validateEnv({});

    expect(env.REVGAS_USE_MOCK).toBe(true);
    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe('development');
  });

  it('trata linhas vazias do .env como ausentes', () => {
    const env = validateEnv({ REVGAS_API_KEY: '', DATABASE_URL: '  ' });

    expect(env.REVGAS_API_KEY).toBeUndefined();
    expect(env.DATABASE_URL).toBeUndefined();
  });

  it('converte PORT e REVGAS_USE_MOCK de texto', () => {
    const env = validateEnv({
      PORT: '8080',
      REVGAS_USE_MOCK: 'false',
      REVGAS_API_KEY: 'chave',
    });

    expect(env.PORT).toBe(8080);
    expect(env.REVGAS_USE_MOCK).toBe(false);
  });

  it('exige REVGAS_API_KEY fora do modo mock', () => {
    expect(() => validateEnv({ REVGAS_USE_MOCK: 'false' })).toThrow(
      /REVGAS_API_KEY/,
    );
  });

  it('recusa PORT e URL inválidas', () => {
    expect(() => validateEnv({ PORT: 'abc' })).toThrow(/PORT/);
    expect(() => validateEnv({ REVGAS_API_BASE_URL: 'nao-e-url' })).toThrow(
      /REVGAS_API_BASE_URL/,
    );
  });

  it('exige as três variáveis do WhatsApp juntas', () => {
    expect(() => validateEnv({ WHATSAPP_TOKEN: 't' })).toThrow(
      /WHATSAPP_PHONE_NUMBER_ID[\s\S]*WHATSAPP_VERIFY_TOKEN/,
    );
    expect(() =>
      validateEnv({
        WHATSAPP_TOKEN: 't',
        WHATSAPP_PHONE_NUMBER_ID: 'id',
        WHATSAPP_VERIFY_TOKEN: 'v',
      }),
    ).not.toThrow();
  });

  it('lista todos os erros de uma vez', () => {
    expect(() =>
      validateEnv({ PORT: 'abc', REVGAS_USE_MOCK: 'false' }),
    ).toThrow(/PORT[\s\S]*REVGAS_API_KEY/);
  });

  it('não expõe o valor de segredos na mensagem de erro', () => {
    const segredo = 'sk-super-secreto-123';

    let mensagem = '';
    try {
      validateEnv({ WHATSAPP_TOKEN: segredo, PORT: 'abc' });
    } catch (error) {
      mensagem = error instanceof Error ? error.message : String(error);
    }

    expect(mensagem).toContain('WHATSAPP_PHONE_NUMBER_ID');
    expect(mensagem).not.toContain(segredo);
  });
});
