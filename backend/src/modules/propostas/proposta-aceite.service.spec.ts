import { describe, expect, it, vi, beforeEach } from 'vitest';
import { BusinessRuleException } from '@shared/errors/app-exception';
import { PropostaAceiteService } from './proposta-aceite.service';

// jose mockado — sem JWT real; validarToken devolve o payload fixo.
const { mockJwtVerify } = vi.hoisted(() => ({ mockJwtVerify: vi.fn() }));
vi.mock('jose', () => ({
  SignJWT: class {
    setProtectedHeader() {
      return this;
    }
    setIssuedAt() {
      return this;
    }
    setExpirationTime() {
      return this;
    }
    sign() {
      return Promise.resolve('jwt');
    }
  },
  jwtVerify: mockJwtVerify,
}));

const TOKEN = 'tok-123';
const PROPOSTA = {
  id: 'prop-1',
  numero: 'PROP-0001',
  status: 'AGUARDANDO_ASSINATURA',
  aceiteToken: TOKEN,
  clienteId: 'cli-1',
  representanteId: 'rep-1',
  formaPagamento: 'PIX',
  condicaoPagamento: 'avista',
  prazoEntrega: null,
  subtotal: 100,
  descontoGeral: 0,
  valor: 100,
  comissaoEstimada: 5,
  observacoes: null,
  itens: [],
};

const makeEnv = () => ({ get: vi.fn(() => 'k'.repeat(64)) });
const makeSequence = () => ({ next: vi.fn().mockResolvedValue(7) });
const makeNotificacoes = () => ({ criarParaRole: vi.fn().mockResolvedValue(0) });

function makeService(txProverbCount: number, recusaCount = 1) {
  const tx = {
    proposta: {
      updateMany: vi.fn().mockResolvedValue({ count: txProverbCount }),
      update: vi.fn().mockResolvedValue({}),
    },
    pedido: { create: vi.fn().mockResolvedValue({ id: 'ped-1' }) },
  };
  const prisma = {
    proposta: {
      findUnique: vi.fn().mockResolvedValue(PROPOSTA),
      updateMany: vi.fn().mockResolvedValue({ count: recusaCount }),
    },
    $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  };
  const svc = new PropostaAceiteService(
    prisma as never,
    makeEnv() as never,
    makeSequence() as never,
    makeNotificacoes() as never,
  );
  mockJwtVerify.mockResolvedValue({ payload: { pid: 'prop-1', eid: 'emp-1' } });
  return { svc, prisma, tx };
}

describe('PropostaAceiteService.registrarDecisao — CAS anti duplo-pedido', () => {
  beforeEach(() => vi.clearAllMocks());

  it('ACEITA vencedora (CAS count=1) cria 1 pedido e retorna número', async () => {
    const { svc, tx } = makeService(1);
    const r = await svc.registrarDecisao(TOKEN, 'ACEITA', '203.0.113.9');
    expect(r.status).toBe('ACEITA');
    expect(r.pedidoNumero).toBe('PED-0007');
    expect(tx.pedido.create).toHaveBeenCalledTimes(1);
  });

  it('ACEITA perdedora da corrida (CAS count=0) NÃO cria pedido', async () => {
    const { svc, tx } = makeService(0); // outro request já reivindicou o token
    await expect(svc.registrarDecisao(TOKEN, 'ACEITA', '203.0.113.9')).rejects.toBeInstanceOf(
      BusinessRuleException,
    );
    expect(tx.pedido.create).not.toHaveBeenCalled();
  });

  it('RECUSADA perdedora (CAS count=0) é rejeitada', async () => {
    const { svc } = makeService(1, 0); // updateMany de recusa não casou nenhuma linha
    await expect(svc.registrarDecisao(TOKEN, 'RECUSADA', undefined)).rejects.toBeInstanceOf(
      BusinessRuleException,
    );
  });
});
