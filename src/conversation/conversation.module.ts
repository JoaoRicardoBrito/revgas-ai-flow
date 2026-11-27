import {
  Inject,
  Injectable,
  Logger,
  Module,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { toLogSafe } from '../common/log-safe.js';
import type { Env } from '../config/env.schema.js';
import { ConversationStore } from '../database/conversation.store.js';
import { LlmModule } from '../llm/llm.module.js';
import { MessageExtractor } from '../llm/message-extractor.js';
import { REVGAS_CLIENT, type RevgasClient } from '../revgas/revgas-client.js';
import { RevgasModule } from '../revgas/revgas.module.js';
import {
  Catalog,
  DEMO_PRICES_BY_KG,
  parsePriceList,
  type PriceList,
} from './catalog.js';
import { ConversationService } from './conversation.service.js';

/** Fecha sessões paradas a cada minuto (abandono). */
@Injectable()
class SessionExpirer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('SessionExpirer');
  private timer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(ConversationService) private readonly service: ConversationService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      this.service.expireIdle(new Date()).then(
        (count) => {
          if (count > 0) this.logger.log(`${count} sessão(ões) expirada(s)`);
        },
        (error: unknown) => {
          this.logger.error(JSON.stringify(toLogSafe(error)));
        },
      );
    }, 60_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }
}

@Module({
  imports: [LlmModule, RevgasModule],
  providers: [
    {
      provide: Catalog,
      inject: [REVGAS_CLIENT, ConfigService],
      useFactory: (revgas: RevgasClient, config: ConfigService<Env, true>) => {
        const logger = new Logger('Catalog');
        const configured = config.get('PRODUCT_PRICES', { infer: true });
        const mock = config.get('REVGAS_USE_MOCK', { infer: true });
        let prices: PriceList = {};
        if (configured) {
          prices = parsePriceList(configured);
        } else if (mock) {
          prices = DEMO_PRICES_BY_KG;
          logger.log('Sem PRODUCT_PRICES: preços de demonstração (modo mock)');
        } else {
          // A API não tem preço: sem tabela, nada fica à venda.
          logger.warn('Sem PRODUCT_PRICES: nenhum produto à venda');
        }
        return new Catalog(revgas, {
          prices,
          ttlMs: config.get('CATALOG_CACHE_SECONDS', { infer: true }) * 1000,
        });
      },
    },
    {
      provide: ConversationService,
      inject: [
        ConversationStore,
        MessageExtractor,
        REVGAS_CLIENT,
        Catalog,
        ConfigService,
      ],
      useFactory: (
        store: ConversationStore,
        extractor: MessageExtractor,
        revgas: RevgasClient,
        catalog: Catalog,
        config: ConfigService<Env, true>,
      ) =>
        new ConversationService(store, extractor, revgas, catalog, {
          ttlMs:
            config.get('CONVERSATION_TTL_MINUTES', { infer: true }) * 60_000,
          cpfRequired: config.get('CPF_REQUIRED', { infer: true }),
        }),
    },
    SessionExpirer,
  ],
  exports: [ConversationService],
})
export class ConversationModule {}
