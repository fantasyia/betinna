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
      upsert: vi.fn(),
    },
    usuario: {
      findUnique: vi.fn(),
    },
    empresa: {
      // B1 — resolveDescontoAVista lê config da empresa. Default desligado (0).
      // empresa.findUnique é chamado com dois `select` distintos (config | descontos),
      // então o default cobre as duas formas pra não estreitar o tipo do mock.
      findUnique: vi.fn(
        async (): Promise<
          { descontoPixPct: number; descontoBoletoAvistaPct: number } | { config: unknown }
        > => ({ descontoPixPct: 0, descontoBoletoAvistaPct: 0 }),
      ),
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
      // R1 (lote 3): Fidelidade removida do PedidosService — mock excluído.
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

  it('precoUnitarioOverride abaixo do preço base conta como desconto e NÃO burla o teto', async () => {
    // SEGURANÇA: override = 10 sobre tabela 100 é 90% de desconto disfarçado. Com desconto:0 e
    // sem motivoDesconto, antes passava direto (maxItemDescPct só via i.desconto). Agora o override
    // vira desconto efetivo → excede o teto → exige aprovação/motivo → bloqueia.
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

    await expect(
      svc.create(fakeUser(), {
        clienteId: 'cli-1',
        itens: [{ produtoId: 'p1', quantidade: 1, desconto: 0, precoUnitarioOverride: 10 }],
        formaPagamento: 'BOLETO',
        condicaoPagamento: '30dias',
        descontoGeral: 0,
        // motivoDesconto ausente — deve bloquear pois o override implica 90% de desconto
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

  it('update que leva desconto acima do teto → AGUARDANDO_APROVACAO + upsert da aprovação (anti-bypass)', async () => {
    // Pedido RASCUNHO existente (1 item, sem desconto) — dentro do teto hoje.
    prisma.pedido.findFirst.mockResolvedValue({
      id: 'ped-1',
      numero: 'PED-0001',
      empresaId: 'emp-1',
      status: 'RASCUNHO',
      representanteId: 'rep-1',
      clienteId: 'cli-1',
      descontoGeral: 0,
      motivoDesconto: null,
      itens: [
        {
          produtoId: 'p1',
          quantidade: 1,
          precoUnitario: 100,
          desconto: 0,
          total: 100,
          negociado: false,
        },
      ],
    });
    prisma.usuario.findUnique.mockResolvedValue({ tetoDesconto: 5 }); // teto 5%
    prisma.pedido.findUnique.mockResolvedValue({ id: 'ped-1', status: 'AGUARDANDO_APROVACAO' });

    // Edita pra 40% de desconto geral (acima do teto) com motivo.
    await svc.update(fakeUser(), 'ped-1', {
      descontoGeral: 40,
      motivoDesconto: 'Cliente fechando volume grande',
    });

    // Status FOI pra AGUARDANDO_APROVACAO (antes ficava RASCUNHO = bypass).
    const updArgs = prisma.pedido.update.mock.calls[0][0];
    expect(updArgs.data.status).toBe('AGUARDANDO_APROVACAO');
    // E criou/atualizou a solicitação de aprovação.
    expect(prisma.aprovacaoDesconto.upsert).toHaveBeenCalled();
    const aprArgs = prisma.aprovacaoDesconto.upsert.mock.calls[0][0];
    expect(aprArgs.where).toEqual({ pedidoId: 'ped-1' });
    expect(aprArgs.create.status).toBe('PENDENTE');
  });

  it('update dentro do teto NÃO força aprovação nem mexe no status', async () => {
    prisma.pedido.findFirst.mockResolvedValue({
      id: 'ped-2',
      numero: 'PED-0002',
      empresaId: 'emp-1',
      status: 'RASCUNHO',
      representanteId: 'rep-1',
      clienteId: 'cli-1',
      descontoGeral: 0,
      motivoDesconto: null,
      itens: [
        {
          produtoId: 'p1',
          quantidade: 1,
          precoUnitario: 100,
          desconto: 0,
          total: 100,
          negociado: false,
        },
      ],
    });
    prisma.usuario.findUnique.mockResolvedValue({ tetoDesconto: 10 });
    prisma.pedido.findUnique.mockResolvedValue({ id: 'ped-2', status: 'RASCUNHO' });

    await svc.update(fakeUser(), 'ped-2', { descontoGeral: 5 }); // dentro do teto

    const updArgs = prisma.pedido.update.mock.calls[0][0];
    expect(updArgs.data.status).toBeUndefined(); // não força status
    expect(prisma.aprovacaoDesconto.upsert).not.toHaveBeenCalled();
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

  it('bloqueia envio ao OMIE quando pedido abaixo do mínimo do tenant', async () => {
    prisma.pedido.findFirst.mockResolvedValue({
      id: 'ped-1',
      empresaId: 'emp-1',
      representanteId: 'rep-1',
      clienteId: 'cli-1',
      status: 'RASCUNHO',
      aprovacaoDesconto: null,
      itens: [{ produtoId: 'p1', quantidade: 10, total: 100 }],
    });
    prisma.cliente.findFirst.mockResolvedValue({ omieStatus: 'ATIVO' });
    prisma.produto.findMany.mockResolvedValue([{ id: 'p1', pesoPorUnidade: 1 }]); // 10 kg
    prisma.empresa.findUnique.mockResolvedValue({
      config: { pedidoMinimo: { tipo: 'por_peso', pesoMin: 250 } },
    });
    await expect(svc.enviarParaOmie(fakeUser(), 'ped-1')).rejects.toBeInstanceOf(
      BusinessRuleException,
    );
  });

  it('permite envio ao OMIE quando atinge o mínimo do tenant', async () => {
    prisma.pedido.findFirst.mockResolvedValue({
      id: 'ped-1',
      empresaId: 'emp-1',
      representanteId: 'rep-1',
      clienteId: 'cli-1',
      status: 'RASCUNHO',
      aprovacaoDesconto: null,
      itens: [{ produtoId: 'p1', quantidade: 300, total: 3000 }],
    });
    prisma.cliente.findFirst.mockResolvedValue({ omieStatus: 'ATIVO' });
    prisma.produto.findMany.mockResolvedValue([{ id: 'p1', pesoPorUnidade: 1 }]); // 300 kg
    prisma.empresa.findUnique.mockResolvedValue({
      config: { pedidoMinimo: { tipo: 'por_peso', pesoMin: 250 } },
    });
    prisma.pedido.findUnique.mockResolvedValue({
      id: 'ped-1',
      status: 'ENVIADO_OMIE',
      numeroOmie: 'OMIE-FAKE',
      enviadoOmieEm: new Date(),
    });
    const r = await svc.enviarParaOmie(fakeUser(), 'ped-1');
    expect(r.status).toBe('ENVIADO_OMIE');
  });

  it('lança NotFound quando pedido não existe ou não pertence à empresa do user', async () => {
    prisma.pedido.findFirst.mockResolvedValue(null);
    await expect(svc.findById(fakeUser(), 'inexistente')).rejects.toBeInstanceOf(NotFoundException);
  });
});
