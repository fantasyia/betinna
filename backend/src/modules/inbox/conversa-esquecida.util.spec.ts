import { describe, expect, it } from 'vitest';
import {
  ALERTA_ESQUECIDA_DEFAULT,
  horasComerciaisEntre,
  passouDoPrazo,
  resolveAlertaEsquecida,
} from './conversa-esquecida.util';

/** Helper: data em horário de Brasília (UTC-3). */
const brt = (iso: string) => new Date(`${iso}-03:00`);

describe('resolveAlertaEsquecida', () => {
  it('sem config, usa o combinado: 4h comerciais, seg–sex, 8h–18h', () => {
    expect(resolveAlertaEsquecida(undefined)).toEqual(ALERTA_ESQUECIDA_DEFAULT);
    expect(resolveAlertaEsquecida(null).horas).toBe(4);
  });

  it('respeita o ajuste do tenant', () => {
    const c = resolveAlertaEsquecida({ horas: 2, horaInicio: 9, horaFim: 17 });
    expect(c.horas).toBe(2);
    expect(c.horaInicio).toBe(9);
    expect(c.horaFim).toBe(17);
  });

  it('desligar é possível (ativo=false)', () => {
    expect(resolveAlertaEsquecida({ ativo: false }).ativo).toBe(false);
  });

  it('valor inválido cai no default em vez de quebrar a varredura', () => {
    const c = resolveAlertaEsquecida({ horas: -5, dias: 'segunda', horaFim: 99 });
    expect(c.horas).toBe(4);
    expect(c.dias).toEqual([1, 2, 3, 4, 5]);
    expect(c.horaFim).toBe(18);
  });

  it('janela invertida (fim <= início) volta pro default — senão o prazo nunca vence', () => {
    expect(resolveAlertaEsquecida({ horaInicio: 18, horaFim: 8 }).horaFim).toBe(18);
  });
});

describe('horasComerciaisEntre', () => {
  it('conta só o que está dentro do expediente', () => {
    // Quarta, 14h → 17h = 3h cheias de expediente.
    expect(
      horasComerciaisEntre(brt('2026-08-12T14:00:00'), brt('2026-08-12T17:00:00')),
    ).toBeCloseTo(3, 5);
  });

  it('a NOITE não conta — é o ponto do achado', () => {
    // Quarta 17h → quinta 9h: 1h (17→18) + 1h (8→9) = 2h, não 16.
    expect(
      horasComerciaisEntre(brt('2026-08-12T17:00:00'), brt('2026-08-13T09:00:00')),
    ).toBeCloseTo(2, 5);
  });

  it('o FIM DE SEMANA não conta', () => {
    // Sexta 17h → segunda 9h: 1h de sexta + 1h de segunda = 2h.
    expect(
      horasComerciaisEntre(brt('2026-08-14T17:00:00'), brt('2026-08-17T09:00:00')),
    ).toBeCloseTo(2, 5);
  });

  it('mensagem que chega de madrugada só começa a contar às 8h', () => {
    // Quarta 03h → quarta 10h = 2h (8→10), não 7.
    expect(
      horasComerciaisEntre(brt('2026-08-12T03:00:00'), brt('2026-08-12T10:00:00')),
    ).toBeCloseTo(2, 5);
  });

  it('intervalo invertido/zero devolve 0', () => {
    expect(horasComerciaisEntre(brt('2026-08-12T10:00:00'), brt('2026-08-12T09:00:00'))).toBe(0);
  });
});

describe('passouDoPrazo (4h comerciais)', () => {
  it('mensagem das 17h de sexta NÃO alerta no sábado (era o alarme falso)', () => {
    expect(passouDoPrazo(brt('2026-08-14T17:00:00'), brt('2026-08-15T12:00:00'))).toBe(false);
  });

  it('a mesma mensagem alerta na segunda de manhã, quando dá pra responder', () => {
    // Sexta 17h (1h) + segunda 8h→11h (3h) = 4h.
    expect(passouDoPrazo(brt('2026-08-14T17:00:00'), brt('2026-08-17T11:00:00'))).toBe(true);
  });

  it('3h de expediente ainda é atendimento em andamento, não esquecimento', () => {
    expect(passouDoPrazo(brt('2026-08-12T09:00:00'), brt('2026-08-12T12:00:00'))).toBe(false);
  });

  it('4h de expediente = esquecimento', () => {
    expect(passouDoPrazo(brt('2026-08-12T09:00:00'), brt('2026-08-12T13:00:00'))).toBe(true);
  });
});
