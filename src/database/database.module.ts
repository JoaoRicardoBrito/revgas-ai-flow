import {
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema.js';
import { ConversationStore } from './conversation.store.js';
import { connectDatabase, type DatabaseConnection } from './database.js';

export const DATABASE_CONNECTION = Symbol('DATABASE_CONNECTION');

@Injectable()
class DatabaseLifecycle implements OnApplicationShutdown {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly connection: DatabaseConnection,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await this.connection.close();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: DATABASE_CONNECTION,
      inject: [ConfigService],
      useFactory: async (config: ConfigService<Env, true>) => {
        const logger = new Logger('DatabaseModule');
        const url = config.get('DATABASE_URL', { infer: true });
        const connection = await connectDatabase(url);
        if (connection.kind === 'pglite') {
          logger.warn(
            'Sem DATABASE_URL: usando PGlite em memória (dados somem ao reiniciar)',
          );
        } else {
          logger.log('Conectado ao Postgres');
        }
        return connection;
      },
    },
    {
      provide: ConversationStore,
      inject: [DATABASE_CONNECTION],
      useFactory: (connection: DatabaseConnection) =>
        new ConversationStore(connection.db),
    },
    DatabaseLifecycle,
  ],
  exports: [DATABASE_CONNECTION, ConversationStore],
})
export class DatabaseModule {}
