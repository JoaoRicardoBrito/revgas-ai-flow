import { describe, expect, it } from 'vitest';
import {
  distanceKm,
  isCovered,
  NO_COVERAGE_RULES,
  parseCoverage,
} from './coverage.js';

const at = (neighborhood: string, latitude?: number, longitude?: number) => ({
  street: 'Rua A',
  number: '1',
  neighborhood,
  ...(latitude === undefined
    ? {}
    : { latitude: String(latitude), longitude: String(longitude) }),
});

// Centro de Teresina (fictício para o teste).
const STORE = { latitude: -5.0892, longitude: -42.8019 };

describe('isCovered', () => {
  it('sem regras, tudo é atendido', () => {
    expect(isCovered(at('Qualquer'), NO_COVERAGE_RULES)).toBe(true);
  });

  it('por bairro, ignorando caixa e acento', () => {
    const coverage = parseCoverage({ neighborhoods: 'Centro, Fátima' });

    expect(isCovered(at('fatima'), coverage)).toBe(true);
    expect(isCovered(at('  CENTRO '), coverage)).toBe(true);
    expect(isCovered(at('Dirceu'), coverage)).toBe(false);
  });

  it('por raio, quando o endereço tem coordenadas', () => {
    const coverage = { ...NO_COVERAGE_RULES, center: STORE, radiusKm: 5 };

    expect(isCovered(at('Longe', -5.1, -42.81), coverage)).toBe(true);
    expect(isCovered(at('Longe', -5.3, -42.8), coverage)).toBe(false);
  });

  it('bairro fora da lista mas dentro do raio é atendido', () => {
    const coverage = {
      ...parseCoverage({ neighborhoods: 'Centro' }),
      center: STORE,
      radiusKm: 5,
    };

    expect(isCovered(at('Fátima', -5.07, -42.79), coverage)).toBe(true);
  });

  it('só raio e endereço sem coordenadas: aceita (não dá para verificar)', () => {
    const coverage = { ...NO_COVERAGE_RULES, center: STORE, radiusKm: 5 };

    expect(isCovered(at('Sem ponto'), coverage)).toBe(true);
  });

  it('lista de bairros e endereço sem coordenadas fora da lista: não atendido', () => {
    const coverage = {
      ...parseCoverage({ neighborhoods: 'Centro' }),
      center: STORE,
      radiusKm: 5,
    };

    expect(isCovered(at('Dirceu'), coverage)).toBe(false);
  });
});

describe('distanceKm', () => {
  it('um grau de latitude dá ~111 km', () => {
    expect(
      distanceKm({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 }),
    ).toBeCloseTo(111.2, 0);
  });
});

describe('parseCoverage', () => {
  it('lê bairros e centro', () => {
    expect(
      parseCoverage({
        neighborhoods: 'Centro,, Fátima ',
        center: '-5.08, -42.80',
        radiusKm: 3,
      }),
    ).toEqual({
      neighborhoods: ['Centro', 'Fátima'],
      center: { latitude: -5.08, longitude: -42.8 },
      radiusKm: 3,
    });
  });

  it('recusa centro inválido', () => {
    expect(() => parseCoverage({ center: 'perto da praça' })).toThrow(
      /COVERAGE_CENTER/,
    );
  });
});
