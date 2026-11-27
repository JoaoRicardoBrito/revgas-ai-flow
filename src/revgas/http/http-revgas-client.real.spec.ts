/**
 * Contrato de leitura contra a API REAL da RevGás. Desligado por padrão e no
 * CI. Para rodar: `npm run test:contract:real` com REVGAS_API_KEY e
 * REVGAS_ESTABLISHMENT_ID no `.env`. Só faz GET; nunca cria nem altera nada.
 */
import { describe } from 'vitest';
import { readContract } from '../revgas-client.contract.js';
import { HttpRevgasClient } from './http-revgas-client.js';

try {
  process.loadEnvFile('.env');
} catch {
  // Sem .env: usa só o ambiente do processo.
}

const enabled = process.env.REVGAS_CONTRACT_REAL === 'true';
const apiKey = process.env.REVGAS_API_KEY ?? '';
const establishmentId = Number(process.env.REVGAS_ESTABLISHMENT_ID ?? 0);
const baseUrl = process.env.REVGAS_API_BASE_URL || 'https://api.revgas.com/v1';

describe.skipIf(!enabled || !apiKey || !establishmentId)(
  'HttpRevgasClient contra a API real (somente leitura)',
  () => {
    // Um client por suíte, para a fila respeitar 1 requisição por segundo.
    const client = new HttpRevgasClient({ baseUrl, apiKey, establishmentId });
    readContract({
      client: () => client,
      clientWithBadKey: () =>
        new HttpRevgasClient({
          baseUrl,
          apiKey: 'chave-invalida',
          establishmentId,
        }),
    });
  },
);
