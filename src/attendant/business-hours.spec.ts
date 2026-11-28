import { describe, expect, it } from 'vitest';
import {
  describeHours,
  isOpen,
  isValidHours,
  parseBusinessHours,
} from './business-hours.js';

const hours = parseBusinessHours({
  hours: '08:00-18:00',
  days: '1,2,3,4,5,6',
  timeZone: 'America/Fortaleza',
})!;

describe('horário de atendimento', () => {
  it('sem BUSINESS_HOURS não há restrição', () => {
    expect(
      parseBusinessHours({ days: '1', timeZone: 'America/Fortaleza' }),
    ).toBeUndefined();
  });

  it.each([
    ['2026-11-27T11:00:00Z', true], // sexta, 08:00 em Fortaleza
    ['2026-11-27T10:59:00Z', false],
    ['2026-11-27T21:00:00Z', false], // 18:00: já fechou
    ['2026-11-29T15:00:00Z', false], // domingo
  ])('em %s aberto = %s', (at, open) => {
    expect(isOpen(hours, new Date(at))).toBe(open);
  });

  it('descreve dias e horas', () => {
    expect(describeHours(hours)).toBe(
      'seg, ter, qua, qui, sex, sáb, das 08:00 às 18:00',
    );
  });

  it('recusa formato inválido ou fim antes do início', () => {
    expect(isValidHours('8-18')).toBe(false);
    expect(isValidHours('18:00-08:00')).toBe(false);
    expect(isValidHours('08:00-18:00')).toBe(true);
  });
});
