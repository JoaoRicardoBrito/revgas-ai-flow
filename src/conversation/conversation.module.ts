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
      provide: ConversationService,
      inject: [
        ConversationStore,
        MessageExtractor,
        REVGAS_CLIENT,
        ConfigService,
      ],
      useFactory: (
        store: ConversationStore,
        extractor: MessageExtractor,
        revgas: RevgasClient,
        config: ConfigService<Env, true>,
      ) =>
        new ConversationService(store, extractor, revgas, {
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
