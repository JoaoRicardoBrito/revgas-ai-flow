import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.schema.js';
import { HealthController } from './health/health.controller.js';
import { RevgasModule } from './revgas/revgas.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    RevgasModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
