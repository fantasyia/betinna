import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
import { NotFoundException } from '@shared/errors/app-exception';
import { VitrinePublicaService } from './vitrine-publica.service';

const fotosSvc = { urlPublica: (p: string | null) => (p ? `https://cdn/${p}` : null) };

const modelo = (over: Record<string, unknown> = {}) => ({
  id: 'mod-1',
  nome: 'Moletom',
  ativo: true,
  categoria: { id: 'cat-1', nome: 'Moletom', ativo: true },
  descricao: 'd',
  etiquetas: ['Capuz'],
  tituloMarketplace: 't',
  descricaoMarketplace: 'dm',
  composicao: null,
  cores: [
    {
      id: 'mc-1',
      cor: { nome: 'Preto', hex: '#000000', ativo: true },
      fotos: [
        { storagePath: 'e/m/1.webp', thumbPath: 'e/m/1_thumb.webp', largura: 1080, altura: 1440 },
      ],
    },
  ],
  linhas: [
    {
      id: 'ml-1',
      linhaId: 'lin-1',
      linha: { nome: 'Regular', ordem: 0, ativo: true },
      precoEntrada: new Prisma.Decimal(45),
      precoVolume: null,
      precoAtacadao: null,
      precoSugerido: new Prisma.Decimal(89.9),
      tabelaMedidas: null,
      tamanhos: [
        { id: 'mt-m', tamanho: { nome: 'M', ordem: 1 } },
        { id: 'mt-p', tamanho: { nome: 'P', ordem: 0 } },
      ],
    },
  ],
  videos: [],
  ...over,
});

function makePrisma(vitrine: unknown, modelos: unknown[]) {
  return {
    vitrine: { findUnique: vi.fn().mockResolvedValue(vitrine) },
    catalogoModelo: { findMany: vi.fn().mockResolvedValue(modelos) },
  };
}

const vitrineNoAr = {
  ativa: true,
  minimoEntrada: 5,
  minimoVolume: 50,
  minimoAtacadao: 500,
  empresaId: 'emp-1',
  empresa: {
    nome: 'Ribelt Distribuidora',
    ativo: true,
    config: { branding: { logoUrl: 'https://x/logo.png' } },
  },
};

describe('VitrinePublicaService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('vitrine desligada, inexistente ou de empresa inativa → 404 (mesma resposta)', async () => {
    for (const v of [
      null,
      { ...vitrineNoAr, ativa: false },
      { ...vitrineNoAr, empresa: { ...vitrineNoAr.empresa, ativo: false } },
    ]) {
      const prisma = makePrisma(v, [modelo()]);
      const svc = new VitrinePublicaService(prisma as never, fotosSvc as never);
      await expect(svc.carregar('atacado-ribelt')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.catalogoModelo.findMany).not.toHaveBeenCalled();
    }
  });

  it('só modelos ATIVOS da empresa da vitrine, e só cores ativas COM foto, linhas e tamanhos ativos', async () => {
    const prisma = makePrisma(vitrineNoAr, [modelo()]);
    const svc = new VitrinePublicaService(prisma as never, fotosSvc as never);
    await svc.carregar('atacado-ribelt');

    const args = prisma.catalogoModelo.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ empresaId: 'emp-1', ativo: true });
    expect(args.include.cores.where).toEqual({ cor: { ativo: true }, fotos: { some: {} } });
    expect(args.include.linhas.where).toEqual({ linha: { ativo: true } });
    expect(args.include.linhas.include.tamanhos.where).toEqual({ tamanho: { ativo: true } });
  });

  it('modelo sem cor com foto ou sem grade NÃO sai', async () => {
    const prisma = makePrisma(vitrineNoAr, [
      modelo({ id: 'sem-cor', cores: [] }),
      modelo({ id: 'sem-grade', linhas: [] }),
      modelo({ id: 'ok' }),
    ]);
    const svc = new VitrinePublicaService(prisma as never, fotosSvc as never);
    const r = await svc.carregar('atacado-ribelt');
    expect(r.modelos.map((m) => m.id)).toEqual(['ok']);
  });

  it('não vaza dado interno: sem produtoId, SKU, estoque ou config da empresa', async () => {
    const prisma = makePrisma(vitrineNoAr, [modelo()]);
    const svc = new VitrinePublicaService(prisma as never, fotosSvc as never);
    const r = await svc.carregar('atacado-ribelt');
    const json = JSON.stringify(r);
    expect(json).not.toMatch(/produtoId|sku|estoque|empresaId|storagePath/i);
    expect(r.empresa).toEqual({ nome: 'Ribelt Distribuidora', logoUrl: 'https://x/logo.png' });
  });

  it('🔒 CUSTO nunca sai na vitrine pública (calculadora de precificação)', async () => {
    const m = modelo();
    const comCusto = {
      ...m,
      linhas: m.linhas.map((l) => ({
        ...l,
        custoPorPeca: new Prisma.Decimal(9.7),
        custoAtualizadoEm: new Date(),
      })),
    };
    const prisma = makePrisma(vitrineNoAr, [comCusto]);
    const svc = new VitrinePublicaService(prisma as never, fotosSvc as never);
    const json = JSON.stringify(await svc.carregar('atacado-ribelt'));
    expect(json).not.toMatch(/custo|9\.7/i);
  });

  it('preço vira número, tamanhos na ordem da lista e URL pública das fotos', async () => {
    const prisma = makePrisma(vitrineNoAr, [modelo()]);
    const svc = new VitrinePublicaService(prisma as never, fotosSvc as never);
    const r = await svc.carregar('atacado-ribelt');
    const l = r.modelos[0].linhas[0];
    expect(l.precoEntrada).toBe(45);
    expect(l.precoVolume).toBeNull();
    expect(l.tamanhos.map((t) => t.nome)).toEqual(['P', 'M']);
    expect(r.modelos[0].cores[0].fotos[0].url).toBe('https://cdn/e/m/1.webp');
    expect(r.linhas).toEqual([{ id: 'lin-1', nome: 'Regular' }]);
    expect(r.faixas).toEqual({ minimoEntrada: 5, minimoVolume: 50, minimoAtacadao: 500 });
  });
});
