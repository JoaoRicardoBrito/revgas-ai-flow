import type { Address } from '../revgas/revgas.types.js';

/**
 * Área de entrega da revenda (PRD 6.6). A API da RevGás não tem área de
 * cobertura (pergunta 6 da issue #1), então a revenda configura:
 *
 * - `neighborhoods`: bairros atendidos (COVERAGE_NEIGHBORHOODS);
 * - `center` + `radiusKm`: raio em volta da loja (COVERAGE_CENTER e
 *   COVERAGE_RADIUS_KM), usado quando o endereço tem coordenadas, por
 *   exemplo vindo da localização do WhatsApp.
 *
 * Sem nenhuma regra configurada, tudo é atendido.
 */
export interface Coverage {
  neighborhoods: string[];
  center: { latitude: number; longitude: number } | null;
  radiusKm: number | null;
}

export const NO_COVERAGE_RULES: Coverage = {
  neighborhoods: [],
  center: null,
  radiusKm: null,
};

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const rad = (deg: number): number => (deg * Math.PI) / 180;

/** Distância em km entre dois pontos (fórmula de haversine). */
export function distanceKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) *
      Math.cos(rad(b.latitude)) *
      Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

function coordinatesOf(
  address: Address,
): { latitude: number; longitude: number } | null {
  const latitude = Number(address.latitude);
  const longitude = Number(address.longitude);
  if (!address.latitude || !address.longitude) return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
}

/**
 * O endereço está na área de entrega? Vale o bairro na lista **ou** o ponto
 * dentro do raio. Com só o raio configurado e endereço sem coordenadas,
 * não dá para verificar: aceita, e o atendente resolve se precisar.
 */
export function isCovered(address: Address, coverage: Coverage): boolean {
  const byNeighborhood = coverage.neighborhoods.length > 0;
  const byRadius = coverage.center !== null && coverage.radiusKm !== null;
  if (!byNeighborhood && !byRadius) return true;

  if (
    byNeighborhood &&
    coverage.neighborhoods.some(
      (n) => normalize(n) === normalize(address.neighborhood),
    )
  ) {
    return true;
  }
  const point = coordinatesOf(address);
  if (byRadius && point && coverage.center && coverage.radiusKm !== null) {
    return distanceKm(coverage.center, point) <= coverage.radiusKm;
  }
  return !byNeighborhood && point === null;
}

/** Lê "Centro, Fátima" e "-5.08,-42.80". */
export function parseCoverage(input: {
  neighborhoods?: string;
  center?: string;
  radiusKm?: number;
}): Coverage {
  const neighborhoods = (input.neighborhoods ?? '')
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean);
  let center: Coverage['center'] = null;
  if (input.center) {
    const [lat, lon] = input.center.split(',').map((v) => Number(v.trim()));
    if (
      lat === undefined ||
      lon === undefined ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lon)
    ) {
      throw new Error(
        'COVERAGE_CENTER inválido. Use latitude,longitude, ex.: -5.08,-42.80',
      );
    }
    center = { latitude: lat, longitude: lon };
  }
  return { neighborhoods, center, radiusKm: input.radiusKm ?? null };
}
