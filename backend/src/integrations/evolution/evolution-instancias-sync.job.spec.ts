import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { EvolutionInstanciasSyncJob } from './evolution-instancias-sync.job';

function setup(opts: { provider?: string; lock?: boolean; zumbiCount?: number } = {}) {
  const evolution = {
    listarInstanciasDetalhadas: vi.fn().mockResolvedValue([]),
    resetarForte: vi.fn().mockResolvedValue(undefined),
  };
  const instancias = { sincronizarConexao: vi.fn().mockResolvedValue(undefined) };
  const env = {
    get: vi.fn((k: string) =>
      k === 'WHATSAPP_PROVIDER' ? (opts.provider ?? 'evolution') : 'production',
    ),
  };
  const cronLock = { acquire: vi.fn().mockResolvedValue(opts.lock ?? true) };
  // incr devolve `zumbiCount` (default 1 = 1ª detecção, não reseta); del/expire stub.
  const redis = {
    incr: vi.fn().mockResolvedValue(opts.zumbiCount ?? 1),
    del: vi.fn().mockResolvedValue(1),
    client: { expire: vi.fn().mockResolvedValue(1) },
  };
  const status = { marcarDesconectado: vi.fn().mockResolvedValue(undefined) };
  const job = new EvolutionInstanciasSyncJob(
    evolution as never,
    instancias as never,
    env as never,
    cronLock as never,
    redis as never,
    status as never,
  );
  return { job, evolution, instancias, cronLock, redis, status };
}

describe('EvolutionInstanciasSyncJob', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('NÃO roda quando WHATSAPP_PROVIDER != evolution', async () => {
    const { job, evolution } = setup({ provider: 'baileys' });
    await job.sincronizar();
    expect(evolution.listarInstanciasDetalhadas).not.toHaveBeenCalled();
  });

  it('NÃO roda quando o lock não é adquirido (outra réplica já sincroniza)', async () => {
    const { job, evolution } = setup({ lock: false });
    await job.sincronizar();
    expect(evolution.listarInstanciasDetalhadas).not.toHaveBeenCalled();
  });

  it('sincroniza cada instância com nome/status/ownerJid', async () => {
    const { job, evolution, instancias } = setup();
    evolution.listarInstanciasDetalhadas.mockResolvedValue([
      { name: 'emp_emp-1', connectionStatus: 'open', ownerJid: '5511@s.whatsapp.net' },
      { name: 'user_rep-1', connectionStatus: 'connecting', ownerJid: null },
    ]);
    await job.sincronizar();
    expect(instancias.sincronizarConexao).toHaveBeenCalledTimes(2);
    expect(instancias.sincronizarConexao).toHaveBeenNthCalledWith(
      1,
      'emp_emp-1',
      'open',
      '5511@s.whatsapp.net',
    );
    expect(instancias.sincronizarConexao).toHaveBeenNthCalledWith(
      2,
      'user_rep-1',
      'connecting',
      null,
    );
  });

  it('status ausente vira "close"', async () => {
    const { job, evolution, instancias } = setup();
    evolution.listarInstanciasDetalhadas.mockResolvedValue([{ name: 'emp_emp-2' }]);
    await job.sincronizar();
    expect(instancias.sincronizarConexao).toHaveBeenCalledWith('emp_emp-2', 'close', undefined);
  });

  it('1ª detecção de zumbi NÃO reseta (guard de 2 ciclos)', async () => {
    const { job, evolution } = setup({ zumbiCount: 1 });
    evolution.listarInstanciasDetalhadas.mockResolvedValue([
      { name: 'emp_z', connectionStatus: 'open', disconnectionReasonCode: 401 },
    ]);
    await job.sincronizar();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ZUMBI'));
    expect(evolution.resetarForte).not.toHaveBeenCalled();
  });

  it('zumbi CONFIRMADO (2ª detecção) → resetarForte + marca close + alerta o diretor', async () => {
    const { job, evolution, instancias, status } = setup({ zumbiCount: 2 });
    evolution.listarInstanciasDetalhadas.mockResolvedValue([
      { name: 'emp_z', connectionStatus: 'open', disconnectionReasonCode: 401 },
    ]);
    await job.sincronizar();
    expect(evolution.resetarForte).toHaveBeenCalledWith('emp_z');
    expect(instancias.sincronizarConexao).toHaveBeenCalledWith('emp_z', 'close');
    // empresaId = parte após `emp_` (emp_z → z).
    expect(status.marcarDesconectado).toHaveBeenCalledWith('z', 'whatsapp', expect.any(String));
  });

  it('instância saudável zera o contador de zumbi (Redis del)', async () => {
    const { job, evolution, redis } = setup();
    evolution.listarInstanciasDetalhadas.mockResolvedValue([
      { name: 'emp_ok', connectionStatus: 'open', disconnectionReasonCode: null },
    ]);
    await job.sincronizar();
    expect(redis.del).toHaveBeenCalledWith('evo:zumbi:emp_ok');
  });

  it('erro no Evolution NÃO lança (best-effort)', async () => {
    const { job, evolution } = setup();
    evolution.listarInstanciasDetalhadas.mockRejectedValue(new Error('evolution down'));
    await expect(job.sincronizar()).resolves.toBeUndefined();
  });
});
