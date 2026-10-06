import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Prisma, type UserRole } from '@prisma/client';
import {
  BusinessRuleException,
  ConflictException,
  NotFoundException,
} from '@shared/errors/app-exception';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { VitrineAdminService } from './vitrine-admin.service';

const user = (over: Partial<AuthenticatedUser> = {}): AuthenticatedUser =>
  ({
    id: 'u-1',
    email: 'dir@x.com',
    nome: 'Dir',
    role: 'DIRECTOR' as UserRole,
    empresaIds: ['emp-1'],
    empresaIdAtiva: 'emp-1',
    ...over,
  }) as AuthenticatedUser;

const p2002 = () =>
  new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'x' });
const p2003 = () =>
  new Prisma.PrismaClientKnownRequestError('fk', { code: 'P2003', clientVersion: 'x' });

function makePrisma() {
  const prisma = {
    vitrine: {
      findUnique: vi.fn().mockResolvedValue({ id: 'vit-1' }),
      upsert: vi.fn().mockResolvedValue({ id: 'vit-1' }),
    },
    catalogoCor: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue({ id: 'cor-1' }),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue({ id: 'cor-1' }),
      update: vi.fn().mockResolvedValue({ id: 'cor-1' }),
      delete: vi.fn().mockResolvedValue({}),
    },
    catalogoLinha: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue({ id: 'lin-1' }),
      create: vi.fn(),
      update: vi.fn(),
    },
    catalogoTamanho: {
      count: vi.fn().mockResolvedValue(0),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    catalogoCategoria: {
      findFirst: vi.fn().mockResolvedValue({ id: 'cat-1' }),
      delete: vi.fn().mockResolvedValue({}),
    },
    catalogoModelo: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue({ id: 'mod-1', cores: [], videos: [] }),
      findUniqueOrThrow: vi.fn(),
      create: vi.fn().mockResolvedValue({ id: 'mod-1' }),
      update: vi.fn().mockResolvedValue({ id: 'mod-1' }),
    },
    catalogoModeloCor: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn(),
      upsert: vi.fn(),
    },
    catalogoModeloLinha: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn(),
      upsert: vi.fn().mockResolvedValue({ id: 'ml-1' }),
    },
    catalogoModeloTamanho: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    catalogoVariacao: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn(),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
    produto: {
      create: vi.fn().mockResolvedValue({ id: 'prod-new' }),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    $transaction: vi.fn(),
  };
  // A transação roda o callback com o PRÓPRIO mock — as mesmas funções.
  prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
  return prisma;
}

/** Modelo com 2 cores × 1 linha × 2 tamanhos, como o banco devolve no sync. */
function modeloParaSync(variacoes: unknown[] = []) {
  return {
    id: 'mod-1',
    nome: 'Moletom',
    categoria: 'Moletom',
    ativo: true,
    cores: [
      { id: 'mc-preto', cor: { nome: 'Preto', ativo: true } },
      { id: 'mc-cinza', cor: { nome: 'Cinza', ativo: true } },
    ],
    linhas: [
      {
        id: 'ml-1',
        precoEntrada: new Prisma.Decimal(39.9),
        linha: { nome: 'Regular', ativo: true },
        tamanhos: [
          { id: 'mt-p', tamanho: { nome: 'P', ativo: true } },
          { id: 'mt-m', tamanho: { nome: 'M', ativo: true } },
        ],
      },
    ],
    variacoes,
  };
}

describe('VitrineAdminService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let svc: VitrineAdminService;
  let fotosSvc: { removerArquivos: ReturnType<typeof vi.fn> } & Record<string, unknown>;

  beforeEach(() => {
    prisma = makePrisma();
    fotosSvc = {
      comUrls: (f: object) => f,
      urlPublica: (p: string) => p,
      removerArquivos: vi.fn().mockResolvedValue(undefined),
    };
    svc = new VitrineAdminService(prisma as never, fotosSvc as never);
  });

  // ── ISOLAMENTO ─────────────────────────────────────────────────────────
  describe('isolamento por empresa', () => {
    it('empresa SEM vitrine ligada: catálogo responde 422 e não lê nada', async () => {
      prisma.vitrine.findUnique.mockResolvedValue(null);

      await expect(svc.listarCores(user())).rejects.toBeInstanceOf(BusinessRuleException);
      await expect(svc.listarModelos(user())).rejects.toBeInstanceOf(BusinessRuleException);
      await expect(
        svc.criarModelo(user(), { nome: 'X', corIds: [], linhas: [] }),
      ).rejects.toBeInstanceOf(BusinessRuleException);

      expect(prisma.catalogoCor.findMany).not.toHaveBeenCalled();
      expect(prisma.catalogoModelo.findMany).not.toHaveBeenCalled();
      expect(prisma.produto.create).not.toHaveBeenCalled();
    });

    it('a checagem usa a empresa ATIVA da sessão', async () => {
      await svc.listarCores(user({ empresaIdAtiva: 'emp-9' }));
      expect(prisma.vitrine.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { empresaId: 'emp-9' } }),
      );
      expect(prisma.catalogoCor.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { empresaId: 'emp-9' } }),
      );
    });

    it('cor de OUTRA empresa no modelo → recusa antes de gravar', async () => {
      prisma.catalogoCor.count.mockResolvedValue(1); // só 1 das 2 é desta empresa

      await expect(
        svc.criarModelo(user(), { nome: 'Moletom', corIds: ['cor-1', 'cor-alheia'] }),
      ).rejects.toBeInstanceOf(BusinessRuleException);
      expect(prisma.catalogoModelo.create).not.toHaveBeenCalled();
    });

    it('tamanho que não é da linha marcada → recusa', async () => {
      prisma.catalogoTamanho.count.mockResolvedValue(1);

      await expect(
        svc.criarModelo(user(), {
          nome: 'Moletom',
          linhas: [{ linhaId: 'lin-1', tamanhoIds: ['t-p', 't-de-outra-linha'] }],
        }),
      ).rejects.toBeInstanceOf(BusinessRuleException);
      expect(prisma.catalogoModelo.create).not.toHaveBeenCalled();
    });

    it('editar modelo de outra empresa → 404', async () => {
      prisma.catalogoModelo.findFirst.mockResolvedValue(null);
      await expect(svc.atualizarModelo(user(), 'mod-x', { nome: 'X' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  // ── CONFIG ─────────────────────────────────────────────────────────────
  describe('config', () => {
    it('endereço já usado por outra empresa → 409', async () => {
      prisma.vitrine.upsert.mockRejectedValue(p2002());
      await expect(svc.salvarConfig(user(), { slug: 'ribelt' })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('faixas fora de ordem (Volume ≤ Entrada) → 422', async () => {
      await expect(
        svc.salvarConfig(user(), { slug: 'ribelt', minimoEntrada: 50, minimoVolume: 50 }),
      ).rejects.toBeInstanceOf(BusinessRuleException);
      expect(prisma.vitrine.upsert).not.toHaveBeenCalled();
    });
  });

  // ── VARIAÇÕES ──────────────────────────────────────────────────────────
  describe('variações (modelo × cor × linha × tamanho)', () => {
    it('cria UMA variação e UM produto por cor × tamanho, com nome e preço da faixa Entrada', async () => {
      prisma.catalogoModelo.findUniqueOrThrow.mockResolvedValue(modeloParaSync());
      prisma.catalogoModelo.findFirst.mockResolvedValue({ id: 'mod-1', cores: [], videos: [] });

      await svc.criarModelo(user(), { nome: 'Moletom' });

      // 2 cores × 2 tamanhos = 4
      expect(prisma.produto.create).toHaveBeenCalledTimes(4);
      expect(prisma.catalogoVariacao.create).toHaveBeenCalledTimes(4);
      expect(prisma.produto.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          empresaId: 'emp-1',
          nome: 'Moletom · Preto · Regular P',
          linha: 'Regular',
          precoTabela: new Prisma.Decimal(39.9),
          ativo: true,
          atributos: { origem: 'vitrine', modeloId: 'mod-1' },
        }),
        select: { id: true },
      });
    });

    it('variação que já existe NÃO duplica: só atualiza o produto dela', async () => {
      prisma.catalogoModelo.findUniqueOrThrow.mockResolvedValue(
        modeloParaSync([
          {
            id: 'v-1',
            modeloCorId: 'mc-preto',
            modeloTamanhoId: 'mt-p',
            produtoId: 'prod-1',
            ativo: true,
          },
        ]),
      );

      await svc.atualizarModelo(user(), 'mod-1', { nome: 'Moletom' });

      expect(prisma.produto.create).toHaveBeenCalledTimes(3);
      expect(prisma.produto.update).toHaveBeenCalledWith({
        where: { id: 'prod-1' },
        data: expect.objectContaining({ nome: 'Moletom · Preto · Regular P' }),
      });
    });

    it('preço vazio ("sob consulta") vira precoTabela 0, nunca null', async () => {
      const m = modeloParaSync();
      m.linhas[0].precoEntrada = null as never;
      prisma.catalogoModelo.findUniqueOrThrow.mockResolvedValue(m);

      await svc.criarModelo(user(), { nome: 'Moletom' });

      const data = prisma.produto.create.mock.calls[0][0].data;
      expect(data.precoTabela).toEqual(new Prisma.Decimal(0));
    });

    it('modelo inativo → produtos inativos', async () => {
      const m = { ...modeloParaSync(), ativo: false };
      prisma.catalogoModelo.findUniqueOrThrow.mockResolvedValue(m);

      await svc.criarModelo(user(), { nome: 'Moletom', ativo: false });

      expect(prisma.produto.create.mock.calls.every((c) => c[0].data.ativo === false)).toBe(true);
    });

    it('DESMARCAR uma cor desativa os produtos dela ANTES de remover (pedido antigo segue válido)', async () => {
      prisma.catalogoCor.count.mockResolvedValue(1);
      prisma.catalogoModeloCor.findMany.mockResolvedValue([
        { id: 'mc-preto', corId: 'cor-preto' },
        { id: 'mc-cinza', corId: 'cor-cinza' },
      ]);
      prisma.catalogoVariacao.findMany.mockResolvedValue([
        { produtoId: 'prod-cinza-p' },
        { produtoId: 'prod-cinza-m' },
      ]);
      prisma.catalogoModelo.findUniqueOrThrow.mockResolvedValue(modeloParaSync());
      const ordem: string[] = [];
      prisma.produto.updateMany.mockImplementation(async () => {
        ordem.push('desativa');
        return { count: 2 };
      });
      prisma.catalogoModeloCor.deleteMany.mockImplementation(async () => {
        ordem.push('remove');
        return { count: 1 };
      });

      await svc.atualizarModelo(user(), 'mod-1', { nome: 'Moletom', corIds: ['cor-preto'] });

      expect(prisma.catalogoVariacao.findMany).toHaveBeenCalledWith({
        where: { modeloCorId: { in: ['mc-cinza'] } },
        select: { produtoId: true },
      });
      expect(prisma.produto.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['prod-cinza-p', 'prod-cinza-m'] } },
        data: { ativo: false },
      });
      expect(ordem).toEqual(['desativa', 'remove']);
    });

    it('edição mantém a cor do modelo por UPSERT (as fotos dela sobrevivem)', async () => {
      prisma.catalogoCor.count.mockResolvedValue(1);
      prisma.catalogoModeloCor.findMany.mockResolvedValue([{ id: 'mc-preto', corId: 'cor-preto' }]);
      prisma.catalogoModelo.findUniqueOrThrow.mockResolvedValue(modeloParaSync());

      await svc.atualizarModelo(user(), 'mod-1', { nome: 'Moletom', corIds: ['cor-preto'] });

      expect(prisma.catalogoModeloCor.deleteMany).not.toHaveBeenCalled();
      expect(prisma.catalogoModeloCor.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { modeloId_corId: { modeloId: 'mod-1', corId: 'cor-preto' } },
        }),
      );
    });
  });

  // ── EXCLUIR LINHA/TAMANHO ──────────────────────────────────────────────
  describe('excluir linha e tamanho', () => {
    it('linha usada por modelo → 422 e NADA é apagado', async () => {
      (prisma.catalogoModeloLinha as Record<string, unknown>).count = vi.fn().mockResolvedValue(2);
      (prisma.catalogoLinha as Record<string, unknown>).delete = vi.fn();
      await expect(svc.excluirLinha(user(), 'lin-1')).rejects.toBeInstanceOf(BusinessRuleException);
      expect(
        (prisma.catalogoLinha as unknown as { delete: ReturnType<typeof vi.fn> }).delete,
      ).not.toHaveBeenCalled();
    });

    it('linha sem uso → exclui', async () => {
      (prisma.catalogoModeloLinha as Record<string, unknown>).count = vi.fn().mockResolvedValue(0);
      const del = vi.fn().mockResolvedValue({});
      (prisma.catalogoLinha as Record<string, unknown>).delete = del;
      await expect(svc.excluirLinha(user(), 'lin-1')).resolves.toEqual({ ok: true });
      expect(del).toHaveBeenCalledWith({ where: { id: 'lin-1' } });
    });

    it('linha de outra empresa → 404', async () => {
      prisma.catalogoLinha.findFirst.mockResolvedValue(null);
      await expect(svc.excluirLinha(user(), 'lin-x')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('tamanho em uso (FK) → 422 pedindo pra desativar', async () => {
      prisma.catalogoTamanho.findFirst.mockResolvedValue({ id: 't-1' });
      (prisma.catalogoTamanho as Record<string, unknown>).delete = vi
        .fn()
        .mockRejectedValue(p2003());
      await expect(svc.excluirTamanho(user(), 't-1')).rejects.toBeInstanceOf(BusinessRuleException);
    });
  });

  // ── CATEGORIA, EXCLUIR MODELO, ORDEM ───────────────────────────────────
  describe('categoria do modelo', () => {
    it('categoria de OUTRA empresa → recusa antes de gravar', async () => {
      prisma.catalogoCategoria.findFirst.mockResolvedValue(null);
      await expect(
        svc.criarModelo(user(), { nome: 'Moletom', categoriaId: 'cat-alheia' }),
      ).rejects.toBeInstanceOf(BusinessRuleException);
      expect(prisma.catalogoCategoria.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'cat-alheia', empresaId: 'emp-1' } }),
      );
      expect(prisma.catalogoModelo.create).not.toHaveBeenCalled();
    });

    it('o produto da variação recebe o NOME da categoria', async () => {
      prisma.catalogoModelo.findUniqueOrThrow.mockResolvedValue({
        ...modeloParaSync(),
        categoria: { nome: 'Moletom' },
      });
      await svc.criarModelo(user(), { nome: 'Moletom', categoriaId: 'cat-1' });
      expect(prisma.produto.create.mock.calls[0][0].data.categoria).toBe('Moletom');
    });

    it('excluir categoria em uso → 422', async () => {
      prisma.catalogoCategoria.delete.mockRejectedValue(p2003());
      await expect(svc.excluirCategoria(user(), 'cat-1')).rejects.toBeInstanceOf(
        BusinessRuleException,
      );
    });
  });

  describe('excluir modelo', () => {
    it('desativa os produtos ANTES de apagar e remove a mídia DEPOIS do banco', async () => {
      const ordem: string[] = [];
      (prisma.catalogoModelo as Record<string, unknown>).findUniqueOrThrow = vi
        .fn()
        .mockResolvedValue({
          cores: [{ fotos: [{ storagePath: 'e/m/a.webp', thumbPath: 'e/m/a_thumb.webp' }] }],
          videos: [{ storagePath: 'e/m/video_1.mp4' }],
        });
      prisma.catalogoVariacao.findMany.mockResolvedValue([{ produtoId: 'prod-1' }]);
      prisma.produto.updateMany.mockImplementation(async () => {
        ordem.push('desativa');
        return { count: 1 };
      });
      const del = vi.fn(async () => {
        ordem.push('apaga');
        return {};
      });
      (prisma.catalogoModelo as Record<string, unknown>).delete = del;
      fotosSvc.removerArquivos.mockImplementation(async () => {
        ordem.push('midia');
      });

      await svc.excluirModelo(user(), 'mod-1');

      expect(ordem).toEqual(['desativa', 'apaga', 'midia']);
      expect(prisma.catalogoVariacao.findMany).toHaveBeenCalledWith({
        where: { modeloId: 'mod-1' },
        select: { produtoId: true },
      });
      expect(fotosSvc.removerArquivos).toHaveBeenCalledWith([
        'e/m/a.webp',
        'e/m/a_thumb.webp',
        'e/m/video_1.mp4',
      ]);
    });

    it('modelo de outra empresa → 404, nada apagado', async () => {
      prisma.catalogoModelo.findFirst.mockResolvedValue(null);
      const del = vi.fn();
      (prisma.catalogoModelo as Record<string, unknown>).delete = del;
      await expect(svc.excluirModelo(user(), 'mod-x')).rejects.toBeInstanceOf(NotFoundException);
      expect(del).not.toHaveBeenCalled();
    });
  });

  describe('ordem dos modelos', () => {
    it('exige EXATAMENTE os modelos da empresa (nem a mais, nem a menos)', async () => {
      prisma.catalogoModelo.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
      await expect(svc.reordenarModelos(user(), ['a'])).rejects.toBeInstanceOf(
        BusinessRuleException,
      );
      await expect(svc.reordenarModelos(user(), ['a', 'x'])).rejects.toBeInstanceOf(
        BusinessRuleException,
      );
    });

    it('grava a posição de cada um', async () => {
      prisma.catalogoModelo.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
      prisma.$transaction.mockImplementationOnce(async (ops: unknown[]) => ops);
      await svc.reordenarModelos(user(), ['b', 'a']);
      expect(prisma.catalogoModelo.update).toHaveBeenCalledWith({
        where: { id: 'b' },
        data: { ordem: 0 },
      });
      expect(prisma.catalogoModelo.update).toHaveBeenCalledWith({
        where: { id: 'a' },
        data: { ordem: 1 },
      });
    });
  });

  // ── LISTAS ─────────────────────────────────────────────────────────────
  describe('listas de cores', () => {
    it('cor com nome repetido → 409', async () => {
      prisma.catalogoCor.create.mockRejectedValue(p2002());
      await expect(svc.criarCor(user(), { nome: 'Preto', hex: '#000000' })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('excluir cor em uso → 422 pedindo pra desativar', async () => {
      prisma.catalogoCor.delete.mockRejectedValue(p2003());
      await expect(svc.excluirCor(user(), 'cor-1')).rejects.toBeInstanceOf(BusinessRuleException);
    });
  });
});
