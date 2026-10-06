import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { Reflector } from '@nestjs/core';
import { BusinessRuleException, NotFoundException } from '@shared/errors/app-exception';
import { PrecificacaoController } from './precificacao.controller';
import { PrecificacaoService } from './precificacao.service';

const user = { id: 'u1', role: 'DIRECTOR', empresaIdAtiva: 'emp-1', empresaIds: ['emp-1'] };

function montar(config: unknown) {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ config }]),
    empresa: { update: vi.fn().mockResolvedValue({}) },
  };
  const prisma = {
    empresa: { findUnique: vi.fn().mockResolvedValue({ config }) },
    vitrine: {
      findUnique: vi.fn().mockResolvedValue({ minimoVolume: 200, minimoAtacadao: 1000 }),
    },
    catalogoModelo: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'm1',
          nome: 'Camiseta UV',
          ativo: true,
          linhas: [
            {
              id: 'ml1',
              precoEntrada: new Prisma.Decimal(17.99),
              precoVolume: new Prisma.Decimal(15.99),
              precoAtacadao: new Prisma.Decimal(14.99),
              precoSugerido: null,
              custoPorPeca: new Prisma.Decimal(9.7),
              custoAtualizadoEm: null,
              linha: { nome: 'Adulto', ordem: 0 },
            },
          ],
        },
      ]),
    },
    catalogoModeloLinha: {
      findFirst: vi.fn().mockResolvedValue({ id: 'ml1', modeloId: 'm1', custoPorPeca: null }),
      update: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const admin = { ressincronizarModelo: vi.fn().mockResolvedValue(undefined) };
  const svc = new PrecificacaoService(prisma as never, admin as never);
  return { svc, prisma, tx, admin };
}

const ligada = {
  precificacao: { ativa: true, impostoPct: 6 },
  pedidoMinimo: { tipo: 'combinada', valorMin: 600, quantidadeMin: 50, modo: 'OU' },
  marca: { nome: 'X' },
};

describe('PrecificacaoService', () => {
  it('só ADMIN e DIRECTOR passam pelo controller', () => {
    const roles = new Reflector().get<string[]>('roles', PrecificacaoController);
    expect([...roles].sort()).toEqual(['ADMIN', 'DIRECTOR']);
  });

  it('empresa SEM a flag: status falso e 422 sem ler o catálogo', async () => {
    const { svc, prisma } = montar({ pedidoMinimo: { tipo: 'por_valor', valorMin: 600 } });
    expect(await svc.status(user as never)).toEqual({ ativa: false });
    await expect(svc.carregar(user as never)).rejects.toBeInstanceOf(BusinessRuleException);
    await expect(svc.salvarTaxas(user as never, {})).rejects.toBeInstanceOf(BusinessRuleException);
    await expect(svc.salvarPrecosDaLinha(user as never, 'ml1', {})).rejects.toBeInstanceOf(
      BusinessRuleException,
    );
    expect(prisma.catalogoModelo.findMany).not.toHaveBeenCalled();
    expect(prisma.catalogoModeloLinha.update).not.toHaveBeenCalled();
  });

  it('carrega custo, preços, faixas e o pedido mínimo da empresa', async () => {
    const { svc } = montar(ligada);
    const r = await svc.carregar(user as never);
    expect(r.taxas.impostoPct).toBe(6);
    expect(r.faixas).toEqual({ minimoVolume: 200, minimoAtacadao: 1000 });
    expect(r.pedidoMinimo).toEqual({ valorMin: 600, quantidadeMin: 50, modo: 'OU' });
    expect(r.modelos[0].linhas[0]).toMatchObject({
      id: 'ml1',
      precoEntrada: 17.99,
      custo: { manual: 9.7 },
    });
  });

  it('salvar taxas não liga/desliga a flag e preserva o resto do config', async () => {
    const { svc, tx } = montar(ligada);
    await svc.salvarTaxas(user as never, { pixPct: 1.5, anuncioPorPedido: 50 });
    const gravado = tx.empresa.update.mock.calls[0][0].data.config;
    expect(gravado.precificacao).toMatchObject({ ativa: true, pixPct: 1.5, anuncioPorPedido: 50 });
    expect(gravado.pedidoMinimo).toEqual(ligada.pedidoMinimo);
    expect(gravado.marca).toEqual({ nome: 'X' });
  });

  it('o cliente não consegue ligar a flag mandando `ativa`', async () => {
    const { svc, tx } = montar({ precificacao: { ativa: true } });
    await svc.salvarTaxas(user as never, { ativa: false } as never);
    expect(tx.empresa.update.mock.calls[0][0].data.config.precificacao.ativa).toBe(true);
  });

  it('salvar preços grava na linha, carimba o custo e ressincroniza os produtos', async () => {
    const { svc, prisma, admin } = montar(ligada);
    await svc.salvarPrecosDaLinha(user as never, 'ml1', {
      custoPorPeca: 9.7,
      precoEntrada: 17.99,
      precoVolume: 15.99,
      precoAtacadao: 14.99,
      precoSugerido: 39.9,
    });
    expect(prisma.catalogoModeloLinha.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'ml1', modelo: { empresaId: 'emp-1' } } }),
    );
    const data = prisma.catalogoModeloLinha.update.mock.calls[0][0].data;
    expect(Number(data.precoEntrada)).toBe(17.99);
    expect(Number(data.custoPorPeca)).toBe(9.7);
    expect(data.custoAtualizadoEm).toBeInstanceOf(Date);
    expect(admin.ressincronizarModelo).toHaveBeenCalledWith('emp-1', 'm1');
  });

  it('linha de OUTRA empresa: 404', async () => {
    const { svc, prisma } = montar(ligada);
    prisma.catalogoModeloLinha.findFirst.mockResolvedValue(null);
    await expect(svc.salvarPrecosDaLinha(user as never, 'ml-x', {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.catalogoModeloLinha.update).not.toHaveBeenCalled();
  });
});
