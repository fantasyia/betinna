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
const makeNotificacoes = () => ({
  criarParaRole: vi.fn().mockResolvedValue(0),
  criarParaUsuario: vi.fn().mockResolvedValue(null),
});

function makeService(txProverbCount: number, recusaCount = 1) {
  const tx = {
    proposta: {
      updateMany: vi.fn().mockResolvedValue({ count: txProverbCount }),
      update: vi.fn().mockResolvedValue({}),
    },
    pedido: { create: vi.fn().mockResolvedValue({ id: 'ped-1' }) },
    aprovacaoDesconto: { create: vi.fn().mockResolvedValue({}) },
  };
  const prisma = {
    proposta: {
      findUnique: vi.fn().mockResolvedValue(PROPOSTA),
      updateMany: vi.fn().mockResolvedValue({ count: recusaCount }),
    },
    usuario: { findUnique: vi.fn().mockResolvedValue({ role: 'REP', tetoDesconto: 100 }) },
    empresa: {
      findUnique: vi.fn().mockResolvedValue({ descontoPixPct: 0, descontoBoletoAvistaPct: 0 }),
    },
    $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  };
  const notificacoes = makeNotificacoes();
  // Gate de aprovação: default dentro do teto → RASCUNHO (sem aprovação).
  const pedidoPricing = {
    avaliarAprovacaoProposta: vi.fn().mockReturnValue({
      requerAprovacao: false,
      statusPedido: 'RASCUNHO',
      maxDescontoPercentual: 0,
    }),
  };
  // ClickSign desligado nos testes de aceite: o envio do contrato é best-effort
  // e tem teste próprio. `configurado: false` mantém o caminho antigo intacto.
  const clicksign = { configurado: false, enviarParaAssinatura: vi.fn() };
  // Marco do funil: o aceite move a etapa do lead, e o move é best-effort.
  const etapa = { mover: vi.fn(async () => 'movido' as const) };
  const svc = new PropostaAceiteService(
    prisma as never,
    makeEnv() as never,
    makeSequence() as never,
    notificacoes as never,
    pedidoPricing as never,
    clicksign as never,
    etapa as never,
  );
  mockJwtVerify.mockResolvedValue({ payload: { pid: 'prop-1', eid: 'emp-1' } });
  return { svc, prisma, tx, notificacoes, pedidoPricing, clicksign, etapa };
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

  it('ACEITA dentro do teto → pedido RASCUNHO, sem AprovacaoDesconto', async () => {
    const { svc, tx } = makeService(1);
    await svc.registrarDecisao(TOKEN, 'ACEITA', '203.0.113.9');
    expect(tx.pedido.create.mock.calls[0][0].data.status).toBe('RASCUNHO');
    expect(tx.aprovacaoDesconto.create).not.toHaveBeenCalled();
  });

  it('ACEITA com desconto acima do teto → pedido AGUARDANDO_APROVACAO + AprovacaoDesconto (não burla)', async () => {
    const { svc, tx, pedidoPricing } = makeService(1);
    pedidoPricing.avaliarAprovacaoProposta.mockReturnValue({
      requerAprovacao: true,
      statusPedido: 'AGUARDANDO_APROVACAO',
      maxDescontoPercentual: 40,
    });
    await svc.registrarDecisao(TOKEN, 'ACEITA', '203.0.113.9');
    expect(tx.pedido.create.mock.calls[0][0].data.status).toBe('AGUARDANDO_APROVACAO');
    expect(tx.aprovacaoDesconto.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ representanteId: 'rep-1', status: 'PENDENTE' }),
      }),
    );
  });

  it('ACEITA notifica o REP dono da proposta (não só GERENTE/DIRECTOR)', async () => {
    const { svc, notificacoes } = makeService(1);
    await svc.registrarDecisao(TOKEN, 'ACEITA', '203.0.113.9');
    expect(notificacoes.criarParaUsuario).toHaveBeenCalledWith(
      expect.objectContaining({ usuarioId: 'rep-1', empresaId: 'emp-1' }),
    );
    expect(notificacoes.criarParaRole).toHaveBeenCalled();
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

describe('PropostaAceiteService — cliente BLOQUEADO no ERP não aceita (auditoria média)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('ACEITE de cliente bloqueado é barrado ANTES de criar pedido', async () => {
    // Cenário do achado: cliente vira BLOQUEADO no ERP depois do envio da
    // proposta. O link público já revalidava validade e produto inativo, mas não
    // o erpStatus — o pedido era criado, o rep notificado "aceita!", e a falha
    // só aparecia no envio ao ERP.
    const { svc, prisma, tx } = makeService(1);
    prisma.proposta.findUnique.mockResolvedValue({
      ...PROPOSTA,
      cliente: { erpStatus: 'BLOQUEADO' },
    });

    await expect(svc.registrarDecisao(TOKEN, 'ACEITA', '203.0.113.9')).rejects.toThrow(
      /não é possível aceitar/i,
    );
    expect(tx.pedido.create).not.toHaveBeenCalled();
  });

  it('RECUSAR proposta de cliente bloqueado continua permitido', async () => {
    const { svc, prisma } = makeService(1);
    prisma.proposta.findUnique.mockResolvedValue({
      ...PROPOSTA,
      cliente: { erpStatus: 'BLOQUEADO' },
    });

    const r = await svc.registrarDecisao(TOKEN, 'RECUSADA', '203.0.113.9');
    expect(r.status).toBe('RECUSADA');
  });

  it('cliente ATIVO segue aceitando normalmente', async () => {
    const { svc, prisma, tx } = makeService(1);
    prisma.proposta.findUnique.mockResolvedValue({
      ...PROPOSTA,
      cliente: { erpStatus: 'ATIVO' },
    });

    const r = await svc.registrarDecisao(TOKEN, 'ACEITA', '203.0.113.9');
    expect(r.status).toBe('ACEITA');
    expect(tx.pedido.create).toHaveBeenCalled();
  });

  describe('base do link de aceite', () => {
    // O link sai da empresa: link errado aqui não quebra nada do nosso lado —
    // o rep envia, o cliente clica, não abre, e a gente descobre pelo cliente.
    const montar = (envs: Record<string, string>, producao = true) =>
      new PropostaAceiteService(
        {} as never,
        { get: (k: string) => envs[k] ?? '', isProduction: producao } as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      ) as unknown as { frontendUrl: () => string };

    it('usa FRONTEND_URL quando existe', () => {
      const svc = montar({ FRONTEND_URL: 'https://app.somatecblocking.com.br/' });

      expect(svc.frontendUrl()).toBe('https://app.somatecblocking.com.br');
    });

    it('limpa o nome da variável colado no valor (o paste que aconteceu em produção)', () => {
      const svc = montar({
        CORS_ORIGINS: 'CORS_ORIGINS=https://app.exemplo.com,https://outro.com',
      });

      expect(svc.frontendUrl()).toBe('https://app.exemplo.com');
    });

    it('em produção, ESTOURA em vez de gerar link pra localhost', () => {
      const svc = montar({ CORS_ORIGINS: 'http://localhost:5173' });

      expect(() => svc.frontendUrl()).toThrow(/FRONTEND_URL/);
    });

    it('em produção, ESTOURA quando não há base nenhuma', () => {
      const svc = montar({});

      expect(() => svc.frontendUrl()).toThrow(/FRONTEND_URL/);
    });

    it('fora de produção, localhost segue valendo', () => {
      const svc = montar({ CORS_ORIGINS: 'http://localhost:5173' }, false);

      expect(svc.frontendUrl()).toBe('http://localhost:5173');
    });
  });
});
