import { Controller, Get, Header, Inject, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema.js';
import { ConversationStore } from '../database/conversation.store.js';
import { ATTENDANT_PAGE } from './attendant.page.js';
import { parseBusinessHours } from './business-hours.js';
import { handoffView, type HandoffView } from './handoff-view.js';
import { LocalDemoGuard } from './local-demo.guard.js';

@Controller('attendant')
@UseGuards(LocalDemoGuard)
export class AttendantController {
  constructor(
    @Inject(ConversationStore) private readonly store: ConversationStore,
    @Inject(ConfigService) private readonly config: ConfigService<Env, true>,
  ) {}

  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  page(): string {
    return ATTENDANT_PAGE;
  }

  @Get('handoffs')
  @Header('Cache-Control', 'no-store')
  async handoffs(): Promise<HandoffView[]> {
    const hours = parseBusinessHours({
      hours: this.config.get('BUSINESS_HOURS', { infer: true }),
      days: this.config.get('BUSINESS_DAYS', { infer: true }),
      timeZone: this.config.get('BUSINESS_TIMEZONE', { infer: true }),
    });
    const handoffs = await this.store.listHandoffs();
    return handoffs.map((h) => handoffView(h, hours));
  }
}
