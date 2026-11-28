import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AttendantModule } from './attendant/attendant.module.js';
import { validateEnv } from './config/env.schema.js';
import { ConversationModule } from './conversation/conversation.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthController } from './health/health.controller.js';
import { LlmModule } from './llm/llm.module.js';
import { MetricsModule } from './metrics/metrics.module.js';
import { RevgasModule } from './revgas/revgas.module.js';
import { SimulatorModule } from './simulator/simulator.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    DatabaseModule,
    LlmModule,
    RevgasModule,
    ConversationModule,
    SimulatorModule,
    MetricsModule,
    AttendantModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
