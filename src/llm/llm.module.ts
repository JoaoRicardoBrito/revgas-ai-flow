import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema.js';
import { GROQ_DEFAULT_MODEL, GroqLlmClient } from './groq/groq-llm-client.js';
import { DisabledLlmClient, LLM_CLIENT, type LlmClient } from './llm-client.js';
import { MessageExtractor } from './message-extractor.js';

@Module({
  providers: [
    {
      provide: LLM_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): LlmClient => {
        const logger = new Logger('LlmModule');
        const apiKey = config.get('GROQ_API_KEY', { infer: true });
        if (!apiKey) {
          logger.warn(
            'Sem GROQ_API_KEY: LLM desligado, conversa só com botões',
          );
          return new DisabledLlmClient();
        }
        const model =
          config.get('GROQ_MODEL', { infer: true }) || GROQ_DEFAULT_MODEL;
        logger.log(`LLM: Groq, modelo ${model}`);
        return new GroqLlmClient({ apiKey, model });
      },
    },
    {
      provide: MessageExtractor,
      inject: [LLM_CLIENT],
      useFactory: (llm: LlmClient) => new MessageExtractor(llm),
    },
  ],
  exports: [LLM_CLIENT, MessageExtractor],
})
export class LlmModule {}
