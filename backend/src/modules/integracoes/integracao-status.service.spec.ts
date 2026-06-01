import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IntegracaoStatusService } from './integracao-status.service';

/**
 * Testa a lógica do semáforo: transições de status, threshold de CAÍDA,
 * desconexão imediata e o throttle do e-mail de alerta.
 */

// Mock de prisma com estado em memória pra simular o registro atual.
function makePrismaMock() {
  const store: { row: Record<string, unknown> | null } = { row: null };
  return {
    store,
    integracaoStatus: {
      findUnique: vi.fn(async () => store.row),
      upsert: vi.fn(
        async ({
          update,
          create,
        }: {
          update: Record<string, unknown>;
          create: Record<string, unknown>;
        }) => {
          store.row = store.row ? { ...store.row, ...update } : { ...create };
          return store.row;
        },
      ),
    },
    empresa: { findUnique: vi.fn(async () => ({ nome: 'Empresa Teste' })) },
    usuario: { findFirst: vi.fn(async () => ({ email: 'diretor@empresa.com' })) },
  };
}

function makeEmailMock() {
  return { enviarAlertaSistema: vi.fn(async () => ({ ok: true })) };
}

const envMock = { get: vi.fn(() => '') };

function build() {
  const prisma = makePrismaMock();
  const email = makeEmailMock();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new IntegracaoStatusService(prisma as any, email as any, envMock as any);
  return { service, prisma, email };
}

describe('IntegracaoStatusService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('1 erro → DEGRADADA, sem e-mail', async () => {
    const { service, prisma, email } = build();
    await service.registrarErro('emp-1', 'omie', 'timeout');
    expect(prisma.store.row?.status).toBe('DEGRADADA');
    expect(email.enviarAlertaSistema).not.toHaveBeenCalled();
  });

  it('3 erros seguidos → CAÍDA + 1 e-mail de alerta', async () => {
    const { service, prisma, email } = build();
    await service.registrarErro('emp-1', 'omie', 'erro 1');
    await service.registrarErro('emp-1', 'omie', 'erro 2');
    await service.registrarErro('emp-1', 'omie', 'erro 3');
    expect(prisma.store.row?.status).toBe('CAIDA');
    expect(prisma.store.row?.errosSeguidos).toBe(3);
    expect(email.enviarAlertaSistema).toHaveBeenCalledTimes(1);
  });

  it('desconectado → DESCONECTADA imediato + e-mail', async () => {
    const { service, prisma, email } = build();
    await service.marcarDesconectado('emp-1', 'whatsapp', 'deslogado');
    expect(prisma.store.row?.status).toBe('DESCONECTADA');
    expect(email.enviarAlertaSistema).toHaveBeenCalledTimes(1);
  });

  it('throttle: 2ª queda dentro de 1h não reenvia e-mail', async () => {
    const { service, email } = build();
    await service.marcarDesconectado('emp-1', 'whatsapp', 'deslogou'); // envia
    await service.marcarDesconectado('emp-1', 'whatsapp', 'deslogou de novo'); // throttle
    expect(email.enviarAlertaSistema).toHaveBeenCalledTimes(1);
  });

  it('sucesso → volta pra ATIVA e zera contador', async () => {
    const { service, prisma } = build();
    await service.registrarErro('emp-1', 'omie', 'erro');
    await service.registrarSucesso('emp-1', 'omie');
    expect(prisma.store.row?.status).toBe('ATIVA');
    expect(prisma.store.row?.errosSeguidos).toBe(0);
  });
});
