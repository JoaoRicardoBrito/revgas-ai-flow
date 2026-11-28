import {
  Inject,
  Injectable,
  NotFoundException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { Env } from '../config/env.schema.js';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * A tela mostra telefone, endereço e conversa, e não tem login: só responde
 * a quem está na própria máquina. Pedido repassado por túnel (webhook do
 * WhatsApp) chega por loopback, mas com outro Host ou cabeçalho de proxy.
 */
export function isLocalDemoRequest(request: {
  remoteAddress?: string;
  headers: Record<string, string | string[] | undefined>;
}): boolean {
  const { remoteAddress, headers } = request;
  const { host } = headers;
  const hostname = typeof host === 'string' ? host.replace(/:\d+$/, '') : '';
  return (
    LOOPBACK.has(remoteAddress ?? '') &&
    LOCAL_HOSTS.has(hostname) &&
    !headers['x-forwarded-for'] &&
    !headers['forwarded']
  );
}

@Injectable()
export class LocalDemoGuard implements CanActivate {
  constructor(
    @Inject(ConfigService) private readonly config: ConfigService<Env, true>,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const allowed =
      this.config.get('REVGAS_USE_MOCK', { infer: true }) &&
      isLocalDemoRequest({
        remoteAddress: request.socket.remoteAddress,
        headers: request.headers,
      });
    if (!allowed) throw new NotFoundException();
    return true;
  }
}
