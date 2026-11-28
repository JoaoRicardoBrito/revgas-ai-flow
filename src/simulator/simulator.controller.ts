import { randomInt } from 'node:crypto';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { LocalDemoGuard } from '../attendant/local-demo.guard.js';
import {
  ConversationService,
  type HandleResult,
} from '../conversation/conversation.service.js';
import { SEED } from '../revgas/fake/seed.js';

const messageSchema = z
  .object({
    /** Telefone do cliente simulado, só dígitos, com DDI e DDD. */
    phone: z.string().regex(/^\d{10,13}$/),
    /** Reenvio com o mesmo ID não é processado de novo. */
    messageId: z.uuid(),
    text: z.string().trim().min(1).max(1000).optional(),
    buttonId: z.string().min(1).max(200).optional(),
  })
  .refine((m) => (m.text === undefined) !== (m.buttonId === undefined));

export interface Profile {
  label: string;
  phone: string;
}

/**
 * Canal do simulador web (issue #16): o mesmo núcleo do WhatsApp, com o
 * telefone escolhido na tela. Como qualquer telefone pode ser simulado, só
 * existe com a RevGás simulada e para quem está na própria máquina.
 */
@Controller('simulator')
@UseGuards(LocalDemoGuard)
export class SimulatorController {
  constructor(
    @Inject(ConversationService) private readonly service: ConversationService,
  ) {}

  /** Clientes fictícios para escolher na tela. */
  @Get('profiles')
  @Header('Cache-Control', 'no-store')
  profiles(): Profile[] {
    return [
      { label: 'Cliente recorrente', phone: SEED.recurringCustomer.phone },
      {
        label: 'Cadastrado, sem pedidos',
        phone: SEED.customerWithoutSales.phone,
      },
      // Número sorteado: cada vez é alguém que a revenda nunca viu.
      { label: 'Cliente novo', phone: `55869${randomInt(1e7, 1e8)}` },
    ];
  }

  @Post('messages')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async send(@Body() body: unknown): Promise<HandleResult> {
    const parsed = messageSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Mensagem inválida');
    const { phone, messageId, text, buttonId } = parsed.data;
    return this.service.handleIncoming({
      channel: 'simulator',
      contact: phone,
      externalId: `sim-${messageId}`,
      at: new Date(),
      text,
      buttonId,
    });
  }
}
