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
    },
    catalogoModelo: { findFirst: vi.fn().mockResolvedValue({ id: 'mod-1' }) },
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
