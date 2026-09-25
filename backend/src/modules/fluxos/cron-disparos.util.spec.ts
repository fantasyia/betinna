import { describe, expect, it, vi } from 'vitest';
import { horariosDoDia, lerDisparos, resultadoDoSlot } from './cron-disparos.util';
import { FluxoTriggersJob } from './fluxo-triggers.job';

/**
 * Rastro dos disparos do cron (Léo, 25/09): o R2 disparava 5×/dia sem nada a
 * liberar, a execução sem efeito era APAGADA, e o painel dizia "último disparo
 * 08/09" e sumia com o horário da agenda quando ele passava.
 */

const R2 = ['0 9,11,13,15,17 * * 1-5'];
const TZ = 'America/Sao_Paulo';
// Quinta, 25/09/2026, 12:30 em Brasília (15:30Z).
const AGORA = new Date('2026-09-25T15:30:00Z');

describe('horariosDoDia', () => {
  it('lista TODOS os horários de hoje no fuso do fluxo — os que passaram e os que faltam', () => {
    const h = horariosDoDia(R2, TZ, AGORA).map((d) => d.toISOString());
    expect(h).toEqual([
      '2026-09-25T12:00:00.000Z',
      '2026-09-25T14:00:00.000Z',
      '2026-09-25T16:00:00.000Z',
      '2026-09-25T18:00:00.000Z',
      '2026-09-25T20:00:00.000Z',
    ]);
  });

  it('"hoje" é o de Brasília, não o do servidor em UTC: 01:30 BRT (04:30Z) ainda é o mesmo dia', () => {
    const h = horariosDoDia(R2, TZ, new Date('2026-09-25T04:30:00Z'));
    expect(h).toHaveLength(5);
    expect(h[0].toISOString()).toBe('2026-09-25T12:00:00.000Z');
  });

  it('o horário da MEIA-NOITE de hoje entra (a busca começa 1ms antes dela)', () => {
    const h = horariosDoDia(['0 0 * * *'], TZ, AGORA).map((d) => d.toISOString());
    expect(h).toEqual(['2026-09-25T03:00:00.000Z']);
  });

  it('cron de minuto em minuto não vira agenda de 1440 linhas', () => {
    expect(horariosDoDia(['* * * * *'], TZ, AGORA).length).toBe(24);
  });
});

describe('resultadoDoSlot', () => {
  const slot = new Date('2026-09-25T12:00:00Z'); // 09:00 BRT, já passou
  const base = { slot, agora: AGORA, tz: TZ, pularFeriados: false, registroDesde: slot };

  it('execução apagada = rodou sem nada a fazer (não "sem registro")', () => {
    const r = resultadoDoSlot({
      ...base,
      disparo: { slot: slot.toISOString(), execId: 'e1' },
      exec: null,
    });
    expect(r).toEqual({ resultado: 'sem_efeito', detalhe: 'rodou — nada a fazer' });
  });

  it('concluída, falhou (com o erro) e em andamento', () => {
    const d = { slot: slot.toISOString(), execId: 'e1' };
    expect(
      resultadoDoSlot({ ...base, disparo: d, exec: { status: 'CONCLUIDO', erroMsg: null } })
        .resultado,
    ).toBe('ok');
    const f = resultadoDoSlot({
      ...base,
      disparo: d,
      exec: { status: 'FALHOU', erroMsg: 'Evolution 400' },
    });
    expect(f).toEqual({ resultado: 'falhou', detalhe: 'falhou — Evolution 400' });
    expect(
      resultadoDoSlot({ ...base, disparo: d, exec: { status: 'AGUARDANDO', erroMsg: null } })
        .resultado,
    ).toBe('rodando');
  });

  it('horário futuro é "agendado"', () => {
    const futuro = new Date('2026-09-25T20:00:00Z');
    expect(resultadoDoSlot({ ...base, slot: futuro }).resultado).toBe('agendado');
  });

  it('passou sem disparo e o rastro JÁ existia → acusa "não disparou"', () => {
    expect(resultadoDoSlot({ ...base }).resultado).toBe('nao_disparou');
  });

  it('passou sem disparo mas o rastro começou DEPOIS (dia do deploy) → não acusa falso', () => {
    const r = resultadoDoSlot({ ...base, registroDesde: new Date('2026-09-25T14:00:00Z') });
    expect(r.resultado).toBe('sem_registro');
    expect(resultadoDoSlot({ ...base, registroDesde: null }).resultado).toBe('sem_registro');
  });

  it('feriado nacional com "pular feriados" → pulado', () => {
    const natal = new Date('2026-12-25T12:00:00Z');
    const r = resultadoDoSlot({
      ...base,
      slot: natal,
      agora: new Date('2026-12-25T15:00:00Z'),
      pularFeriados: true,
    });
    expect(r.resultado).toBe('feriado');
  });

  it('entrada corrompida no rastro é ignorada', () => {
    expect(lerDisparos(['{"slot":"2026-09-25T12:00:00Z","execId":"e1"}', 'lixo', '{}'])).toEqual([
      { slot: '2026-09-25T12:00:00Z', execId: 'e1' },
    ]);
  });
});

describe('o job grava o rastro de cada slot disparado', () => {
  it('disparou → LPUSH {slot, execId} na lista do fluxo', async () => {
    const slot = new Date(Date.now() - 30_000).toISOString();
    const redis = {
      get: vi.fn().mockResolvedValue(slot),
      set: vi.fn().mockResolvedValue(undefined),
      lpushCapped: vi.fn().mockResolvedValue(undefined),
    };
    const prisma = {
      fluxo: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'fx-r2',
            nome: 'R2',
            empresaId: 'emp-1',
            triggerConfig: { expressoes: ['* * * * *'] },
            nos: [{ id: 'no-trigger' }],
          },
        ]),
      },
      fluxoExecucao: { create: vi.fn().mockResolvedValue({ id: 'exec-1' }) },
    };
    const job = new FluxoTriggersJob(
      prisma as never,
      redis as never,
      { dispararDireto: vi.fn().mockResolvedValue(undefined) } as never,
      { get: () => 'production' } as never,
      { acquire: vi.fn().mockResolvedValue(true) } as never,
      {} as never,
      {} as never,
      {} as never,
      { registrar: vi.fn().mockResolvedValue(undefined) } as never,
      undefined as never,
    );

    await job.avaliarCronsAgendados();

    expect(redis.lpushCapped).toHaveBeenCalledWith(
      'cron:disparos:fx-r2',
      JSON.stringify({ slot, execId: 'exec-1' }),
      60,
    );
  });
});
