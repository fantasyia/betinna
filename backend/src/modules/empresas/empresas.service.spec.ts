import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@shared/errors/app-exception';
import { EmpresasService } from './empresas.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type MockModel = Record<string, ReturnType<typeof vi.fn>>;

const makePrismaMock = () => ({
  empresa: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  } satisfies MockModel,
});

const fakeEmpresa = (overrides: Record<string, unknown> = {}) => ({
  id: 'emp-1',
  nome: 'Empresa Teste',
  cnpj: '00.000.000/0001-00',
  ativo: true,
  criadoEm: new Date('2026-01-01'),
  atualizadoEm: new Date('2026-01-01'),
  _count: { usuarios: 2, clientes: 10 },
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EmpresasService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let service: EmpresasService;

  beforeEach(() => {
    prisma = makePrismaMock();
    service = new EmpresasService(prisma as never);
  });

  // -------------------------------------------------------------------------
  // list
  // -------------------------------------------------------------------------

  describe('list', () => {
    const baseParams = { page: 1, limit: 20 };

    it('retorna lista paginada de empresas', async () => {
      prisma.empresa.count.mockResolvedValue(2);
      prisma.empresa.findMany.mockResolvedValue([fakeEmpresa(), fakeEmpresa({ id: 'emp-2' })]);

      const result = await service.list(baseParams);

      expect(result.pagination.total).toBe(2);
      expect(result.data).toHaveLength(2);
    });

    it('filtra por search em nome e cnpj (OR case-insensitive)', async () => {
      prisma.empresa.count.mockResolvedValue(0);
      prisma.empresa.findMany.mockResolvedValue([]);

      await service.list({ ...baseParams, search: 'teste' });

      const args = prisma.empresa.findMany.mock.calls[0][0];
      expect(args.where.OR).toHaveLength(2);
      expect(args.where.OR[0].nome.contains).toBe('teste');
    });

    it('filtra por ativo=true', async () => {
      prisma.empresa.count.mockResolvedValue(0);
      prisma.empresa.findMany.mockResolvedValue([]);

      await service.list({ ...baseParams, ativo: true });

      const args = prisma.empresa.findMany.mock.calls[0][0];
      expect(args.where.ativo).toBe(true);
    });

    it('filtra por ativo=false (empresas inativas)', async () => {
      prisma.empresa.count.mockResolvedValue(0);
      prisma.empresa.findMany.mockResolvedValue([]);

      await service.list({ ...baseParams, ativo: false });

      const args = prisma.empresa.findMany.mock.calls[0][0];
      expect(args.where.ativo).toBe(false);
    });

    it('sem filtro ativo — não injeta o campo', async () => {
      prisma.empresa.count.mockResolvedValue(0);
      prisma.empresa.findMany.mockResolvedValue([]);

      await service.list(baseParams);

      const args = prisma.empresa.findMany.mock.calls[0][0];
      expect(args.where.ativo).toBeUndefined();
    });

    it('pagina corretamente com skip/take', async () => {
      prisma.empresa.count.mockResolvedValue(100);
      prisma.empresa.findMany.mockResolvedValue([]);

      const result = await service.list({ page: 3, limit: 10 });

      expect(result.pagination.page).toBe(3);
      const args = prisma.empresa.findMany.mock.calls[0][0];
      expect(args.skip).toBe(20);
      expect(args.take).toBe(10);
    });

    it('inclui _count de usuarios e clientes', async () => {
      prisma.empresa.count.mockResolvedValue(0);
      prisma.empresa.findMany.mockResolvedValue([]);

      await service.list(baseParams);

      const args = prisma.empresa.findMany.mock.calls[0][0];
      expect(args.include).toEqual({ _count: { select: { usuarios: true, clientes: true } } });
    });
  });

  // -------------------------------------------------------------------------
  // findById
  // -------------------------------------------------------------------------

  describe('findById', () => {
    it('retorna empresa quando encontrada', async () => {
      const empresa = fakeEmpresa();
      prisma.empresa.findUnique.mockResolvedValue(empresa);

      const result = await service.findById('emp-1');

      expect(result).toEqual(empresa);
    });

    it('lança NotFoundException quando empresa não existe', async () => {
      prisma.empresa.findUnique.mockResolvedValue(null);

      await expect(service.findById('nao-existe')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------

  describe('create', () => {
    it('cria empresa com ativo=true por default', async () => {
      const empresa = fakeEmpresa({ ativo: true });
      prisma.empresa.create.mockResolvedValue(empresa);

      await service.create({ nome: 'Nova Empresa', cnpj: '11.111.111/0001-11' });

      const data = prisma.empresa.create.mock.calls[0][0].data;
      expect(data.ativo).toBe(true);
      expect(data.nome).toBe('Nova Empresa');
    });

    it('retorna empresa criada', async () => {
      const empresa = fakeEmpresa();
      prisma.empresa.create.mockResolvedValue(empresa);

      const result = await service.create({ nome: 'Empresa X' });

      expect(result).toEqual(empresa);
    });
  });

  // -------------------------------------------------------------------------
  // update
  // -------------------------------------------------------------------------

  describe('update', () => {
    it('atualiza empresa existente', async () => {
      const empresa = fakeEmpresa();
      const updated = fakeEmpresa({ nome: 'Nome Atualizado' });
      prisma.empresa.findUnique.mockResolvedValue(empresa);
      prisma.empresa.update.mockResolvedValue(updated);

      const result = await service.update('emp-1', { nome: 'Nome Atualizado' });

      expect(result.nome).toBe('Nome Atualizado');
      expect(prisma.empresa.update).toHaveBeenCalledWith({
        where: { id: 'emp-1' },
        data: { nome: 'Nome Atualizado' },
      });
    });

    it('lança NotFoundException se empresa não existe', async () => {
      prisma.empresa.findUnique.mockResolvedValue(null);

      await expect(service.update('nao-existe', { nome: 'X' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.empresa.update).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // deactivate
  // -------------------------------------------------------------------------

  describe('deactivate', () => {
    it('define ativo=false', async () => {
      const empresa = fakeEmpresa({ ativo: true });
      prisma.empresa.findUnique.mockResolvedValue(empresa);
      prisma.empresa.update.mockResolvedValue({ ...empresa, ativo: false });

      const result = await service.deactivate('emp-1');

      expect(result.ativo).toBe(false);
      expect(prisma.empresa.update).toHaveBeenCalledWith({
        where: { id: 'emp-1' },
        data: { ativo: false },
      });
    });

    it('lança NotFoundException se empresa não existe', async () => {
      prisma.empresa.findUnique.mockResolvedValue(null);

      await expect(service.deactivate('nao-existe')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.empresa.update).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // activate
  // -------------------------------------------------------------------------

  describe('activate', () => {
    it('define ativo=true', async () => {
      const empresa = fakeEmpresa({ ativo: false });
      prisma.empresa.findUnique.mockResolvedValue(empresa);
      prisma.empresa.update.mockResolvedValue({ ...empresa, ativo: true });

      const result = await service.activate('emp-1');

      expect(result.ativo).toBe(true);
      expect(prisma.empresa.update).toHaveBeenCalledWith({
        where: { id: 'emp-1' },
        data: { ativo: true },
      });
    });

    it('lança NotFoundException se empresa não existe', async () => {
      prisma.empresa.findUnique.mockResolvedValue(null);

      await expect(service.activate('nao-existe')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.empresa.update).not.toHaveBeenCalled();
    });
  });
});
