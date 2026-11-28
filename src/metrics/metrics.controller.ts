import { Controller, Get, Header, Inject, Query } from '@nestjs/common';
import { ConversationStore } from '../database/conversation.store.js';
import { orderReport, type OrderReport } from './order-report.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

@Controller('metrics')
export class MetricsController {
  constructor(
    @Inject(ConversationStore) private readonly store: ConversationStore,
  ) {}

  /** `GET /metrics?limit=50`: resumo e histórico do tempo dos pedidos. */
  @Get()
  @Header('Cache-Control', 'no-store')
  async read(@Query('limit') limit?: string): Promise<OrderReport> {
    const asked = Number(limit);
    return orderReport(
      await this.store.listOrderMetrics(),
      Number.isInteger(asked) && asked > 0
        ? Math.min(asked, MAX_LIMIT)
        : DEFAULT_LIMIT,
    );
  }
}
