import { Module } from '@nestjs/common';
import { ConversationModule } from '../conversation/conversation.module.js';
import { SimulatorController } from './simulator.controller.js';

@Module({
  imports: [ConversationModule],
  controllers: [SimulatorController],
})
export class SimulatorModule {}
