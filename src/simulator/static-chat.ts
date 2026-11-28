import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { NestExpressApplication } from '@nestjs/platform-express';

/** Tela compilada (`npm run build`), vista de `src/simulator` ou `dist/simulator`. */
const WEB_DIST = fileURLToPath(new URL('../../web/dist', import.meta.url));

/** Serve o chat em `/chat`. Sem a tela compilada, não faz nada. */
export function serveChat(app: NestExpressApplication): boolean {
  if (!existsSync(WEB_DIST)) return false;
  app.useStaticAssets(WEB_DIST, { prefix: '/chat' });
  return true;
}
