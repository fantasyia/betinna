import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AuditService } from './audit.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makePrismaMock = () => ({
  auditLog: {
    create: vi.fn().mockResolvedValue({ id: 'log-1' }),
  },
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('AuditService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let service: AuditService;

  beforeEach(() => {
    prisma = makePrismaMock();
    service = new AuditService(prisma as never);
  });

  // -------------------------------------------------------------------------
  // log (fire-and-forget)
  // -------------------------------------------------------------------------

  describe('log', () => {
    it('chama prisma.auditLog.create com os dados corretos', async () => {
      service.log({
        usuarioId: 'user-1',
        empresaId: 'emp-1',
        acao: 'CREATE',
        recurso: 'pedido',
        recursoId: 'ped-1',
        ip: '127.0.0.1',
      });

      // log é fire-and-forget — precisamos de um tick para a Promise ser agendada
      await new Promise((r) => setTimeout(r, 0));

      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            usuarioId: 'user-1',
            empresaId: 'emp-1',
            acao: 'CREATE',
            recurso: 'pedido',
            recursoId: 'ped-1',
            ip: '127.0.0.1',
          }),
        }),
      );
    });

    it('usa null quando campos opcionais não são informados', async () => {
      service.log({ acao: 'LIST', recurso: 'clientes' });

      await new Promise((r) => setTimeout(r, 0));

      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            usuarioId: null,
            empresaId: null,
            recursoId: null,
            ip: null,
          }),
        }),
      );
    });

    it('não lança quando prisma.create falha (fire-and-forget)', () => {
      prisma.auditLog.create.mockRejectedValue(new Error('DB error'));

      // log() é síncrono (void), não deve lançar
      expect(() => service.log({ acao: 'DELETE', recurso: 'usuario' })).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // logSync (await)
  // -------------------------------------------------------------------------

  describe('logSync', () => {
    it('resolve sem lançar em caso de sucesso', async () => {
      await expect(
        service.logSync({ acao: 'UPDATE', recurso: 'cliente', recursoId: 'cli-1' }),
      ).resolves.toBeUndefined();

      expect(prisma.auditLog.create).toHaveBeenCalledOnce();
    });

    it('não lança quando prisma.create falha (swallows error)', async () => {
      prisma.auditLog.create.mockRejectedValue(new Error('DB timeout'));

      await expect(
        service.logSync({ acao: 'SYNC', recurso: 'omie' }),
      ).resolves.toBeUndefined();
    });
  });
});
