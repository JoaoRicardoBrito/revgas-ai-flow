import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import type { HandleResult } from '../src/conversation/conversation.service.js';
import { SEED } from '../src/revgas/fake/seed.js';

describe('simulador de chat (e2e, issue #16)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1');
  });

  afterAll(async () => {
    await app.close();
  });

  const post = (body: object) =>
    request(app.getHttpServer())
      .post('/simulator/messages')
      .set('Host', 'localhost')
      .send(body);

  const tap = async (buttonId: string) => {
    const response = await post({
      phone: SEED.recurringCustomer.phone,
      messageId: randomUUID(),
      buttonId,
    }).expect(200);
    const result: HandleResult = response.body;
    return result;
  };

  it('cliente recorrente pede com botões, sem LLM nem conta paga', async () => {
    const offer = await tap('repeat');
    expect(offer.replies.length).toBeGreaterThan(0);

    const sold = await tap('confirm');
    expect(sold.step).toBe('sale_created');
  });

  it('recusa telefone inválido ou mensagem sem conteúdo', async () => {
    await post({ phone: 'abc', messageId: randomUUID(), text: 'oi' }).expect(
      400,
    );
    await post({
      phone: SEED.recurringCustomer.phone,
      messageId: randomUUID(),
    }).expect(400);
  });

  it('não responde a quem chega por túnel ou proxy', async () => {
    await request(app.getHttpServer())
      .get('/simulator/profiles')
      .set('Host', 'exemplo.trycloudflare.com')
      .expect(404);
  });
});
