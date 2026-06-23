import { describe, expect, it, vi } from 'vitest';
import { KnowledgeConfigService } from './knowledge-config.service';

const makeDeps = (empresa: unknown) => {
  let seq = 0;
  const prisma = {
    empresa: { findUnique: vi.fn(async () => empresa) },
    knowledgeChunk: { upsert: vi.fn(async () => ({ id: `c${seq++}` })) },
  };
  const indexacao = { enfileirarChunk: vi.fn(async () => undefined) };
  const svc = new KnowledgeConfigService(prisma as never, indexacao as never);
  return { svc, prisma, indexacao };
};

interface UpsertArg {
  where: { empresaId_fonte_refId: { refId: string } };
  create: { ativo: boolean; conteudo: string };
  update: { ativo: boolean; conteudo: string };
}

function upsertArg(prisma: ReturnType<typeof makeDeps>['prisma'], refId: string): UpsertArg {
  const calls = prisma.knowledgeChunk.upsert.mock.calls as unknown as [UpsertArg][];
  const found = calls.map((c) => c[0]).find((a) => a.where.empresaId_fonte_refId.refId === refId);
  if (!found) throw new Error(`upsert não chamado para refId=${refId}`);
  return found;
}

describe('KnowledgeConfigService.sincronizar', () => {
  it('não faz nada quando a empresa não existe', async () => {
    const { svc, prisma } = makeDeps(null);
    await svc.sincronizar('emp-x');
    expect(prisma.knowledgeChunk.upsert).not.toHaveBeenCalled();
  });

  it('gera chunk de desconto à vista ATIVO e indexa quando há desconto', async () => {
    const { svc, prisma, indexacao } = makeDeps({
      config: {},
      descontoPixPct: 5,
      descontoBoletoAvistaPct: 0,
    });
    await svc.sincronizar('emp-1');
    const desc = upsertArg(prisma, 'descontoAvista');
    expect(desc.create.ativo).toBe(true);
    expect(desc.update.conteudo).toContain('5%');
    expect(indexacao.enfileirarChunk).toHaveBeenCalled();
  });

  it('desativa o chunk e NÃO indexa quando a feature está desligada', async () => {
    const { svc, prisma, indexacao } = makeDeps({
      config: { pedidoMinimo: { tipo: 'sem_minimo' } },
      descontoPixPct: 0,
      descontoBoletoAvistaPct: 0,
    });
    await svc.sincronizar('emp-1');
    expect(upsertArg(prisma, 'descontoAvista').update.ativo).toBe(false);
    expect(upsertArg(prisma, 'pedidoMinimo').update.ativo).toBe(false);
    // Nada ativo → nenhuma indexação enfileirada.
    expect(indexacao.enfileirarChunk).not.toHaveBeenCalled();
  });

  it('descreve pedido mínimo por peso', async () => {
    const { svc, prisma } = makeDeps({
      config: { pedidoMinimo: { tipo: 'por_peso', pesoMin: 250 } },
      descontoPixPct: 0,
      descontoBoletoAvistaPct: 0,
    });
    await svc.sincronizar('emp-1');
    const pm = upsertArg(prisma, 'pedidoMinimo');
    expect(pm.update.ativo).toBe(true);
    expect(pm.update.conteudo).toContain('250 kg');
  });
});
