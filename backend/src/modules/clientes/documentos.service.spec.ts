import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { UserRole } from '@prisma/client';
import {
  BusinessRuleException,
  IntegrationException,
  NotFoundException,
} from '@shared/errors/app-exception';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { DocumentosService } from './documentos.service';

// ---------------------------------------------------------------------------
// Mock @supabase/supabase-js — sem chamadas reais ao Supabase Storage
// ---------------------------------------------------------------------------

const { mockUpload, mockCreateSignedUrl, mockRemove, mockListBuckets, mockCreateBucket } =
  vi.hoisted(() => ({
    mockUpload: vi.fn(),
    mockCreateSignedUrl: vi.fn(),
    mockRemove: vi.fn(),
    mockListBuckets: vi.fn(),
    mockCreateBucket: vi.fn(),
  }));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    storage: {
      listBuckets: mockListBuckets,
      createBucket: mockCreateBucket,
      from: vi.fn(() => ({
        upload: mockUpload,
        createSignedUrl: mockCreateSignedUrl,
        remove: mockRemove,
      })),
    },
  })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type MockModel = Record<string, ReturnType<typeof vi.fn>>;

const makePrismaMock = () => ({
  documento: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
  } satisfies MockModel,
});

const makeEnvMock = () => ({
  get: vi.fn((k: string): string => {
    const map: Record<string, string> = {
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    };
    return map[k] ?? '';
  }),
});

const makeClientesMock = () => ({
  findById: vi.fn().mockResolvedValue({ id: 'cli-1', empresaId: 'emp-1', nome: 'Cliente X' }),
});

const fakeUser = (overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  id: 'user-1',
  email: 'user@betinna.ai',
  nome: 'User',
  role: 'ADMIN' as UserRole,
  empresaIds: ['emp-1'],
  empresaIdAtiva: 'emp-1',
  ...overrides,
});

const fakeDoc = (overrides: Record<string, unknown> = {}) => ({
  id: 'doc-1',
  clienteId: 'cli-1',
  nome: 'contrato.pdf',
  tipo: 'pdf',
  url: 'emp-1/cli-1/1234567890_contrato.pdf',
  tamanho: 102400,
  criadoEm: new Date('2026-06-01'),
  atualizadoEm: new Date('2026-06-01'),
  ...overrides,
});

// Magic-numbers por MIME — o service valida o CONTEÚDO, então o buffer fake precisa
// bater com o tipo declarado (senão o upload é recusado).
const MAGIC: Record<string, number[]> = {
  'application/pdf': [0x25, 0x50, 0x44, 0x46],
  'image/png': [0x89, 0x50, 0x4e, 0x47],
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/webp': [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [0x50, 0x4b, 0x03, 0x04],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [
    0x50, 0x4b, 0x03, 0x04,
  ],
  'application/vnd.ms-excel': [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
  'application/msword': [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
};
const bufFor = (mimetype: string): Buffer =>
  MAGIC[mimetype]
    ? Buffer.concat([Buffer.from(MAGIC[mimetype]), Buffer.from(' x')])
    : Buffer.from('texto');

const fakeFile = (
  overrides: Partial<{
    filename: string;
    mimetype: string;
    size: number;
    buffer: Buffer;
  }> = {},
) => {
  const mimetype = overrides.mimetype ?? 'application/pdf';
  return {
    filename: 'contrato.pdf',
    mimetype,
    size: 102400,
    buffer: bufFor(mimetype),
    ...overrides,
  };
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('DocumentosService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let env: ReturnType<typeof makeEnvMock>;
  let clientes: ReturnType<typeof makeClientesMock>;
  let service: DocumentosService;

  beforeEach(async () => {
    // Limpa histórico de chamadas dos mocks hoistados entre testes
    vi.clearAllMocks();
    prisma = makePrismaMock();
    env = makeEnvMock();
    clientes = makeClientesMock();
    mockListBuckets.mockResolvedValue({ data: [{ name: 'cliente-documentos' }] });
    mockUpload.mockResolvedValue({ error: null });
    mockCreateSignedUrl.mockResolvedValue({
      data: { signedUrl: 'https://signed.url/doc' },
      error: null,
    });
    mockRemove.mockResolvedValue({ error: null });
    service = new DocumentosService(prisma as never, env as never, clientes as never);
    await service.onModuleInit();
  });

  // -------------------------------------------------------------------------
  // list
  // -------------------------------------------------------------------------

  describe('list', () => {
    it('lista documentos do cliente', async () => {
      prisma.documento.findMany.mockResolvedValue([fakeDoc()]);

      const result = await service.list(fakeUser(), 'cli-1');

      expect(result).toHaveLength(1);
      expect(clientes.findById).toHaveBeenCalledWith(fakeUser(), 'cli-1');
    });

    it('filtra por clienteId na query', async () => {
      prisma.documento.findMany.mockResolvedValue([]);

      await service.list(fakeUser(), 'cli-1');

      const args = prisma.documento.findMany.mock.calls[0][0];
      expect(args.where.clienteId).toBe('cli-1');
    });

    it('propaga NotFoundException se cliente não existe', async () => {
      clientes.findById.mockRejectedValue(new NotFoundException('Cliente', 'nao-existe'));

      await expect(service.list(fakeUser(), 'nao-existe')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // upload
  // -------------------------------------------------------------------------

  describe('upload', () => {
    it('faz upload e cria metadado no banco', async () => {
      const doc = fakeDoc();
      prisma.documento.create.mockResolvedValue(doc);

      const result = await service.upload(fakeUser(), 'cli-1', fakeFile());

      expect(mockUpload).toHaveBeenCalledOnce();
      expect(prisma.documento.create).toHaveBeenCalledOnce();
      expect(result).toEqual(doc);
    });

    it('salva storagePath (não URL assinada) no banco', async () => {
      prisma.documento.create.mockResolvedValue(fakeDoc());

      await service.upload(
        fakeUser(),
        'cli-1',
        fakeFile({ filename: 'foto.png', mimetype: 'image/png' }),
      );

      const data = prisma.documento.create.mock.calls[0][0].data;
      // url é o storagePath, não uma URL assinada
      expect(data.url).not.toContain('signed');
      expect(data.url).toContain('emp-1/cli-1/');
    });

    it('lança BusinessRuleException para arquivo vazio', async () => {
      await expect(
        service.upload(fakeUser(), 'cli-1', fakeFile({ size: 0, buffer: Buffer.alloc(0) })),
      ).rejects.toBeInstanceOf(BusinessRuleException);
      expect(mockUpload).not.toHaveBeenCalled();
    });

    it('lança BusinessRuleException para arquivo maior que 10MB', async () => {
      await expect(
        service.upload(fakeUser(), 'cli-1', fakeFile({ size: 11 * 1024 * 1024 })),
      ).rejects.toBeInstanceOf(BusinessRuleException);
    });

    it('lança BusinessRuleException para tipo MIME não permitido', async () => {
      await expect(
        service.upload(fakeUser(), 'cli-1', fakeFile({ mimetype: 'application/x-exe' })),
      ).rejects.toBeInstanceOf(BusinessRuleException);
    });

    it('rejeita conteúdo que não bate o MIME declarado (ex: .exe como pdf)', async () => {
      // MZ = executável Windows, declarado como application/pdf
      const exe = Buffer.from([0x4d, 0x5a, 0x90, 0x00]);
      await expect(
        service.upload(fakeUser(), 'cli-1', fakeFile({ mimetype: 'application/pdf', buffer: exe })),
      ).rejects.toBeInstanceOf(BusinessRuleException);
      expect(mockUpload).not.toHaveBeenCalled();
    });

    it('lança IntegrationException quando Supabase retorna erro', async () => {
      mockUpload.mockResolvedValue({ error: { message: 'Storage error' } });

      await expect(service.upload(fakeUser(), 'cli-1', fakeFile())).rejects.toBeInstanceOf(
        IntegrationException,
      );
      expect(prisma.documento.create).not.toHaveBeenCalled();
    });

    it('determina tipo correto para PDF', async () => {
      prisma.documento.create.mockResolvedValue(fakeDoc({ tipo: 'pdf' }));

      await service.upload(
        fakeUser(),
        'cli-1',
        fakeFile({ filename: 'doc.pdf', mimetype: 'application/pdf' }),
      );

      const data = prisma.documento.create.mock.calls[0][0].data;
      expect(data.tipo).toBe('pdf');
    });

    it('determina tipo correto para imagem', async () => {
      prisma.documento.create.mockResolvedValue(fakeDoc({ tipo: 'img' }));

      await service.upload(
        fakeUser(),
        'cli-1',
        fakeFile({ filename: 'foto.jpg', mimetype: 'image/jpeg' }),
      );

      const data = prisma.documento.create.mock.calls[0][0].data;
      expect(data.tipo).toBe('img');
    });

    it('aceita tipos MIME permitidos: xlsx, docx, csv, txt', async () => {
      const mimes = [
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'text/csv',
        'text/plain',
      ];
      for (const mime of mimes) {
        prisma.documento.create.mockResolvedValue(fakeDoc());
        mockUpload.mockResolvedValue({ error: null });

        await expect(
          service.upload(
            fakeUser(),
            'cli-1',
            fakeFile({ mimetype: mime, filename: `file.${mime.split('/')[1]}` }),
          ),
        ).resolves.toBeDefined();
      }
    });
  });

  // -------------------------------------------------------------------------
  // download
  // -------------------------------------------------------------------------

  describe('download', () => {
    it('gera URL assinada e retorna nome do arquivo', async () => {
      prisma.documento.findFirst.mockResolvedValue(fakeDoc({ url: 'emp-1/cli-1/contrato.pdf' }));

      const result = await service.download(fakeUser(), 'cli-1', 'doc-1');

      expect(result.signedUrl).toBe('https://signed.url/doc');
      expect(result.expiresIn).toBe(3600);
      expect(result.nome).toBe('contrato.pdf');
    });

    it('lança NotFoundException quando documento não existe', async () => {
      prisma.documento.findFirst.mockResolvedValue(null);

      await expect(service.download(fakeUser(), 'cli-1', 'nao-existe')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('lança IntegrationException quando Supabase falha ao assinar URL', async () => {
      prisma.documento.findFirst.mockResolvedValue(fakeDoc());
      mockCreateSignedUrl.mockResolvedValue({ data: null, error: { message: 'Storage error' } });

      await expect(service.download(fakeUser(), 'cli-1', 'doc-1')).rejects.toBeInstanceOf(
        IntegrationException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // remove
  // -------------------------------------------------------------------------

  describe('remove', () => {
    it('remove documento do storage e do banco', async () => {
      prisma.documento.findFirst.mockResolvedValue(fakeDoc({ url: 'emp-1/cli-1/contrato.pdf' }));
      prisma.documento.delete.mockResolvedValue(fakeDoc());

      await expect(service.remove(fakeUser(), 'cli-1', 'doc-1')).resolves.toBeUndefined();

      expect(mockRemove).toHaveBeenCalledWith(['emp-1/cli-1/contrato.pdf']);
      expect(prisma.documento.delete).toHaveBeenCalledWith({ where: { id: 'doc-1' } });
    });

    it('lança NotFoundException quando documento não existe', async () => {
      prisma.documento.findFirst.mockResolvedValue(null);

      await expect(service.remove(fakeUser(), 'cli-1', 'nao-existe')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('remove metadado do banco mesmo quando storage falha (best-effort)', async () => {
      prisma.documento.findFirst.mockResolvedValue(fakeDoc());
      prisma.documento.delete.mockResolvedValue(fakeDoc());
      mockRemove.mockResolvedValue({ error: { message: 'Storage error' } });

      // Não deve lançar — continua e remove o metadado
      await expect(service.remove(fakeUser(), 'cli-1', 'doc-1')).resolves.toBeUndefined();

      expect(prisma.documento.delete).toHaveBeenCalledOnce();
    });
  });
});
