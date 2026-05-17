import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserRole } from '@prisma/client';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { BusinessRuleException, NotFoundException } from '@shared/errors/app-exception';
import { PedidoPricingService } from './pedido-pricing.service';
import { PedidosService } from './pedidos.service';

/** Mock leve de PrismaService */
const makePrismaMock = () => {
  const tx = {
    pedido: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    cliente: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    produto: {
      findMany: vi.fn(),
    },
    aprovacaoDesconto: {
      create: vi.fn(),
    },
    usuario: {
      findUnique: vi.fn(),
    },
  };
  return {
    ...tx,
    $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  };
};

const fakeUser = (overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  id: 'rep-1',
  email: 'rep@betinna.ai',
  nome: 'Rep Teste',
  role: 'REP' as UserRole,
  empresaIds: ['emp-1'],
  empresaIdAtiva: 'emp-1',
  ...overrides,
});

describe('PedidosService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let pricingService: { priceForClientBatch: ReturnType<typeof vi.fn> };
  let svc: PedidosService;

  beforeEach(() => {
    prisma = makePrismaMock();
    pricingService = {
      priceForClientBatch: vi.fn(async () => new Map()),
    };
    const omiePedidosMock = {
      enviarPedido: vi.fn(async (id: string) => ({
        pedidoId: id,
        numeroOmie: 'OMIE-FAKE',
        codigoStatusOmie: '60',
        descricaoStatusOmie: 'INCLUIDO',
      })),
    };
    const repScopeMock = {
      getRepIds: vi.fn(async (u: { role: string; id: string }) => {
        if (u.role === 'REP') return [u.id];
        if (u.role === 'GERENTE') return [];
        return null;
      }),
    };
    const sequenceMock = {
      next: vi.fn(async () => 1),
      peek: vi.fn(async () => 0),
      seedFromDb: vi.fn(async () => undefined),
    };
    svc = new PedidosService(
      prisma as never,
      pricingService as never,
      new PedidoPricingService(),
      omiePedidosMock as never,
      repScopeMock as never,
      { disparar: vi.fn() } as never,
      sequenceMock as never,
      {
        creditarPedidoAprovado: vi.fn().mockResolvedValue(null),
        estornarPedidoCancelado: vi.fn().mockResolvedValue(null),
      } as never,
      {
        criarParaUsuario: vi.fn().mockResolvedValue(null),
        criarParaRole: vi.fn().mockResolvedValue(0),
      } as never,
      {
        pedidosCriados: { inc: vi.fn() },
        omiePush: { inc: vi.fn() },
        notificacoesEnviadas: { inc: vi.fn() },
      } as never,
    );
  });

  it('bloqueia criação se cliente bloqueado no OMIE', async () => {
    prisma.cliente.findFirst.mockResolvedValue({
      id: 'cli-1',
      empresaId: 'emp-1',
      nome: 'X',
      omieStatus: 'BLOQUEADO',
      representanteId: 'rep-1',
    });
    await expect(
      svc.create(fakeUser(), {
        clienteId: 'cli-1',
        itens: [{ produtoId: 'p1', quantidade: 1, desconto: 0 }],
        formaPagamento: 'BOLETO',
        condicaoPagamento: '30dias',
        descontoGeral: 0,
      }),
    ).rejects.toBeInstanceOf(BusinessRuleException);
  });

  it('bloqueia REP de criar pedido para cliente que não é da sua carteira', async () => {
    prisma.cliente.findFirst.mockResolvedValue({
      id: 'cli-1',
      empresaId: 'emp-1',
      nome: 'X',
      omieStatus: 'ATIVO',
      representanteId: 'outro-rep',
    });
    await expect(
      svc.create(fakeUser(), {
        clienteId: 'cli-1',
        itens: [{ produtoId: 'p1', quantidade: 1, desconto: 0 }],
        formaPagamento: 'BOLETO',
        condicaoPagamento: '30dias',
        descontoGeral: 0,
      }),
    ).rejects.toThrow();
  });

  it('exige motivoDesconto quando desconto excede teto do rep', async () => {
    prisma.cliente.findFirst.mockResolvedValue({
      id: 'cli-1',
      empresaId: 'emp-1',
      nome: 'X',
      omieStatus: 'ATIVO',
      representanteId: 'rep-1',
    });
    prisma.produto.findMany.mockResolvedValue([
      { id: 'p1', nome: 'Prod', ativo: true, precoTabela: 100 },
    ]);
    prisma.usuario.findUnique.mockResolvedValue({ tetoDesconto: 5 }); // teto 5%

    await expect(
      svc.create(fakeUser(), {
        clienteId: 'cli-1',
        itens: [{ produtoId: 'p1', quantidade: 1, desconto: 20 }], // > teto
        formaPagamento: 'BOLETO',
        condicaoPagamento: '30dias',
        descontoGeral: 0,
        // motivoDesconto ausente!
      }),
    ).rejects.toBeInstanceOf(BusinessRuleException);
  });

  it('cria pedido em AGUARDANDO_APROVACAO + cria solicitação automática', async () => {
    prisma.cliente.findFirst.mockResolvedValue({
      id: 'cli-1',
      empresaId: 'emp-1',
      nome: 'X',
      omieStatus: 'ATIVO',
      representanteId: 'rep-1',
    });
    prisma.produto.findMany.mockResolvedValue([
      { id: 'p1', nome: 'Prod', ativo: true, precoTabela: 100 },
    ]);
    prisma.usuario.findUnique.mockResolvedValue({ tetoDesconto: 5 });
    prisma.pedido.count.mockResolvedValue(0);
    prisma.pedido.create.mockResolvedValue({
      id: 'ped-1',
      numero: 'PED-0001',
      status: 'AGUARDANDO_APROVACAO',
    });
    prisma.pedido.findUnique.mockResolvedValue({
      id: 'ped-1',
      numero: 'PED-0001',
      status: 'AGUARDANDO_APROVACAO',
    });

    await svc.create(fakeUser(), {
      clienteId: 'cli-1',
      itens: [{ produtoId: 'p1', quantidade: 1, desconto: 20 }],
      formaPagamento: 'BOLETO',
      condicaoPagamento: '30dias',
      descontoGeral: 0,
      motivoDesconto: 'Cliente VIP, fechando pedido recorrente',
    });

    // pedido criado com status AGUARDANDO_APROVACAO
    const pedidoCreateArgs = prisma.pedido.create.mock.calls[0][0];
    expect(pedidoCreateArgs.data.status).toBe('AGUARDANDO_APROVACAO');
    // aprovação criada
    expect(prisma.aprovacaoDesconto.create).toHaveBeenCalled();
    const aprArgs = prisma.aprovacaoDesconto.create.mock.calls[0][0];
    expect(aprArgs.data.status).toBe('PENDENTE');
    expect(aprArgs.data.descontoSolicitado).toBe(20);
  });

  it('cria pedido em RASCUNHO sem aprovação quando desconto dentro do teto', async () => {
    prisma.cliente.findFirst.mockResolvedValue({
      id: 'cli-1',
      empresaId: 'emp-1',
      nome: 'X',
      omieStatus: 'ATIVO',
      representanteId: 'rep-1',
    });
    prisma.produto.findMany.mockResolvedValue([
      { id: 'p1', nome: 'Prod', ativo: true, precoTabela: 100 },
    ]);
    prisma.usuario.findUnique.mockResolvedValue({ tetoDesconto: 10 });
    prisma.pedido.count.mockResolvedValue(5);
    prisma.pedido.create.mockResolvedValue({ id: 'ped-2', numero: 'PED-0006', status: 'RASCUNHO' });
    prisma.pedido.findUnique.mockResolvedValue({
      id: 'ped-2',
      numero: 'PED-0006',
      status: 'RASCUNHO',
    });

    await svc.create(fakeUser(), {
      clienteId: 'cli-1',
      itens: [{ produtoId: 'p1', quantidade: 5, desconto: 5 }], // dentro do teto
      formaPagamento: 'BOLETO',
      condicaoPagamento: '30dias',
      descontoGeral: 0,
    });

    const args = prisma.pedido.create.mock.calls[0][0];
    expect(args.data.status).toBe('RASCUNHO');
    expect(prisma.aprovacaoDesconto.create).not.toHaveBeenCalled();
  });

  it('bloqueia envio ao OMIE se pedido está AGUARDANDO_APROVACAO sem aprovação aprovada', async () => {
    prisma.pedido.findFirst.mockResolvedValue({
      id: 'ped-1',
      empresaId: 'emp-1',
      representanteId: 'rep-1',
      clienteId: 'cli-1',
      status: 'AGUARDANDO_APROVACAO',
      aprovacaoDesconto: { status: 'PENDENTE' },
    });
    await expect(svc.enviarParaOmie(fakeUser(), 'ped-1')).rejects.toBeInstanceOf(
      BusinessRuleException,
    );
  });

  it('bloqueia envio ao OMIE se cliente foi bloqueado depois da criação', async () => {
    prisma.pedido.findFirst.mockResolvedValue({
      id: 'ped-1',
      empresaId: 'emp-1',
      representanteId: 'rep-1',
      clienteId: 'cli-1',
      status: 'RASCUNHO',
      aprovacaoDesconto: null,
    });
    prisma.cliente.findFirst.mockResolvedValue({ omieStatus: 'BLOQUEADO' });

    await expect(svc.enviarParaOmie(fakeUser(), 'ped-1')).rejects.toBeInstanceOf(
      BusinessRuleException,
    );
  });

  it('envia ao OMIE com sucesso quando status válido', async () => {
    prisma.pedido.findFirst.mockResolvedValue({
      id: 'ped-1',
      empresaId: 'emp-1',
      representanteId: 'rep-1',
      clienteId: 'cli-1',
      status: 'RASCUNHO',
      aprovacaoDesconto: null,
    });
    // Sprint 1 ALTA fix: cliente lookup agora usa findFirst({id, empresaId})
    prisma.cliente.findFirst.mockResolvedValue({ omieStatus: 'ATIVO' });
    // findByIdInternal (chamado depois do push) — OmiePedidosService está mockado,
    // então simulamos o estado pós-envio direto aqui
    prisma.pedido.findUnique.mockResolvedValue({
      id: 'ped-1',
      status: 'ENVIADO_OMIE',
      numeroOmie: 'OMIE-FAKE',
      enviadoOmieEm: new Date(),
    });

    const r = await svc.enviarParaOmie(fakeUser(), 'ped-1');
    expect(r.status).toBe('ENVIADO_OMIE');
    expect(r.numeroOmie).toBeTruthy();
  });

  it('lança NotFound quando pedido não existe ou não pertence à empresa do user', async () => {
    prisma.pedido.findFirst.mockResolvedValue(null);
    await expect(svc.findById(fakeUser(), 'inexistente')).rejects.toBeInstanceOf(NotFoundException);
  });
});
