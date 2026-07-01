import { describe, expect, it, vi, beforeEach } from 'vitest';
import { OmieClientesService } from './omie-clientes.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type MockModel = Record<string, ReturnType<typeof vi.fn>>;

const makePrismaMock = () => ({
  cliente: {
    findUnique: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: 'cli-1' }),
    update: vi.fn().mockResolvedValue({}),
  } satisfies MockModel,
  integracaoConexao: {
    findUnique: vi.fn().mockResolvedValue(null),
  } satisfies MockModel,
});

const makeOmieClientMock = () => ({
  listarClientes: vi.fn(),
});

const makeIntegracoesMock = () => ({
  registrarSyncOk: vi.fn().mockResolvedValue({}),
});

// Stub do OmieMapper — retorna payloads simples e controláveis
vi.mock('./omie.mapper', () => ({
  OmieMapper: {
    clienteToPrismaUpsert: vi.fn((_empresaId: string, o: { codigo_cliente_omie?: number }) => {
      if (!o.codigo_cliente_omie) return null;
      const codigoOmie = String(o.codigo_cliente_omie);
      return {
        where: { empresaId_codigoOmie: { empresaId: _empresaId, codigoOmie } },
        create: { empresaId: _empresaId, codigoOmie, nome: 'Cliente' },
        update: { nome: 'Cliente' },
      };
    }),
    omieDateTimeToDate: vi.fn((_dAlt: string, _hAlt: string) => {
      return new Date(_dAlt ?? '2026-01-01');
    }),
  },
}));

const fakeClienteOmie = (codigo: number, dataAlteracao = '2026-02-01') => ({
  codigo_cliente_omie: codigo,
  data_alteracao: dataAlteracao,
  hora_alteracao: '10:00:00',
  info: undefined,
});

const fakeListarClientesResponse = (
  clientes: ReturnType<typeof fakeClienteOmie>[],
  totalPaginas = 1,
) => ({
  clientes_cadastro: clientes,
  total_de_paginas: totalPaginas,
  total_de_registros: clientes.length,
  pagina: 1,
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('OmieClientesService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let omie: ReturnType<typeof makeOmieClientMock>;
  let integracoes: ReturnType<typeof makeIntegracoesMock>;
  let service: OmieClientesService;

  beforeEach(() => {
    prisma = makePrismaMock();
    omie = makeOmieClientMock();
    integracoes = makeIntegracoesMock();
    service = new OmieClientesService(prisma as never, omie as never, integracoes as never);
  });

  // -------------------------------------------------------------------------
  // sync — modo completo
  // -------------------------------------------------------------------------

  describe('sync (modo completo)', () => {
    it('retorna resultado com inseridos/atualizados/ignorados', async () => {
      omie.listarClientes.mockResolvedValue(
        fakeListarClientesResponse([fakeClienteOmie(1), fakeClienteOmie(2)]),
      );

      const result = await service.sync('emp-1', { modo: 'completo' });

      expect(result.modo).toBe('completo');
      expect(result.inseridos + result.atualizados).toBe(2);
      expect(result.totalProcessados).toBe(2);
    });

    it('não busca ultimoSync quando modo=completo', async () => {
      omie.listarClientes.mockResolvedValue(fakeListarClientesResponse([]));

      await service.sync('emp-1', { modo: 'completo' });

      expect(prisma.integracaoConexao.findUnique).not.toHaveBeenCalled();
    });

    it('atualiza cliente quando já existe (findUnique retorna registro)', async () => {
      omie.listarClientes.mockResolvedValue(fakeListarClientesResponse([fakeClienteOmie(1)]));
      prisma.cliente.findUnique.mockResolvedValue({ id: 'cli-existente' });

      const result = await service.sync('emp-1', { modo: 'completo' });

      expect(result.atualizados).toBe(1);
      expect(result.inseridos).toBe(0);
      expect(prisma.cliente.update).toHaveBeenCalledOnce();
    });

    it('insere cliente quando não existe', async () => {
      omie.listarClientes.mockResolvedValue(fakeListarClientesResponse([fakeClienteOmie(1)]));
      prisma.cliente.findUnique.mockResolvedValue(null);

      const result = await service.sync('emp-1', { modo: 'completo' });

      expect(result.inseridos).toBe(1);
      expect(result.atualizados).toBe(0);
      expect(prisma.cliente.create).toHaveBeenCalledOnce();
    });

    it('registra sync OK ao finalizar', async () => {
      omie.listarClientes.mockResolvedValue(fakeListarClientesResponse([]));

      await service.sync('emp-1', { modo: 'completo' });

      // High-water-mark = INÍCIO do sync (3º arg Date), não o fim.
      expect(integracoes.registrarSyncOk).toHaveBeenCalledWith('emp-1', 'omie', expect.any(Date));
    });

    it('carimba o INÍCIO do sync mesmo que o tempo avance durante o fetch', async () => {
      vi.useFakeTimers();
      try {
        const t0 = new Date('2026-06-01T10:00:00.000Z');
        vi.setSystemTime(t0);
        // Simula processamento longo: o "relógio" avança 5min durante o fetch.
        omie.listarClientes.mockImplementation(() => {
          vi.setSystemTime(new Date('2026-06-01T10:05:00.000Z'));
          return Promise.resolve(fakeListarClientesResponse([]));
        });

        await service.sync('emp-1', { modo: 'completo' });

        const stamp = integracoes.registrarSyncOk.mock.calls[0][2] as Date;
        // Deve ser o início (10:00), NÃO o fim (10:05) — senão perderia alterações do intervalo.
        expect(stamp.toISOString()).toBe(t0.toISOString());
      } finally {
        vi.useRealTimers();
      }
    });

    it('itera múltiplas páginas', async () => {
      omie.listarClientes
        .mockResolvedValueOnce(fakeListarClientesResponse([fakeClienteOmie(1)], 2))
        .mockResolvedValueOnce(fakeListarClientesResponse([fakeClienteOmie(2)], 2));

      const result = await service.sync('emp-1', { modo: 'completo' });

      expect(omie.listarClientes).toHaveBeenCalledTimes(2);
      expect(result.totalProcessados).toBe(2);
      expect(result.paginas).toBe(2);
    });

    it('pula cliente quando mapper retorna null (dados inválidos)', async () => {
      // codigo_cliente_omie = 0 → mapper retorna null no stub
      omie.listarClientes.mockResolvedValue(fakeListarClientesResponse([fakeClienteOmie(0)]));

      const result = await service.sync('emp-1', { modo: 'completo' });

      expect(result.totalProcessados).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // sync — modo incremental
  // -------------------------------------------------------------------------

  describe('sync (modo incremental)', () => {
    it('usa modo incremental por padrão', async () => {
      prisma.integracaoConexao.findUnique.mockResolvedValue({ ultimoSync: new Date('2026-01-15') });
      omie.listarClientes.mockResolvedValue(fakeListarClientesResponse([]));

      const result = await service.sync('emp-1');

      expect(result.modo).toBe('incremental');
    });

    it('ignora clientes com data_alteracao <= ultimoSync', async () => {
      const { OmieMapper } = await import('./omie.mapper');
      const ultimoSync = new Date('2026-01-15');
      prisma.integracaoConexao.findUnique.mockResolvedValue({ ultimoSync });
      // Simula data_alteracao anterior ao sync
      vi.mocked(OmieMapper.omieDateTimeToDate).mockReturnValueOnce(new Date('2026-01-10'));

      omie.listarClientes.mockResolvedValue(
        fakeListarClientesResponse([fakeClienteOmie(1, '2026-01-10')]),
      );

      const result = await service.sync('emp-1', { modo: 'incremental' });

      expect(result.ignorados).toBe(1);
      expect(result.totalProcessados).toBe(0);
    });

    it('processa clientes com data_alteracao > ultimoSync', async () => {
      const { OmieMapper } = await import('./omie.mapper');
      const ultimoSync = new Date('2026-01-15');
      prisma.integracaoConexao.findUnique.mockResolvedValue({ ultimoSync });
      vi.mocked(OmieMapper.omieDateTimeToDate).mockReturnValueOnce(new Date('2026-01-20'));

      omie.listarClientes.mockResolvedValue(
        fakeListarClientesResponse([fakeClienteOmie(1, '2026-01-20')]),
      );

      const result = await service.sync('emp-1', { modo: 'incremental' });

      expect(result.ignorados).toBe(0);
      expect(result.totalProcessados).toBe(1);
    });

    it('processa todos quando ultimoSync é null (primeiro sync)', async () => {
      prisma.integracaoConexao.findUnique.mockResolvedValue(null);
      omie.listarClientes.mockResolvedValue(
        fakeListarClientesResponse([fakeClienteOmie(1), fakeClienteOmie(2)]),
      );

      const result = await service.sync('emp-1', { modo: 'incremental' });

      // Sem ultimoSync, nenhum filtro incremental → processa todos
      expect(result.totalProcessados).toBe(2);
      expect(result.ignorados).toBe(0);
    });
  });
});
