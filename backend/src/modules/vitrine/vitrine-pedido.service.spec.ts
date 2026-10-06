import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
import { BusinessRuleException, NotFoundException } from '@shared/errors/app-exception';
import {
  VitrinePedidoService,
  faixaDoTotal,
  minimoDaVitrine,
  normalizarWhatsapp,
  precoNaFaixa,
} from './vitrine-pedido.service';
import { pedidoVitrineSchema } from './vitrine.dto';

const D = (n: number) => new Prisma.Decimal(n);

const variacao = (corId: string, tamanhoId: string, produtoId: string, precos = {}) => ({
  modeloCorId: corId,
  modeloTamanhoId: tamanhoId,
  produtoId,
  modelo: { nome: 'Bermuda' },
  modeloCor: { cor: { nome: 'Preto' } },
  modeloLinha: {
    precoEntrada: D(45),
    precoVolume: D(41),
    precoAtacadao: null,
    linha: { nome: 'Regular' },
    ...precos,
  },
  modeloTamanho: { tamanho: { nome: tamanhoId.toUpperCase() } },
});

const vitrineOk = {
  ativa: true,
  empresaId: 'emp-1',
  minimoEntrada: 5,
  minimoVolume: 50,
  minimoAtacadao: 500,
  empresa: { ativo: true },
};

function montar(
  opts: { vitrine?: unknown; variacoes?: unknown[]; recente?: unknown; clientes?: unknown[] } = {},
) {
  const prisma = {
    vitrine: { findUnique: vi.fn().mockResolvedValue(opts.vitrine ?? vitrineOk) },
    catalogoVariacao: {
      findMany: vi
        .fn()
        .mockResolvedValue(
          opts.variacoes ?? [variacao('c1', 'p', 'prod-p'), variacao('c1', 'm', 'prod-m')],
        ),
    },
    pedido: {
      findFirst: vi.fn().mockResolvedValue(opts.recente ?? null),
      create: vi.fn().mockResolvedValue({ id: 'ped-1', numero: 'PED-0007' }),
    },
    cliente: {
      findUnique: vi.fn().mockResolvedValue({ cnpj: null, telefone: null, cidade: null, uf: null }),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({ id: 'cli-novo' }),
    },
    $queryRaw: vi.fn().mockResolvedValue(opts.clientes ?? []),
  };
  const bus = { disparar: vi.fn().mockResolvedValue(undefined) };
  const notif = { criarParaRole: vi.fn().mockResolvedValue(1) };
  const seq = { next: vi.fn().mockResolvedValue(7) };
  const svc = new VitrinePedidoService(prisma as never, seq as never, bus as never, notif as never);
  return { svc, prisma, bus, notif };
}

const dto = (over: Record<string, unknown> = {}) =>
  pedidoVitrineSchema.parse({
    nome: 'Maria Lojista',
    whatsapp: '(47) 99999-1234',
    cidade: 'Brusque',
    uf: 'sc',
    itens: [
      { corId: 'c1', tamanhoId: 'p', quantidade: 3 },
      { corId: 'c1', tamanhoId: 'm', quantidade: 3 },
    ],
    ...over,
  });

describe('regras puras', () => {
  it('faixa pelo total de peças', () => {
    const f = { minimoVolume: 50, minimoAtacadao: 500 };
    expect(faixaDoTotal(6, f)).toBe('entrada');
    expect(faixaDoTotal(50, f)).toBe('volume');
    expect(faixaDoTotal(500, f)).toBe('atacadao');
  });
  it('faixa melhor sem preço cai pra de baixo; nenhuma = sob consulta', () => {
    const l = { precoEntrada: D(45), precoVolume: D(41), precoAtacadao: null };
    expect(precoNaFaixa(l, 'atacadao')).toBe(41);
    expect(
      precoNaFaixa({ precoEntrada: null, precoVolume: null, precoAtacadao: null }, 'entrada'),
    ).toBe(null);
  });
  it('WhatsApp ganha o 55', () => {
    expect(normalizarWhatsapp('(47) 99999-1234')).toBe('5547999991234');
    expect(normalizarWhatsapp('5547999991234')).toBe('5547999991234');
  });
  it('isca de robô preenchida é recusada', () => {
    expect(() => dto({ site: 'http://spam' })).toThrow();
  });
});

describe('VitrinePedidoService.enviar', () => {
  beforeEach(() => vi.clearAllMocks());

  it('cria o pedido com o PREÇO DO CADASTRO, origem VITRINE, e dispara PEDIDO_CRIADO', async () => {
    const { svc, prisma, bus, notif } = montar();
    const r = await svc.enviar('atacado-ribelt', dto());

    expect(r).toEqual({ numero: 'PED-0007', totalPecas: 6, total: 270, duplicado: false });
    const data = prisma.pedido.create.mock.calls[0][0].data;
    expect(data.origem).toBe('VITRINE');
    expect(data.status).toBe('RASCUNHO');
    expect(data.representanteId).toBeNull();
    expect(data.contatoTelefone).toBe('5547999991234');
    expect(Number(data.total)).toBe(270);
    expect(data.itens.create).toHaveLength(2);
    expect(Number(data.itens.create[0].precoUnitario)).toBe(45);
    expect(data.observacoes).toContain('Brusque/SC');
    expect(prisma.cliente.create).toHaveBeenCalled();
    expect(bus.disparar).toHaveBeenCalledWith(
      'emp-1',
      'PEDIDO_CRIADO',
      expect.objectContaining({ pedidoId: 'ped-1', origem: 'VITRINE', clienteId: 'cli-novo' }),
    );
    expect(notif.criarParaRole).toHaveBeenCalled();
  });

  it('faixa Volume aplica o preço de volume a TODOS os itens', async () => {
    const { svc, prisma } = montar();
    await svc.enviar(
      'atacado-ribelt',
      dto({
        itens: [
          { corId: 'c1', tamanhoId: 'p', quantidade: 30 },
          { corId: 'c1', tamanhoId: 'm', quantidade: 20 },
        ],
      }),
    );
    const data = prisma.pedido.create.mock.calls[0][0].data;
    expect(Number(data.itens.create[0].precoUnitario)).toBe(41);
    expect(Number(data.total)).toBe(50 * 41);
  });

  it('abaixo do mínimo de peças: recusa', async () => {
    const { svc, prisma } = montar();
    await expect(
      svc.enviar(
        'atacado-ribelt',
        dto({ itens: [{ corId: 'c1', tamanhoId: 'p', quantidade: 2 }] }),
      ),
    ).rejects.toBeInstanceOf(BusinessRuleException);
    expect(prisma.pedido.create).not.toHaveBeenCalled();
  });

  it('item que saiu da vitrine: recusa o pedido inteiro', async () => {
    const { svc, prisma } = montar({ variacoes: [variacao('c1', 'p', 'prod-p')] });
    await expect(svc.enviar('atacado-ribelt', dto())).rejects.toBeInstanceOf(BusinessRuleException);
    expect(prisma.pedido.create).not.toHaveBeenCalled();
  });

  it('vitrine desligada: 404 sem ler o catálogo', async () => {
    const { svc, prisma } = montar({ vitrine: { ...vitrineOk, ativa: false } });
    await expect(svc.enviar('atacado-ribelt', dto())).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.catalogoVariacao.findMany).not.toHaveBeenCalled();
  });

  it('reenvio em 10 min (mesmo telefone, total e peças) devolve o MESMO pedido', async () => {
    const { svc, prisma, bus } = montar({
      recente: { numero: 'PED-0006', itens: [{ quantidade: 3 }, { quantidade: 3 }] },
    });
    const r = await svc.enviar('atacado-ribelt', dto());
    expect(r).toMatchObject({ numero: 'PED-0006', duplicado: true });
    expect(prisma.pedido.create).not.toHaveBeenCalled();
    expect(bus.disparar).not.toHaveBeenCalled();
  });

  it('item sem preço (sob consulta) entra a R$ 0 e fica marcado na observação', async () => {
    const semPreco = { precoEntrada: null, precoVolume: null };
    const { svc, prisma } = montar({
      variacoes: [variacao('c1', 'p', 'prod-p'), variacao('c1', 'm', 'prod-m', semPreco)],
    });
    const r = await svc.enviar('atacado-ribelt', dto());
    expect(r.total).toBe(135);
    expect(prisma.pedido.create.mock.calls[0][0].data.observacoes).toContain('PREÇO A CONFIRMAR');
  });

  it('cliente que já existe pelo WhatsApp: reaproveita e só preenche o que estava vazio', async () => {
    const { svc, prisma } = montar({ clientes: [{ id: 'cli-velho', doc: '' }] });
    prisma.cliente.findUnique.mockResolvedValue({
      cnpj: null,
      telefone: '47 99999-1234',
      cidade: 'Gaspar',
      uf: null,
    });
    await svc.enviar('atacado-ribelt', dto());
    expect(prisma.cliente.create).not.toHaveBeenCalled();
    expect(prisma.cliente.update).toHaveBeenCalledWith({
      where: { id: 'cli-velho' },
      data: { uf: 'SC' },
    });
    expect(prisma.pedido.create.mock.calls[0][0].data.clienteId).toBe('cli-velho');
  });

  it('documento diferente VETA o casamento por telefone', async () => {
    const { svc, prisma } = montar({ clientes: [{ id: 'cli-outro', doc: '11111111111' }] });
    // 1ª consulta (documento) não acha; 2ª (telefone) acha outro CPF.
    prisma.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'cli-outro', doc: '11111111111' }]);
    await svc.enviar('atacado-ribelt', dto({ cpfCnpj: '222.222.222-22' }));
    expect(prisma.cliente.create).toHaveBeenCalled();
  });

  it('pedido mínimo por VALOR da empresa: abaixo de R$ 600 recusa, mesmo com peças de sobra', async () => {
    const cfg = { pedidoMinimo: { tipo: 'por_valor', valorMin: 600 } };
    const { svc, prisma } = montar({
      vitrine: { ...vitrineOk, empresa: { ativo: true, config: cfg } },
    });
    // 6 peças × R$ 45 = R$ 270
    await expect(svc.enviar('atacado-ribelt', dto())).rejects.toThrow(/R\$\s?330,00/);
    expect(prisma.pedido.create).not.toHaveBeenCalled();
  });

  it('pedido mínimo por valor atingido: passa', async () => {
    const cfg = { pedidoMinimo: { tipo: 'por_valor', valorMin: 600 } };
    const { svc, prisma } = montar({
      vitrine: { ...vitrineOk, empresa: { ativo: true, config: cfg } },
    });
    await svc.enviar(
      'atacado-ribelt',
      dto({
        itens: [
          { corId: 'c1', tamanhoId: 'p', quantidade: 7 },
          { corId: 'c1', tamanhoId: 'm', quantidade: 7 },
        ],
      }),
    );
    expect(prisma.pedido.create).toHaveBeenCalled();
  });

  it('com item sob consulta o valor não é conhecido: o mínimo por valor não trava', async () => {
    const cfg = { pedidoMinimo: { tipo: 'por_valor', valorMin: 600 } };
    const { svc, prisma } = montar({
      vitrine: { ...vitrineOk, empresa: { ativo: true, config: cfg } },
      variacoes: [
        variacao('c1', 'p', 'prod-p'),
        variacao('c1', 'm', 'prod-m', { precoEntrada: null, precoVolume: null }),
      ],
    });
    await svc.enviar('atacado-ribelt', dto());
    expect(prisma.pedido.create).toHaveBeenCalled();
  });
});

describe('minimoDaVitrine', () => {
  it('lê valor e quantidade; peso e sem_minimo não contam', () => {
    expect(minimoDaVitrine({ pedidoMinimo: { tipo: 'por_valor', valorMin: 600 } })).toEqual({
      valorMin: 600,
      quantidadeMin: null,
      modo: 'E',
    });
    expect(minimoDaVitrine({ pedidoMinimo: { tipo: 'por_peso', pesoMin: 250 } })).toBeNull();
    expect(minimoDaVitrine({ pedidoMinimo: { tipo: 'sem_minimo', valorMin: 600 } })).toBeNull();
    expect(minimoDaVitrine(null)).toBeNull();
  });
});
