import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import { aguardarSyncErp, type EstadoSyncErp } from '@/lib/sync-erp';

/**
 * BETINNA-FRONT-9: a tela dizia "falha" num sync que dava certo, porque
 * esperava o catálogo inteiro dentro de um POST de 30s. Agora o servidor
 * responde 202 e a tela acompanha. O que este teste trava é a leitura dessa
 * espera: "ainda rodando" nunca pode virar "falhou".
 */

const RESULTADO = { lidos: 300, criados: 2, atualizados: 298, erros: 0 };

/** Relógio falso: cada `esperar` avança o tempo, sem timer de verdade. */
function relogio() {
  let t = 0;
  return {
    agora: () => t,
    esperar: vi.fn(async (ms: number) => {
      t += ms;
    }),
  };
}

function respostas(...lista: Array<EstadoSyncErp | Error>) {
  const fila = [...lista];
  return vi.fn(async () => {
    const r = fila.shift() ?? lista[lista.length - 1];
    if (r instanceof Error) throw r;
    return r;
  });
}

describe('aguardarSyncErp', () => {
  it('espera passar por enfileirado e rodando até concluir, e devolve o resultado', async () => {
    const r = relogio();
    const buscar = respostas(
      { estado: 'enfileirado' },
      { estado: 'rodando' },
      { estado: 'rodando' },
      { estado: 'concluido', resultado: RESULTADO },
    );

    const fim = await aguardarSyncErp('j1', { ...r, buscar, intervaloMs: 2000 });

    expect(fim).toEqual({ estado: 'concluido', resultado: RESULTADO });
    expect(buscar).toHaveBeenCalledTimes(4);
  });

  it('sync que passa dos 30s NÃO vira falha — o caso do FRONT-9', async () => {
    const r = relogio();
    // 60s rodando (30 consultas de 2s) e só então conclui.
    const buscar = respostas(
      ...Array.from({ length: 30 }, () => ({ estado: 'rodando' }) as const),
      { estado: 'concluido', resultado: RESULTADO },
    );

    const fim = await aguardarSyncErp('j1', { ...r, buscar });

    expect(fim.estado).toBe('concluido');
    expect(r.agora()).toBeGreaterThan(30_000);
  });

  it('falha de verdade do sync chega com o motivo', async () => {
    const buscar = respostas({ estado: 'falhou', erro: 'Tiny HTTP 401' });
    const fim = await aguardarSyncErp('j1', { ...relogio(), buscar });
    expect(fim).toEqual({ estado: 'falhou', erro: 'Tiny HTTP 401' });
  });

  it('erro de rede numa consulta não derruba a espera', async () => {
    const buscar = respostas(new TypeError('Failed to fetch'), {
      estado: 'concluido',
      resultado: RESULTADO,
    });
    const fim = await aguardarSyncErp('j1', { ...relogio(), buscar });
    expect(fim.estado).toBe('concluido');
  });

  it('404 encerra: o job sumiu ou não é desta empresa', async () => {
    const buscar = respostas(new ApiError(404, 'NOT_FOUND', 'Sincronização não encontrada'));
    const fim = await aguardarSyncErp('j1', { ...relogio(), buscar });
    expect(fim.estado).toBe('falhou');
  });

  it('passou do limite: "demorou", não "falhou" — o sync continua no servidor', async () => {
    const buscar = respostas({ estado: 'rodando' });
    const fim = await aguardarSyncErp('j1', {
      ...relogio(),
      buscar,
      intervaloMs: 1000,
      limiteMs: 5000,
    });
    expect(fim).toEqual({ estado: 'demorou' });
  });

  it('tela fechada: para de consultar', async () => {
    const buscar = respostas({ estado: 'rodando' });
    const fim = await aguardarSyncErp('j1', { ...relogio(), buscar, cancelado: () => true });
    expect(fim).toEqual({ estado: 'cancelado' });
    expect(buscar).not.toHaveBeenCalled();
  });
});
