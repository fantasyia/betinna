import { describe, expect, it } from 'vitest';
import {
  JANELA_ENVIO_DEFAULT,
  esperaAteJanelaMs,
  resolveJanelaEnvio,
} from './whatsapp-pacing.util';

/**
 * A janela é escrita em horário de BRASÍLIA, mas o servidor roda em UTC. Todos
 * os casos abaixo montam o instante em UTC e afirmam o comportamento esperado
 * no relógio de parede brasileiro (BRT = UTC−3) — se alguém trocar o offset por
 * `getHours()`, estes testes caem.
 */
// Instante UTC correspondente a `hora:min` do relógio de Brasília naquele dia.
// Somar sobre a meia-noite UTC (e não formatar a string com hora+3) porque
// 23h BRT é 02h do dia SEGUINTE em UTC — a string "T26:00" seria Invalid Date,
// e um NaN silencioso faria todo teste de madrugada passar por engano.
const brt = (dia: string, hora: number, min = 0) =>
  new Date(Date.parse(`${dia}T00:00:00.000Z`) + (hora + 3) * 3600_000 + min * 60_000);

// 2026-08-19 é uma quarta-feira.
const QUARTA = '2026-08-19';
const SABADO = '2026-08-22';
const DOMINGO = '2026-08-23';

describe('esperaAteJanelaMs — silêncio noturno', () => {
  it('meio da tarde: pode enviar agora', () => {
    expect(esperaAteJanelaMs(JANELA_ENVIO_DEFAULT, brt(QUARTA, 14))).toBe(0);
  });

  it('23h: segura até as 8h do dia seguinte (9 horas)', () => {
    const espera = esperaAteJanelaMs(JANELA_ENVIO_DEFAULT, brt(QUARTA, 23));
    expect(espera).toBe(9 * 3600_000);
  });

  it('3h da manhã: segura até as 8h do MESMO dia (5 horas)', () => {
    expect(esperaAteJanelaMs(JANELA_ENVIO_DEFAULT, brt(QUARTA, 3))).toBe(5 * 3600_000);
  });

  it('07:59 abre em 1 minuto; 08:00 já está aberto', () => {
    expect(esperaAteJanelaMs(JANELA_ENVIO_DEFAULT, brt(QUARTA, 7, 59))).toBe(60_000);
    expect(esperaAteJanelaMs(JANELA_ENVIO_DEFAULT, brt(QUARTA, 8))).toBe(0);
  });

  it('20h em ponto já é silêncio (fim é exclusivo)', () => {
    expect(esperaAteJanelaMs(JANELA_ENVIO_DEFAULT, brt(QUARTA, 19, 59))).toBe(0);
    expect(esperaAteJanelaMs(JANELA_ENVIO_DEFAULT, brt(QUARTA, 20))).toBe(12 * 3600_000);
  });

  it('desligada: nunca segura', () => {
    const cfg = resolveJanelaEnvio({ ativa: false });
    expect(esperaAteJanelaMs(cfg, brt(QUARTA, 3))).toBe(0);
  });

  it('sem fim de semana: sábado 10h espera até segunda 8h (46 horas)', () => {
    const cfg = resolveJanelaEnvio({ dias: [1, 2, 3, 4, 5] });
    expect(esperaAteJanelaMs(cfg, brt(SABADO, 10))).toBe(46 * 3600_000);
  });

  it('sem fim de semana: domingo 21h espera até segunda 8h (11 horas)', () => {
    const cfg = resolveJanelaEnvio({ dias: [1, 2, 3, 4, 5] });
    expect(esperaAteJanelaMs(cfg, brt(DOMINGO, 21))).toBe(11 * 3600_000);
  });
});

describe('resolveJanelaEnvio — config torta não pode calar a empresa', () => {
  it('janela invertida (abre 22, fecha 6) cai no default em vez de nunca abrir', () => {
    const cfg = resolveJanelaEnvio({ horaInicio: 22, horaFim: 6 });
    expect(cfg.horaFim).toBe(JANELA_ENVIO_DEFAULT.horaFim);
    // O que importa não é o número: é que exista alguma hora do dia em que envia.
    expect(esperaAteJanelaMs(cfg, brt(QUARTA, 14))).toBe(0);
  });

  it('lista de dias vazia cai no default (senão o outbound morre pra sempre)', () => {
    expect(resolveJanelaEnvio({ dias: [] }).dias).toEqual(JANELA_ENVIO_DEFAULT.dias);
  });

  it('lixo no lugar dos números cai no default', () => {
    const cfg = resolveJanelaEnvio({ horaInicio: 'oito', horaFim: null, dias: ['seg', 99] });
    expect(cfg).toEqual(JANELA_ENVIO_DEFAULT);
  });

  it('config ausente = janela ativa (o padrão protege sem ninguém configurar)', () => {
    expect(resolveJanelaEnvio(undefined)).toEqual(JANELA_ENVIO_DEFAULT);
  });
});
