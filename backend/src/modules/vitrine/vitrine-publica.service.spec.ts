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
    expect(args.include.cores.where).toEqual({
      cor: { ativo: true },
      fotos: { some: { oculta: false } },
    });
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

  it('opcional NUNCA sai sozinho: sem o base publicado, sai junto (#01, 02/11)', async () => {
    const prisma = makePrisma(vitrineNoAr, [
      modelo({ id: 'uv' }),
      modelo({ id: 'uv-emb', opcionalDeId: 'uv', opcionalNome: 'emblema' }),
      modelo({ id: 'polo-emb', opcionalDeId: 'polo-escondida', opcionalNome: 'emblema' }),
    ]);
    const svc = new VitrinePublicaService(prisma as never, fotosSvc as never);
    const r = await svc.carregar('atacado-ribelt');
    expect(r.modelos.map((m) => m.id)).toEqual(['uv', 'uv-emb']);
    expect(r.modelos[0].opcionais).toEqual([{ modeloId: 'uv-emb', nome: 'emblema' }]);
  });

  describe('frete ligado: produto sem peso não aparece (Léo, 10/10)', () => {
    const comFrete = {
      ...vitrineNoAr,
      empresa: { ...vitrineNoAr.empresa, config: { frete: { ativo: true } } },
    };
    const linha = (id: string, pesos: Array<number | null>) => ({
      id: `ml-${id}`,
      linhaId: `lin-${id}`,
      linha: { nome: id, ordem: 0, ativo: true },
      precoEntrada: new Prisma.Decimal(45),
      precoVolume: null,
      precoAtacadao: null,
      precoSugerido: null,
      tabelaMedidas: null,
      tamanhos: pesos.map((p, i) => ({
        id: `mt-${id}-${i}`,
        tamanhoId: `t-${i}`,
        pesoGramas: p,
        tamanho: { nome: `T${i}`, ordem: i },
      })),
    });

    it('tamanho sem peso sai; linha sem nenhum peso sai; modelo sem linha sai', async () => {
      const prisma = makePrisma(comFrete, [
        modelo({ id: 'parcial', linhas: [linha('reg', [300, null]), linha('inf', [null, null])] }),
        modelo({ id: 'sem-peso', linhas: [linha('reg', [null, 0])] }),
      ]);
      const svc = new VitrinePublicaService(prisma as never, fotosSvc as never);
      const r = await svc.carregar('atacado-ribelt');

      expect(r.modelos.map((m) => m.id)).toEqual(['parcial']);
      expect(r.modelos[0].linhas.map((l) => l.nome)).toEqual(['reg']);
      expect(r.modelos[0].linhas[0].tamanhos.map((t) => t.nome)).toEqual(['T0']);
      // o peso em si não vai pro público
      expect(JSON.stringify(r)).not.toContain('pesoGramas');
    });

    it('linha sem preço de entrada sai; modelo só com ela sai (Léo, 04/11)', async () => {
      const semPreco = { ...linha('reg', [300]), precoEntrada: null };
      const prisma = makePrisma(comFrete, [
        modelo({ id: 'oversize', linhas: [semPreco, linha('plus', [300])] }),
        modelo({ id: 'sem-preco', linhas: [semPreco] }),
      ]);
      const svc = new VitrinePublicaService(prisma as never, fotosSvc as never);
      const r = await svc.carregar('atacado-ribelt');

      expect(r.modelos.map((m) => m.id)).toEqual(['oversize']);
      expect(r.modelos[0].linhas.map((l) => l.nome)).toEqual(['plus']);
    });

    it('frete DESLIGADO: peso não importa, tudo aparece como antes', async () => {
      const prisma = makePrisma(vitrineNoAr, [
        modelo({ id: 'sem-peso', linhas: [linha('reg', [null, null])] }),
      ]);
      const svc = new VitrinePublicaService(prisma as never, fotosSvc as never);
      const r = await svc.carregar('atacado-ribelt');
      expect(r.modelos.map((m) => m.id)).toEqual(['sem-peso']);
      expect(r.modelos[0].linhas[0].tamanhos).toHaveLength(2);
    });
  });

  it('não vaza dado interno: sem produtoId, SKU, estoque ou config da empresa', async () => {
    const prisma = makePrisma(vitrineNoAr, [modelo()]);
    const svc = new VitrinePublicaService(prisma as never, fotosSvc as never);
    const r = await svc.carregar('atacado-ribelt');
    const json = JSON.stringify(r);
    expect(json).not.toMatch(/produtoId|sku|empresaId|storagePath/i);
    // Sem "respeita estoque": nenhum número de estoque sai.
    expect(r.respeitaEstoque).toBe(false);
    expect(r.modelos.every((m) => m.estoque === null)).toBe(true);
    // Só marca pública (nome, logo, símbolo e o WhatsApp de atendimento, que é
    // público de propósito) — nada mais da config da empresa.
    expect(r.empresa).toEqual({
      nome: 'Ribelt Distribuidora',
      logoUrl: 'https://x/logo.png',
      simboloUrl: null,
      whatsapp: null,
    });
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

describe('avaliações na vitrine (01/11: o número parava de subir)', () => {
  it('total REAL por modelo, e as 12 mais recentes de cada modelo (sem corte global)', async () => {
    const prisma = {
      ...makePrisma(vitrineNoAr, [modelo(), modelo({ id: 'mod-2' })]),
      avaliacaoVitrine: {
        groupBy: vi.fn().mockResolvedValue([{ modeloId: 'mod-1', _count: { _all: 37 } }]),
        findMany: vi.fn(),
      },
      $queryRaw: vi.fn().mockResolvedValue(
        Array.from({ length: 12 }, () => ({
          modeloId: 'mod-1',
          estrelas: 5,
          texto: 'ótimo',
          autor: null,
          cores: [],
          fotos: [],
        })),
      ),
    };
    const svc = new VitrinePublicaService(prisma as never, fotosSvc as never);
    const r = await svc.carregar('atacado-ribelt');
    const m = r.modelos.find((x) => x.id === 'mod-1')!;
    expect(m.avaliacoesTotal).toBe(37);
    expect(m.avaliacoes).toHaveLength(12);
    // 02/11 (Sentry, N+1): UMA consulta pra todos os modelos, corte de 12 POR modelo.
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.avaliacaoVitrine.findMany).not.toHaveBeenCalled();
    const [partes, ...valores] = prisma.$queryRaw.mock.calls[0];
    const sql = (partes as string[]).join('?');
    expect(sql).toMatch(/PARTITION BY "modeloId"/);
    expect(sql).toMatch(/n <= 12/);
    expect(sql).toMatch(/status = 'APROVADA'/);
    expect(valores).toContainEqual(['mod-1', 'mod-2']);
  });
});

describe('vitrine que respeita estoque (entrega 5)', () => {
  it('diz o disponível por cor × tamanho (ids da própria vitrine, sem produto)', async () => {
    const prisma = makePrisma({ ...vitrineNoAr, respeitaEstoque: true }, [modelo()]);
    (prisma as unknown as { catalogoVariacao: unknown }).catalogoVariacao = {
      findMany: vi.fn().mockResolvedValue([
        { modeloId: 'mod-1', modeloCorId: 'mc-1', modeloTamanhoId: 'mt-p', produtoId: 'prod-x' },
        { modeloId: 'mod-1', modeloCorId: 'mc-1', modeloTamanhoId: 'mt-m', produtoId: 'prod-y' },
      ]),
    };
    const estoque = {
      vitrineRespeitaEstoque: vi.fn().mockResolvedValue(true),
      disponiveis: vi.fn().mockResolvedValue(
        new Map([
          ['prod-x', 3],
          ['prod-y', -2],
        ]),
      ),
    };
    const svc = new VitrinePublicaService(prisma as never, fotosSvc as never, estoque as never);
    const r = await svc.carregar('atacado-ribelt');
    expect(r.respeitaEstoque).toBe(true);
    expect(r.modelos[0].estoque).toEqual({ 'mc-1': { 'mt-p': 3, 'mt-m': 0 } });
    expect(JSON.stringify(r)).not.toMatch(/prod-x|produtoId/);
  });
});

describe('opcionaisDosModelos (02/11, "+ emblema")', () => {
  it('liga o opcional ao base publicado; sem o base, nada', async () => {
    const { opcionaisDosModelos } = await import('./vitrine-publica.service');
    const m = opcionaisDosModelos([
      { id: 'uv' },
      { id: 'uv-emb', opcionalDeId: 'uv', opcionalNome: 'emblema emborrachado' },
      { id: 'orfao', opcionalDeId: 'fora-da-vitrine', opcionalNome: 'x' },
    ]);
    expect(m.get('uv')).toEqual([{ modeloId: 'uv-emb', nome: 'emblema emborrachado' }]);
    expect(m.has('fora-da-vitrine')).toBe(false);
  });
});

describe('paresDoConjunto (upsell: blusa ↔ calça)', () => {
  it('ligar de um lado vale nos dois; par fora da vitrine e ele mesmo saem', async () => {
    const { paresDoConjunto } = await import('./vitrine-publica.service');
    const p = paresDoConjunto([
      { id: 'blusa', combinaCom: ['calca', 'inativo', 'blusa'] },
      { id: 'calca', combinaCom: [] },
      { id: 'bermuda', combinaCom: [] },
    ]);
    expect(p.get('blusa')).toEqual(['calca']);
    expect(p.get('calca')).toEqual(['blusa']);
    expect(p.get('bermuda')).toEqual([]);
  });
});
