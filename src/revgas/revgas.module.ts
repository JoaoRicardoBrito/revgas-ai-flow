import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema.js';
import {
  FAKE_API_KEY,
  FAKE_BASE_URL,
  FAKE_ESTABLISHMENT_ID,
  FakeRevgasApi,
} from './fake/fake-revgas-api.js';
import { HttpRevgasClient } from './http/http-revgas-client.js';
import { REVGAS_CLIENT, type RevgasClient } from './revgas-client.js';

/**
 * Com `REVGAS_USE_MOCK=true` (padrão), o client conversa com o fake em
 * memória e nada sai da máquina. O fake fica exposto para o simulador
 * controlar cenários (sem estoque, falha, pagamento recusado).
 */
@Module({
  providers: [
    {
      provide: FakeRevgasApi,
      useFactory: () => new FakeRevgasApi({ latencyMs: 150 }),
    },
    {
      provide: REVGAS_CLIENT,
      inject: [ConfigService, FakeRevgasApi],
      useFactory: (
        config: ConfigService<Env, true>,
        fake: FakeRevgasApi,
      ): RevgasClient => {
        const logger = new Logger('RevgasModule');
        if (config.get('REVGAS_USE_MOCK', { infer: true })) {
          logger.log('RevGás em modo mock: nenhuma chamada à API real');
          return new HttpRevgasClient({
            baseUrl: FAKE_BASE_URL,
            apiKey: FAKE_API_KEY,
            establishmentId: FAKE_ESTABLISHMENT_ID,
            fetch: fake.fetch,
            minIntervalMs: 0,
          });
        }
        logger.warn('RevGás em modo real: chamadas vão para a API de produção');
        return new HttpRevgasClient({
          baseUrl: config.get('REVGAS_API_BASE_URL', { infer: true }),
          // O schema de ambiente garante a chave e o estabelecimento fora do mock.
          apiKey: config.get('REVGAS_API_KEY', { infer: true }) ?? '',
          establishmentId:
            config.get('REVGAS_ESTABLISHMENT_ID', { infer: true }) ?? 0,
        });
      },
    },
  ],
  exports: [REVGAS_CLIENT, FakeRevgasApi],
})
export class RevgasModule {}
