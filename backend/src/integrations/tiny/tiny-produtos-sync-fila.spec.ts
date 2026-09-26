import { describe, expect, it, vi } from 'vitest';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { NotFoundException } from '@shared/errors/app-exception';
import { TinyProdutosSyncFilaService } from './tiny-produtos-sync-fila.service';
import { TinyProdutosSyncProcessor } from './tiny-produtos-sync.processor';
import { TinyOAuthController } from './tiny-oauth.controller';

/**
 * BETINNA-FRONT-9 (18/09): o botão "Sincronizar do ERP" rodava o catálogo
 * completo DENTRO da requisição. Passou dos 30s que o front espera por um POST,
 * a tela disse "falha" com o servidor terminando certinho — e o operador clicou
 * de novo, disparando OUTRO sync completo contra o Tiny.
 *
 * O que este spec trava:
 *   1. a requisição NÃO roda o sync — só enfileira e responde 202;
 *   2. o segundo clique acompanha o sync que já existe, não cria outro;
 *   3. a consulta de estado não atravessa tenant.
 */

const RESULTADO = {
  lidos: 300,
  criados: 2,
  atualizados: 298,
  estoqueAtualizado: 300,
  erros: 0,
  imagensFalharam: 0,
};

function jobFalso(
  id: string,
  empresaId: string,
  estado: string,
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    data: { empresaId, modo: 'completo' },
    getState: vi.fn().mockResolvedValue(estado),
    returnvalue: undefined as unknown,
    failedReason: undefined as string | undefined,
    ...extra,
  };
}

function filaFalsa(jobs: ReturnType<typeof jobFalso>[] = []) {
  return {
    add: vi.fn().mockResolvedValue(undefined),
    getJobs: vi.fn().mockResolvedValue(jobs),
    getJob: vi.fn((id: string) => Promise.resolve(jobs.find((j) => j.id === id) ?? null)),
  };
}

describe('enfileirar — a requisição não roda o sync', () => {
  it('sem sync em andamento: enfileira e devolve o id', async () => {
    const fila = filaFalsa();
    const svc = new TinyProdutosSyncFilaService(fila as never);

    const r = await svc.enfileirar('emp1', 'completo');

    expect(r.jaEmAndamento).toBe(false);
    expect(fila.add).toHaveBeenCalledTimes(1);
    const [, dados, opts] = fila.add.mock.calls[0];
    expect(dados).toEqual({ empresaId: 'emp1', modo: 'completo' });
    expect(opts.jobId).toBe(r.jobId);
    // BullMQ v5 rejeita `:` em jobId customizado — já parou o worker uma vez.
    expect(r.jobId).not.toContain(':');
    // Sem retentativa automática: catálogo inteiro contra API com rate limit.
    expect(opts.attempts).toBe(1);
  });

  it('segundo clique com sync da MESMA empresa rodando: acompanha o existente, não cria outro', async () => {
    const fila = filaFalsa([jobFalso('sync-produtos_emp1_1', 'emp1', 'active')]);
    const svc = new TinyProdutosSyncFilaService(fila as never);

    const r = await svc.enfileirar('emp1', 'completo');

    expect(r).toEqual({ jobId: 'sync-produtos_emp1_1', jaEmAndamento: true });
    expect(fila.add).not.toHaveBeenCalled();
  });

  it('sync de OUTRA empresa rodando não bloqueia esta', async () => {
    const fila = filaFalsa([jobFalso('sync-produtos_emp2_1', 'emp2', 'active')]);
    const svc = new TinyProdutosSyncFilaService(fila as never);

    const r = await svc.enfileirar('emp1', 'completo');

    expect(r.jaEmAndamento).toBe(false);
    expect(fila.add).toHaveBeenCalledTimes(1);
  });
});

describe('status — o que a tela lê enquanto espera', () => {
  it.each([
    ['waiting', { estado: 'enfileirado' }],
    ['delayed', { estado: 'enfileirado' }],
    ['active', { estado: 'rodando' }],
  ])('%s → %o', async (estadoBull, esperado) => {
    const fila = filaFalsa([jobFalso('j1', 'emp1', estadoBull)]);
    const svc = new TinyProdutosSyncFilaService(fila as never);
    expect(await svc.status('emp1', 'j1')).toEqual(esperado);
  });

  it('concluído devolve o resultado do sync — é dele que sai "N novos, M atualizados"', async () => {
    const fila = filaFalsa([jobFalso('j1', 'emp1', 'completed', { returnvalue: RESULTADO })]);
    const svc = new TinyProdutosSyncFilaService(fila as never);
    expect(await svc.status('emp1', 'j1')).toEqual({ estado: 'concluido', resultado: RESULTADO });
  });

  it('falhou devolve o motivo', async () => {
    const fila = filaFalsa([
      jobFalso('j1', 'emp1', 'failed', { failedReason: 'Tiny HTTP 401: token expirado' }),
    ]);
    const svc = new TinyProdutosSyncFilaService(fila as never);
    expect(await svc.status('emp1', 'j1')).toEqual({
      estado: 'falhou',
      erro: 'Tiny HTTP 401: token expirado',
    });
  });

  it('job de OUTRA empresa responde igual a inexistente', async () => {
    const fila = filaFalsa([jobFalso('j2', 'emp2', 'completed', { returnvalue: RESULTADO })]);
    const svc = new TinyProdutosSyncFilaService(fila as never);

    await expect(svc.status('emp1', 'j2')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.status('emp1', 'nao-existe')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('worker', () => {
  it('roda o sync da empresa do job e devolve o resultado (vira o `returnvalue`)', async () => {
    const sync = { sync: vi.fn().mockResolvedValue(RESULTADO) };
    const proc = new TinyProdutosSyncProcessor(sync as never);

    const r = await proc.process({
      id: 'j1',
      data: { empresaId: 'emp1', modo: 'completo' },
    } as never);

    expect(sync.sync).toHaveBeenCalledWith('emp1', { modo: 'completo' });
    expect(r).toBe(RESULTADO);
  });
});

describe('controller — o POST enfileira, não sincroniza', () => {
  const user = { empresaIdAtiva: 'emp1' } as never;

  function controller() {
    const syncFila = {
      enfileirar: vi.fn().mockResolvedValue({ jobId: 'j1', jaEmAndamento: false }),
      status: vi.fn(),
    };
    const vazio = {} as never;
    const ctrl = new TinyOAuthController(vazio, vazio, vazio, vazio, vazio, syncFila as never);
    return { ctrl, syncFila };
  }

  it('responde 202', () => {
    const codigo = Reflect.getMetadata(
      HTTP_CODE_METADATA,
      TinyOAuthController.prototype.sincronizarProdutos,
    );
    expect(codigo).toBe(202);
  });

  it('`?modo=completo` chega ao enfileiramento; qualquer outro valor vira incremental', async () => {
    const { ctrl, syncFila } = controller();

    await ctrl.sincronizarProdutos(user, 'completo');
    await ctrl.sincronizarProdutos(user, 'qualquer-coisa');

    expect(syncFila.enfileirar).toHaveBeenNthCalledWith(1, 'emp1', 'completo');
    expect(syncFila.enfileirar).toHaveBeenNthCalledWith(2, 'emp1', 'incremental');
  });
});
