import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { UserRole } from '@prisma/client';
import { BusinessRuleException, NotFoundException } from '@shared/errors/app-exception';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { VitrineFotosService, ehWebp } from './vitrine-fotos.service';

const storageFns = {
  upload: vi.fn(),
  remove: vi.fn(),
  list: vi.fn(),
  createSignedUploadUrl: vi.fn(),
};
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    storage: {
      listBuckets: vi.fn().mockResolvedValue({ data: [] }),
      createBucket: vi.fn().mockResolvedValue({}),
      from: () => storageFns,
    },
  }),
}));

const user = (): AuthenticatedUser =>
  ({
    id: 'u-1',
    role: 'DIRECTOR' as UserRole,
    empresaIds: ['emp-1'],
    empresaIdAtiva: 'emp-1',
  }) as AuthenticatedUser;

/** Cabeçalho mínimo de um WebP de verdade. */
const webp = (tam = 2000) => {
  const b = Buffer.alloc(tam);
  b.write('RIFF', 0, 'ascii');
  b.write('WEBP', 8, 'ascii');
  return { buffer: b, size: b.length };
};

function makePrisma() {
  return {
    vitrine: { findUnique: vi.fn().mockResolvedValue({ id: 'vit-1' }) },
    catalogoModeloCor: {
      findFirst: vi.fn().mockResolvedValue({ id: 'mc-1', modeloId: 'mod-1' }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'mc-1',
        ...data,
      })),
    },
    catalogoModelo: { findFirst: vi.fn().mockResolvedValue({ id: 'mod-1' }) },
    catalogoModeloLinha: { findFirst: vi.fn().mockResolvedValue({ id: 'ml-1' }) },
    catalogoFoto: {
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'f-1',
        ...data,
      })),
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(),
    },
    catalogoVideo: {
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'v-1',
        ...data,
      })),
      findFirst: vi.fn(),
      delete: vi.fn(),
    },
    $transaction: vi.fn(),
  };
}
const env = {
  get: (k: string) => (k === 'SUPABASE_URL' ? 'https://sb.test' : 'x'),
};

describe('VitrineFotosService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let svc: VitrineFotosService;

  beforeEach(() => {
    vi.clearAllMocks();
    storageFns.upload.mockResolvedValue({ error: null });
    storageFns.remove.mockResolvedValue({ error: null });
    prisma = makePrisma();
    svc = new VitrineFotosService(prisma as never, env as never);
  });

  it('ehWebp: confere o magic number, não o nome do arquivo', () => {
    expect(ehWebp(webp().buffer)).toBe(true);
    expect(ehWebp(Buffer.from('\x89PNG\r\n\x1a\n0000000000'))).toBe(false);
  });

  it('foto que não é WebP é recusada antes de subir', async () => {
    const png = { buffer: Buffer.from('\x89PNG\r\n\x1a\n0000000000'), size: 18 };
    await expect(svc.enviar(user(), 'mc-1', png, undefined, {})).rejects.toBeInstanceOf(
      BusinessRuleException,
    );
    expect(storageFns.upload).not.toHaveBeenCalled();
  });

  it('cor de modelo de OUTRA empresa → 404, nada sobe', async () => {
    prisma.catalogoModeloCor.findFirst.mockResolvedValue(null);
    await expect(svc.enviar(user(), 'mc-alheia', webp(), undefined, {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.catalogoModeloCor.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'mc-alheia', modelo: { empresaId: 'emp-1' } } }),
    );
    expect(storageFns.upload).not.toHaveBeenCalled();
  });

  it('empresa sem vitrine → 422', async () => {
    prisma.vitrine.findUnique.mockResolvedValue(null);
    await expect(svc.enviar(user(), 'mc-1', webp(), undefined, {})).rejects.toBeInstanceOf(
      BusinessRuleException,
    );
  });

  it('sobe foto + miniatura no path da empresa/modelo e devolve URL pública', async () => {
    const r = await svc.enviar(user(), 'mc-1', webp(), webp(500), { largura: 1080, altura: 1440 });

    const paths = storageFns.upload.mock.calls.map((c) => c[0] as string);
    expect(paths).toHaveLength(2);
    expect(paths[0]).toMatch(/^emp-1\/mod-1\/\d+_[0-9a-f]{12}\.webp$/);
    expect(paths[1]).toMatch(/_thumb\.webp$/);
    expect(r.url).toBe(`https://sb.test/storage/v1/object/public/vitrine-fotos/${paths[0]}`);
  });

  it('se o banco falhar, o arquivo enviado é removido (sem lixo no bucket)', async () => {
    prisma.catalogoFoto.create.mockRejectedValue(new Error('banco fora'));
    await expect(svc.enviar(user(), 'mc-1', webp(), undefined, {})).rejects.toThrow('banco fora');
    expect(storageFns.remove).toHaveBeenCalledWith([expect.stringMatching(/\.webp$/)]);
  });

  it('reordenar exige EXATAMENTE as fotos daquela cor', async () => {
    prisma.catalogoFoto.findMany.mockResolvedValue([{ id: 'f-1' }, { id: 'f-2' }]);
    await expect(svc.reordenar(user(), 'mc-1', ['f-1', 'f-de-outra-cor'])).rejects.toBeInstanceOf(
      BusinessRuleException,
    );
  });

  describe('bolinha da cor (ponto da capa)', () => {
    it('grava o ponto escolhido e null volta pro automático', async () => {
      await svc.definirAmostra(user(), 'mc-1', { x: 0.4, y: 0.6 });
      expect(prisma.catalogoModeloCor.update).toHaveBeenLastCalledWith(
        expect.objectContaining({ where: { id: 'mc-1' }, data: { amostraX: 0.4, amostraY: 0.6 } }),
      );
      await svc.definirAmostra(user(), 'mc-1', null);
      expect(prisma.catalogoModeloCor.update).toHaveBeenLastCalledWith(
        expect.objectContaining({ data: { amostraX: null, amostraY: null } }),
      );
    });

    it('capa nova (reordenar) zera o ponto; mesma capa mantém', async () => {
      prisma.catalogoFoto.findMany.mockResolvedValue([{ id: 'f-1' }, { id: 'f-2' }]);
      await svc.reordenar(user(), 'mc-1', ['f-1', 'f-2']);
      expect(prisma.catalogoModeloCor.update).not.toHaveBeenCalled();
      await svc.reordenar(user(), 'mc-1', ['f-2', 'f-1']);
      expect(prisma.catalogoModeloCor.update).toHaveBeenCalledWith({
        where: { id: 'mc-1' },
        data: { amostraX: null, amostraY: null },
      });
    });

    it('apagar a capa zera o ponto; apagar outra foto não', async () => {
      prisma.catalogoFoto.findFirst
        .mockResolvedValueOnce({
          id: 'f-2',
          modeloCorId: 'mc-1',
          storagePath: 'a.webp',
          thumbPath: null,
        })
        .mockResolvedValueOnce({ id: 'f-1' });
      await svc.excluir(user(), 'f-2');
      expect(prisma.catalogoModeloCor.update).not.toHaveBeenCalled();
      prisma.catalogoFoto.findFirst
        .mockResolvedValueOnce({
          id: 'f-1',
          modeloCorId: 'mc-1',
          storagePath: 'b.webp',
          thumbPath: null,
        })
        .mockResolvedValueOnce({ id: 'f-1' });
      await svc.excluir(user(), 'f-1');
      expect(prisma.catalogoModeloCor.update).toHaveBeenCalledWith({
        where: { id: 'mc-1' },
        data: { amostraX: null, amostraY: null },
      });
    });
  });

  describe('foto por linha (biotipo)', () => {
    it('grava a linha, e o teto/ordem contam só aquele grupo cor × linha', async () => {
      prisma.catalogoFoto.count.mockResolvedValue(3);
      await svc.enviar(user(), 'mc-1', webp(), undefined, {}, 'lin-plus');
      expect(prisma.catalogoFoto.count).toHaveBeenCalledWith({
        where: { modeloCorId: 'mc-1', linhaId: 'lin-plus' },
      });
      expect(prisma.catalogoFoto.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ linhaId: 'lin-plus', ordem: 3 }),
        }),
      );
    });

    it('sem linha = foto geral (o comportamento de antes)', async () => {
      await svc.enviar(user(), 'mc-1', webp(), undefined, {});
      expect(prisma.catalogoFoto.count).toHaveBeenCalledWith({
        where: { modeloCorId: 'mc-1', linhaId: null },
      });
      expect(prisma.catalogoModeloLinha.findFirst).not.toHaveBeenCalled();
    });

    it('linha que o modelo não tem → recusa, sem subir arquivo', async () => {
      prisma.catalogoModeloLinha.findFirst.mockResolvedValue(null);
      await expect(
        svc.enviar(user(), 'mc-1', webp(), undefined, {}, 'lin-outra'),
      ).rejects.toBeInstanceOf(BusinessRuleException);
      expect(storageFns.upload).not.toHaveBeenCalled();
    });

    it('trocar a capa DE UMA LINHA não zera a bolinha (ela sai da capa geral)', async () => {
      prisma.catalogoFoto.findMany.mockResolvedValue([{ id: 'f-1' }, { id: 'f-2' }]);
      await svc.reordenar(user(), 'mc-1', ['f-2', 'f-1'], 'lin-plus');
      expect(prisma.catalogoFoto.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { modeloCorId: 'mc-1', linhaId: 'lin-plus' } }),
      );
      expect(prisma.catalogoModeloCor.update).not.toHaveBeenCalled();
    });

    it('apagar a capa de uma linha não zera a bolinha', async () => {
      prisma.catalogoFoto.findFirst
        .mockResolvedValueOnce({
          id: 'f-1',
          modeloCorId: 'mc-1',
          linhaId: 'lin-plus',
          storagePath: 'a.webp',
          thumbPath: null,
        })
        .mockResolvedValueOnce({ id: 'f-1' });
      await svc.excluir(user(), 'f-1');
      expect(prisma.catalogoModeloCor.update).not.toHaveBeenCalled();
    });
  });

  describe('vídeo', () => {
    it('confirmar recusa path que não foi gerado pra esta empresa/modelo', async () => {
      await expect(
        svc.confirmarVideo(user(), 'mod-1', { storagePath: 'emp-OUTRA/mod-1/video_1.mp4' }),
      ).rejects.toBeInstanceOf(BusinessRuleException);
      await expect(
        svc.confirmarVideo(user(), 'mod-1', { storagePath: 'emp-1/mod-1/video_../../x.mp4' }),
      ).rejects.toBeInstanceOf(BusinessRuleException);
      expect(prisma.catalogoVideo.create).not.toHaveBeenCalled();
    });

    it('confirmar recusa se o arquivo não chegou ao Storage', async () => {
      storageFns.list.mockResolvedValue({ data: [] });
      await expect(
        svc.confirmarVideo(user(), 'mod-1', { storagePath: 'emp-1/mod-1/video_1_ab.mp4' }),
      ).rejects.toBeInstanceOf(BusinessRuleException);
    });

    it('confirma quando o arquivo existe no path da empresa', async () => {
      storageFns.list.mockResolvedValue({ data: [{ name: 'video_1_ab.mp4' }] });
      const r = await svc.confirmarVideo(user(), 'mod-1', {
        storagePath: 'emp-1/mod-1/video_1_ab.mp4',
        nomeArquivo: 'moletom.mp4',
      });
      expect(r.url).toMatch(/vitrine-fotos\/emp-1\/mod-1\/video_1_ab\.mp4$/);
    });

    it('preparar recusa vídeo maior que o teto', async () => {
      await expect(svc.prepararVideo(user(), 'mod-1', 200 * 1024 * 1024)).rejects.toBeInstanceOf(
        BusinessRuleException,
      );
      expect(storageFns.createSignedUploadUrl).not.toHaveBeenCalled();
    });
  });
});
