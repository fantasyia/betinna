import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Prisma, type UserRole } from '@prisma/client';
import {
  BusinessRuleException,
  ForbiddenException,
  NotFoundException,
} from '@shared/errors/app-exception';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { PropostasService } from './propostas.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type MockModel = Record<string, ReturnType<typeof vi.fn>>;
type Tx = { pedido: MockModel; proposta: MockModel; aprovacaoDesconto: MockModel };

/**
 * Declara no TIPO um modelo que alguns testes injetam depois de criar o mock,
 * SEM mudar o valor em runtime: continua `undefined` até o teste atribuir.
 * Trocar por `vi.fn()` mudaria o comportamento dos testes que não injetam —
 * a chamada hoje estoura, e passaria a devolver `undefined` calada.
 */
const injetadoDepois = <T>() => undefined as unknown as T;

const makePrismaMock = () => {
  const tx: Tx = {
    pedido: { create: vi.fn() },
    // updateMany = claim CAS da conversão (default count:1 = vence); update = set pedidoId.
    proposta: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), update: vi.fn() },
    aprovacaoDesconto: { create: vi.fn() },
  };
  return {
    proposta: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    } satisfies MockModel,
    pedido: {
      create: vi.fn(),
    } satisfies MockModel,
    cliente: { findFirst: vi.fn(), findUnique: vi.fn() } satisfies MockModel,
    propostaItem: injetadoDepois<{
      create: ReturnType<typeof vi.fn>;
      deleteMany: ReturnType<typeof vi.fn>;
    }>(),
    // default [] = nenhum produto INATIVO (assertProdutosDaPropostaAtivos na conversão, #24).
    produto: { findMany: vi.fn().mockResolvedValue([]) } satisfies MockModel,
    empresa: {
      // Inclui as duas formas selecionadas pelo service: a config de desconto
      // (create/update/converter) e os dados fiscais (exportarPdf: nome/cnpj).
      findUnique: vi.fn(async () => ({
        descontoPixPct: 0,
        descontoBoletoAvistaPct: 0,
        nome: 'Empresa Y',
        cnpj: null as string | null,
      })),
    } satisfies MockModel,
    usuario: { findUnique: vi.fn() } satisfies MockModel,
    $transaction: vi.fn(async (cb: (t: Tx) => unknown) => cb(tx)),
    _tx: tx, // expose for assertions
  };
};

const makeRepScope = () => ({
  getRepIds: vi.fn(async (u: AuthenticatedUser) => {
    if (u.role === 'REP') return [u.id];
    if (u.role === 'GERENTE') return ['rep-a'];
    return null;
  }),
});

const makePricing = () => ({
  priceForClientBatch: vi.fn(async () => new Map()),
});

const makePedidoPricing = () => ({
  pedidoTotals: vi.fn(() => ({
    subtotal: 100,
    total: 100,
    comissao: 5,
    maxDescontoPercentual: 0,
  })),
  descontoAVistaPct: vi.fn(() => 0),
  // Teto de desconto: default não exige aprovação (proposta dentro do teto).
  excedeTetoDesconto: vi.fn(() => false),
  // Gate único da conversão proposta→pedido (default: dentro do teto → RASCUNHO).
  avaliarAprovacaoProposta: vi.fn(() => ({
    requerAprovacao: false,
    statusPedido: 'RASCUNHO' as 'RASCUNHO' | 'AGUARDANDO_APROVACAO',
    maxDescontoPercentual: 0,
  })),
  itemTotal: vi.fn((i: { quantidade: number; precoUnitario: number; desconto: number }) => ({
    total: i.quantidade * i.precoUnitario * (1 - i.desconto / 100),
  })),
  // Espelha o helper real: override abaixo do preço base vira desconto EFETIVO (CAÇADA-BUG #2).
  resolverItemComOverride: vi.fn(
    (input: {
      quantidade: number;
      precoBase: number;
      override?: number | null;
      descontoExplicito?: number | null;
    }) => {
      const explicito = Math.min(80, Math.max(0, input.descontoExplicito ?? 0));
      const { override, precoBase } = input;
      if (override != null && precoBase > 0 && override < precoBase) {
        const precoFinalDesejado = override * (1 - explicito / 100);
        const efetivo = Math.min(80, Math.max(0, (1 - precoFinalDesejado / precoBase) * 100));
        return { quantidade: input.quantidade, precoUnitario: precoBase, desconto: efetivo };
      }
      return {
        quantidade: input.quantidade,
        precoUnitario: override ?? precoBase,
        desconto: explicito,
      };
    },
  ),
});

const makeSequence = () => ({
  next: vi.fn(async () => 1),
});

const fakeUser = (overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  id: 'admin-1',
  email: 'admin@betinna.ai',
  nome: 'Admin',
  role: 'ADMIN' as UserRole,
  empresaIds: ['emp-1'],
  empresaIdAtiva: 'emp-1',
  ...overrides,
});

const fakeProposta = (overrides: Record<string, unknown> = {}) => ({
  id: 'prop-1',
  empresaId: 'emp-1',
  numero: 'PROP-0001',
  clienteId: 'cli-1',
  representanteId: null,
  status: 'RASCUNHO',
  pedidoId: null,
  probabilidade: null,
  validoAte: null,
  formaPagamento: null,
  condicaoPagamento: null,
  prazoEntrega: null,
  subtotal: 100,
  descontoGeral: null,
  valor: 100,
  comissaoEstimada: 5,
  observacoes: null,
  convertidaEm: null,
  criadoEm: new Date('2026-01-01'),
  atualizadoEm: new Date('2026-01-01'),
  cliente: { id: 'cli-1', nome: 'Restaurante X', cnpj: null },
  itens: [],
  ...overrides,
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('PropostasService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let repScope: ReturnType<typeof makeRepScope>;
  let pricing: ReturnType<typeof makePricing>;
  let pedidoPricing: ReturnType<typeof makePedidoPricing>;
  let sequence: ReturnType<typeof makeSequence>;
  let exportSvc: { gerarPdf: ReturnType<typeof vi.fn>; gerarExcel: ReturnType<typeof vi.fn> };
  let service: PropostasService;

  beforeEach(() => {
    prisma = makePrismaMock();
    repScope = makeRepScope();
    pricing = makePricing();
    pedidoPricing = makePedidoPricing();
    sequence = makeSequence();
    // C2 — export service (mock); exposto pra inspeção do `data` normalizado.
    exportSvc = { gerarPdf: vi.fn(async () => Buffer.from('pdf')), gerarExcel: vi.fn() };
    service = new PropostasService(
      prisma as never,
      pricing as never,
      pedidoPricing as never,
      repScope as never,
      sequence as never,
      // C2 — export service + resend (mocks; não exercitados nestes specs)
      exportSvc as never,
      { isConfigured: vi.fn(() => false), enviar: vi.fn() } as never,
      // C3 — aceite service (mock; não exercitado nestes specs)
      { gerarLink: vi.fn(), resolverPreview: vi.fn(), registrarDecisao: vi.fn() } as never,
      // Regra "rep não abre pedido" mora no PedidosService — aqui só consultamos.
      { repPodeCriarPedido: vi.fn(async () => false) } as never,
      // Marca do tenant (logo/cores) — não muda os números do PDF.
      { resolver: vi.fn(async () => ({ primaria: '#201554', secundaria: '#2bcae5' })) } as never,
      // Seletor de modelo por corrente — exercitado no spec próprio dele.
      { paraCorrente: vi.fn() } as never,
    );
  });

  // -------------------------------------------------------------------------
  // list
  // -------------------------------------------------------------------------

  describe('list', () => {
    const baseParams = {
      page: 1,
      limit: 20,
      sortBy: 'criadoEm' as const,
      sortOrder: 'desc' as const,
    };

    it('lança ForbiddenException quando empresaIdAtiva ausente', async () => {
      await expect(
        service.list(fakeUser({ empresaIdAtiva: null }), baseParams),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('filtra por empresaId', async () => {
      prisma.proposta.count.mockResolvedValue(0);
      prisma.proposta.findMany.mockResolvedValue([]);

      await service.list(fakeUser({ empresaIdAtiva: 'emp-5' }), baseParams);

      const where = prisma.proposta.findMany.mock.calls[0][0].where;
      expect(where.empresaId).toBe('emp-5');
    });

    it('REP restringe por representanteId', async () => {
      prisma.proposta.count.mockResolvedValue(0);
      prisma.proposta.findMany.mockResolvedValue([]);

      await service.list(fakeUser({ role: 'REP', id: 'rep-77' }), baseParams);

      const where = prisma.proposta.findMany.mock.calls[0][0].where;
      expect(where.representanteId).toEqual({ in: ['rep-77'] });
    });

    it('filtra por status quando passado', async () => {
      prisma.proposta.count.mockResolvedValue(0);
      prisma.proposta.findMany.mockResolvedValue([]);

      await service.list(fakeUser(), { ...baseParams, status: 'ACEITA' });

      const where = prisma.proposta.findMany.mock.calls[0][0].where;
      expect(where.AND).toEqual(expect.arrayContaining([{ status: 'ACEITA' }]));
    });

    it('filtra por clienteId quando passado', async () => {
      prisma.proposta.count.mockResolvedValue(0);
      prisma.proposta.findMany.mockResolvedValue([]);

      await service.list(fakeUser(), { ...baseParams, clienteId: 'cli-42' });

      const where = prisma.proposta.findMany.mock.calls[0][0].where;
      expect(where.AND).toEqual(expect.arrayContaining([{ clienteId: 'cli-42' }]));
    });
  });

  // -------------------------------------------------------------------------
  // findById
  // -------------------------------------------------------------------------

  describe('findById', () => {
    it('retorna proposta quando encontrada', async () => {
      const prop = fakeProposta();
      prisma.proposta.findFirst.mockResolvedValue(prop);

      const result = await service.findById(fakeUser(), 'prop-1');

      expect(result).toEqual(prop);
    });

    it('lança NotFoundException quando não existe', async () => {
      prisma.proposta.findFirst.mockResolvedValue(null);

      await expect(service.findById(fakeUser(), 'nao-existe')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------

  describe('create', () => {
    // Spread defaults Zod aplicaria; em testes precisamos passar tudo
    // explicito porque o tipo TS é o INPUT validado (sem defaults).
    const baseDto = {
      clienteId: 'cli-1',
      itens: [{ produtoId: 'p-1', quantidade: 2, desconto: 0 }],
      // Era 'BOLETO', que saiu do produto (decisão "só PIX e cartão") — o DTO não
      // aceita mais, e o fixture testava o serviço com um pagamento impossível.
      // ⚠️ CARTAO_CREDITO e NÃO PIX, de propósito: a forma entra no cálculo de
      // preço (`descontoAVistaPct`). BOLETO+30dias dava desconto 0; PIX dá o
      // desconto PIX em QUALQUER condição e mudaria os totais conferidos abaixo.
      // Cartão dá 0 — o mesmo número, qualquer que seja a config da empresa.
      formaPagamento: 'CARTAO_CREDITO' as const,
      condicaoPagamento: '30dias' as const,
      descontoGeral: 0,
      probabilidade: 50,
    };

    it('cria proposta com status RASCUNHO e número gerado', async () => {
      prisma.cliente.findFirst.mockResolvedValue({
        id: 'cli-1',
        empresaId: 'emp-1',
        representanteId: null,
        erpStatus: 'ATIVO',
      });
      prisma.produto.findMany.mockResolvedValue([
        { id: 'p-1', nome: 'Produto A', ativo: true, precoTabela: 50, precoLocacaoMensal: 9 },
      ]);
      prisma.proposta.create.mockResolvedValue(
        fakeProposta({ status: 'RASCUNHO', numero: 'PROP-0001' }),
      );

      await service.create(fakeUser(), baseDto);

      const data = prisma.proposta.create.mock.calls[0][0].data;
      expect(data.status).toBe('RASCUNHO');
      expect(data.numero).toBe('PROP-0001');
    });

    /** Locação vira CONTRATO recorrente no ERP, e contrato precisa de prazo,
     *  dia de vencimento e carência. Sem os três não há o que criar. */
    const prepararCliente = () => {
      prisma.cliente.findFirst.mockResolvedValue({
        id: 'cli-1',
        empresaId: 'emp-1',
        representanteId: null,
        erpStatus: 'ATIVO',
      });
      prisma.produto.findMany.mockResolvedValue([
        { id: 'p-1', nome: 'Produto A', ativo: true, precoTabela: 50, precoLocacaoMensal: 9 },
      ]);
      prisma.proposta.create.mockResolvedValue(fakeProposta({ status: 'RASCUNHO' }));
    };

    /**
     * 🔴 O LEVANTAMENTO DE CAMPO tem que chegar no item.
     *
     * Sem este teste, parar de propagar quadro/tensão/corrente passa despercebido:
     * a proposta é criada, o valor sai certo, o PDF sai — e o Anexo II sai com a
     * tabela vazia. Nada quebra, ninguém é avisado, e o documento que o cliente
     * assina não diz a qual quadro cada equipamento se destina.
     */
    it('grava o levantamento de campo no item (quadro, tensão, corrente)', async () => {
      prepararCliente();

      await service.create(fakeUser(), {
        ...baseDto,
        itens: [
          {
            produtoId: 'p-1',
            quantidade: 1,
            desconto: 0,
            quadroPainel: 'QGBT',
            tensaoV: 380,
            correnteA: 420,
            secaoTecnica: 'SUPRESSOR' as const,
          },
        ],
      });

      const item = prisma.proposta.create.mock.calls[0][0].data.itens.create[0];
      expect(item.quadroPainel).toBe('QGBT');
      expect(item.tensaoV).toBe(380);
      // A corrente vai junto mesmo não aparecendo no documento: é ela que
      // explica por que aquele modelo foi escolhido.
      expect(item.correnteA).toBe(420);
      expect(item.secaoTecnica).toBe('SUPRESSOR');
    });

    it('venda comum não inventa levantamento — os campos ficam nulos', async () => {
      prepararCliente();

      await service.create(fakeUser(), baseDto);

      const item = prisma.proposta.create.mock.calls[0][0].data.itens.create[0];
      expect(item.quadroPainel).toBeNull();
      expect(item.tensaoV).toBeNull();
      expect(item.correnteA).toBeNull();
    });

    /**
     * 🔴 TOPOLOGIA DO ACOMPANHAMENTO (Léo, 18/09).
     *
     * O Data Sense é UM por instalação — fica no quadro principal e computa a
     * qualidade da energia que entra pela rede. Os End Points são a comunicação
     * dele até os outros quadros.
     *
     * Testado no SERVIÇO de propósito: a tela também vai barrar, mas proposta
     * montada pela API não passa por formulário nenhum.
     */
    const comSkus = (skus: string[]) => {
      prisma.cliente.findFirst.mockResolvedValue({
        id: 'cli-1',
        empresaId: 'emp-1',
        representanteId: null,
        erpStatus: 'ATIVO',
      });
      prisma.produto.findMany.mockResolvedValue(
        skus.map((sku, n) => ({
          id: `p-${n}`,
          sku,
          nome: sku,
          ativo: true,
          precoTabela: 50,
          precoLocacaoMensal: 9,
        })),
      );
      prisma.proposta.create.mockResolvedValue(fakeProposta({ status: 'RASCUNHO' }));
      return {
        ...baseDto,
        itens: skus.map((_, n) => ({ produtoId: `p-${n}`, quantidade: 1, desconto: 0 })),
      };
    };

    it('RECUSA dois Data Sense — é um por instalação', async () => {
      const dto = comSkus(['MB-04_D.S.', 'MB-01_D.S.']);
      await expect(service.create(fakeUser(), dto)).rejects.toThrow(/UM por instalação/);
      expect(prisma.proposta.create).not.toHaveBeenCalled();
    });

    it('RECUSA End Point sem Data Sense — ficaria sem concentrador', async () => {
      // Passaria batido: a proposta sairia, o cliente pagaria, e o
      // acompanhamento não funcionaria depois de instalado.
      const dto = comSkus(['MB-01_E.P.', 'MB-03_E.P.']);
      await expect(service.create(fakeUser(), dto)).rejects.toThrow(/End Point/);
      expect(prisma.proposta.create).not.toHaveBeenCalled();
    });

    it('aceita um Data Sense com vários End Points', async () => {
      const dto = comSkus(['MB-04_D.S.', 'MB-01_E.P.', 'MB-03_E.P.']);
      await service.create(fakeUser(), dto);
      expect(prisma.proposta.create).toHaveBeenCalled();
    });

    it('aceita Data Sense sozinho — acompanha só a entrada', async () => {
      const dto = comSkus(['MB-04_D.S.']);
      await service.create(fakeUser(), dto);
      expect(prisma.proposta.create).toHaveBeenCalled();
    });

    it('proposta sem acompanhamento nenhum passa limpo', async () => {
      const dto = comSkus(['MB-04', 'MB-01', 'MB-03']);
      await service.create(fakeUser(), dto);
      expect(prisma.proposta.create).toHaveBeenCalled();
    });

    it('LOCACAO grava prazo, dia de vencimento e carência', async () => {
      prepararCliente();

      await service.create(fakeUser(), {
        ...baseDto,
        modalidade: 'LOCACAO' as const,
        prazoMeses: 24,
        diaVencimento: 10,
        carenciaDias: 60,
      });

      expect(prisma.proposta.create.mock.calls[0][0].data).toMatchObject({
        prazoMeses: 24,
        diaVencimento: 10,
        carenciaDias: 60,
      });
    });

    it('VENDA não guarda termos de contrato — não existe ciclo mensal', async () => {
      prepararCliente();

      await service.create(fakeUser(), {
        ...baseDto,
        modalidade: 'VENDA' as const,
        prazoMeses: 24,
        diaVencimento: 10,
      });

      const data = prisma.proposta.create.mock.calls[0][0].data;
      expect(data.prazoMeses).toBeUndefined();
      expect(data.diaVencimento).toBeUndefined();
    });

    it('REP fica como representanteId automaticamente', async () => {
      prisma.cliente.findFirst.mockResolvedValue({
        id: 'cli-1',
        empresaId: 'emp-1',
        representanteId: 'rep-77',
        erpStatus: 'ATIVO',
      });
      prisma.produto.findMany.mockResolvedValue([
        { id: 'p-1', nome: 'Produto A', ativo: true, precoTabela: 50, precoLocacaoMensal: 9 },
      ]);
      prisma.proposta.create.mockResolvedValue(fakeProposta({ representanteId: 'rep-77' }));

      await service.create(fakeUser({ role: 'REP', id: 'rep-77' }), baseDto);

      const data = prisma.proposta.create.mock.calls[0][0].data;
      expect(data.representanteId).toBe('rep-77');
    });

    it('proposta do REP usa a MENSALIDADE, não o preço de venda', async () => {
      // Erro pego em produção (29/08): a proposta do rep subiu pro ERP com
      // R$ 3.150 (venda) em vez da locação. O rep vende locação — preço de
      // venda na proposta dele é o número errado chegando no cliente.
      prisma.cliente.findFirst.mockResolvedValue({
        id: 'cli-1',
        empresaId: 'emp-1',
        representanteId: 'rep-77',
        erpStatus: 'ATIVO',
      });
      prisma.produto.findMany.mockResolvedValue([
        { id: 'p-1', nome: 'Produto A', ativo: true, precoTabela: 50, precoLocacaoMensal: 9 },
      ]);
      prisma.proposta.create.mockResolvedValue(fakeProposta({ representanteId: 'rep-77' }));

      await service.create(fakeUser({ role: 'REP', id: 'rep-77' }), baseDto);

      const data = prisma.proposta.create.mock.calls[0][0].data;
      expect(data.modalidade).toBe('LOCACAO');
      expect(data.itens.create[0].precoUnitario).toBe(9);
    });

    it('gestão continua vendendo (VENDA é o default de quem não é rep)', async () => {
      prisma.cliente.findFirst.mockResolvedValue({
        id: 'cli-1',
        empresaId: 'emp-1',
        representanteId: null,
        erpStatus: 'ATIVO',
      });
      prisma.produto.findMany.mockResolvedValue([
        { id: 'p-1', nome: 'Produto A', ativo: true, precoTabela: 50, precoLocacaoMensal: 9 },
      ]);
      prisma.proposta.create.mockResolvedValue(fakeProposta({}));

      await service.create(fakeUser(), baseDto);

      const data = prisma.proposta.create.mock.calls[0][0].data;
      expect(data.modalidade).toBe('VENDA');
      expect(data.itens.create[0].precoUnitario).toBe(50);
    });

    it('produto SEM mensalidade recusa a proposta de locação (em vez de usar o de venda)', async () => {
      // Cair pro preço de venda seria o pior desfecho: sai número plausível e
      // errado, e ninguém confere um valor que "parece certo".
      prisma.cliente.findFirst.mockResolvedValue({
        id: 'cli-1',
        empresaId: 'emp-1',
        representanteId: 'rep-77',
        erpStatus: 'ATIVO',
      });
      prisma.produto.findMany.mockResolvedValue([
        { id: 'p-1', nome: 'Produto A', ativo: true, precoTabela: 50, precoLocacaoMensal: null },
      ]);

      await expect(
        service.create(fakeUser({ role: 'REP', id: 'rep-77' }), baseDto),
      ).rejects.toThrow(/não tem preço de locação/i);
    });

    it('produto SEM preço de venda recusa a proposta de VENDA — espelho da regra de locação', async () => {
      // Master Block com IoT (Data Sense / End Point) só existe em LOCAÇÃO, e
      // entra no ERP com preço de venda ZERO. Sem esta trava a proposta sairia
      // a R$ 0,00 — mesma armadilha da locação, na direção oposta.
      prisma.cliente.findFirst.mockResolvedValue({
        id: 'cli-1',
        empresaId: 'emp-1',
        representanteId: 'rep-77',
        erpStatus: 'ATIVO',
      });
      prisma.produto.findMany.mockResolvedValue([
        {
          id: 'p-1',
          nome: 'MB-01 + Data Sense',
          ativo: true,
          precoTabela: 0,
          precoLocacaoMensal: 564,
        },
      ]);

      await expect(service.create(fakeUser(), baseDto)).rejects.toThrow(/não tem preço de venda/i);
    });

    it('produto vendavel:false recusa a proposta de VENDA MESMO com preço cadastrado', async () => {
      // O buraco da trava antiga. Ela lia `precoTabela == 0`; as 24 variantes de
      // locação precisaram ganhar preço no ERP pra aceitar o NCM (a v2 do Tiny
      // recusa alterar produto com preço 0), e o sync traz esse preço pro app.
      // Dali em diante a locação passava como venda, calada.
      prisma.cliente.findFirst.mockResolvedValue({
        id: 'cli-1',
        empresaId: 'emp-1',
        representanteId: 'rep-77',
        erpStatus: 'ATIVO',
      });
      prisma.produto.findMany.mockResolvedValue([
        {
          id: 'p-1',
          nome: 'MB-01 + Data Sense',
          ativo: true,
          vendavel: false,
          precoTabela: 4350,
          precoLocacaoMensal: 564,
        },
      ]);

      await expect(service.create(fakeUser(), baseDto)).rejects.toThrow(
        /LOCAÇÃO e não pode entrar em proposta de venda/i,
      );
    });

    it('o erro DIZ o caminho: trocar a modalidade pra locação', async () => {
      prisma.cliente.findFirst.mockResolvedValue({
        id: 'cli-1',
        empresaId: 'emp-1',
        representanteId: 'rep-77',
        erpStatus: 'ATIVO',
      });
      prisma.produto.findMany.mockResolvedValue([
        {
          id: 'p-1',
          nome: 'MB-01 + Data Sense',
          ativo: true,
          precoTabela: 0,
          precoLocacaoMensal: 564,
        },
      ]);

      await expect(service.create(fakeUser(), baseDto)).rejects.toThrow(/locação/i);
    });

    it('#R1: passa a comissaoPadrao do rep ao pedidoTotals, não 5% fixo', async () => {
      prisma.cliente.findFirst.mockResolvedValue({
        id: 'cli-1',
        empresaId: 'emp-1',
        representanteId: 'rep-77',
        erpStatus: 'ATIVO',
      });
      prisma.produto.findMany.mockResolvedValue([
        { id: 'p-1', nome: 'Produto A', ativo: true, precoTabela: 50, precoLocacaoMensal: 9 },
      ]);
      // resolveComissaoPct lê comissaoPadrao do rep dono.
      prisma.usuario.findUnique.mockResolvedValue({ comissaoPadrao: 8 });
      prisma.proposta.create.mockResolvedValue(fakeProposta({ representanteId: 'rep-77' }));

      await service.create(fakeUser({ role: 'REP', id: 'rep-77' }), baseDto);

      // pedidoTotals(itens, descontoGeralPct, comissaoPct, descAVistaPct) — 3º arg = pct do rep.
      const comissaoPctArg = (pedidoPricing.pedidoTotals.mock.calls[0] as unknown[])[2];
      expect(comissaoPctArg).toBe(8);
    });

    it('lança NotFoundException quando cliente não pertence à empresa', async () => {
      prisma.cliente.findFirst.mockResolvedValue(null);

      await expect(service.create(fakeUser(), baseDto)).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.proposta.create).not.toHaveBeenCalled();
    });

    it('REP lança ForbiddenException para cliente fora da carteira', async () => {
      prisma.cliente.findFirst.mockResolvedValue({
        id: 'cli-1',
        empresaId: 'emp-1',
        representanteId: 'rep-outro',
        erpStatus: 'ATIVO',
      });

      await expect(
        service.create(fakeUser({ role: 'REP', id: 'rep-77' }), baseDto),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lança BusinessRuleException quando produto não pertence à empresa', async () => {
      prisma.cliente.findFirst.mockResolvedValue({
        id: 'cli-1',
        empresaId: 'emp-1',
        representanteId: null,
        erpStatus: 'ATIVO',
      });
      // resolveItens: findMany retorna 0 produtos de 1 pedido
      prisma.produto.findMany.mockResolvedValue([]);

      await expect(service.create(fakeUser(), baseDto)).rejects.toBeInstanceOf(
        BusinessRuleException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // update
  // -------------------------------------------------------------------------

  describe('update', () => {
    it('atualiza proposta em RASCUNHO', async () => {
      const prop = fakeProposta({ status: 'RASCUNHO' });
      prisma.proposta.findFirst.mockResolvedValue(prop);
      prisma.proposta.updateMany.mockResolvedValue({ count: 1 });
      prisma.proposta.findUniqueOrThrow.mockResolvedValue(fakeProposta({ observacoes: 'Obs' }));

      await expect(
        service.update(fakeUser(), 'prop-1', { observacoes: 'Obs' }),
      ).resolves.toBeDefined();
    });

    it('lança BusinessRuleException para proposta ACEITA', async () => {
      const prop = fakeProposta({ status: 'ACEITA' });
      prisma.proposta.findFirst.mockResolvedValue(prop);

      await expect(
        service.update(fakeUser(), 'prop-1', { observacoes: 'X' }),
      ).rejects.toBeInstanceOf(BusinessRuleException);
      expect(prisma.proposta.updateMany).not.toHaveBeenCalled();
    });

    it('lança BusinessRuleException para proposta RECUSADA', async () => {
      const prop = fakeProposta({ status: 'RECUSADA' });
      prisma.proposta.findFirst.mockResolvedValue(prop);

      await expect(service.update(fakeUser(), 'prop-1', {})).rejects.toBeInstanceOf(
        BusinessRuleException,
      );
    });

    it('usa updateMany com id E empresaId (proteção TOCTOU)', async () => {
      const prop = fakeProposta({ status: 'ENVIADA', empresaId: 'emp-1' });
      prisma.proposta.findFirst.mockResolvedValue(prop);
      prisma.proposta.updateMany.mockResolvedValue({ count: 1 });
      prisma.proposta.findUniqueOrThrow.mockResolvedValue(prop);

      await service.update(fakeUser(), 'prop-1', {});

      const args = prisma.proposta.updateMany.mock.calls[0][0];
      expect(args.where.id).toBe('prop-1');
      expect(args.where.empresaId).toBe('emp-1');
    });
  });

  // -------------------------------------------------------------------------
  // changeStatus (máquina de estados)
  // -------------------------------------------------------------------------

  describe('changeStatus', () => {
    it('transição válida RASCUNHO → ENVIADA', async () => {
      const prop = fakeProposta({ status: 'RASCUNHO' });
      const updated = fakeProposta({ status: 'ENVIADA' });
      prisma.proposta.findFirst.mockResolvedValue(prop);
      prisma.proposta.updateMany.mockResolvedValue({ count: 1 });
      prisma.proposta.findUniqueOrThrow.mockResolvedValue(updated);

      const result = await service.changeStatus(fakeUser(), 'prop-1', { status: 'ENVIADA' });

      expect(result.status).toBe('ENVIADA');
    });

    it('transição válida ENVIADA → ACEITA', async () => {
      const prop = fakeProposta({ status: 'ENVIADA' });
      prisma.proposta.findFirst.mockResolvedValue(prop);
      prisma.proposta.updateMany.mockResolvedValue({ count: 1 });
      prisma.proposta.findUniqueOrThrow.mockResolvedValue(fakeProposta({ status: 'ACEITA' }));

      await service.changeStatus(fakeUser(), 'prop-1', { status: 'ACEITA' });

      const args = prisma.proposta.updateMany.mock.calls[0][0];
      expect(args.data.status).toBe('ACEITA');
    });

    it('transição inválida RASCUNHO → ACEITA → BusinessRuleException', async () => {
      const prop = fakeProposta({ status: 'RASCUNHO' });
      prisma.proposta.findFirst.mockResolvedValue(prop);

      await expect(
        service.changeStatus(fakeUser(), 'prop-1', { status: 'ACEITA' }),
      ).rejects.toBeInstanceOf(BusinessRuleException);
    });

    it('transição de status final ACEITA → ENVIADA → BusinessRuleException', async () => {
      const prop = fakeProposta({ status: 'ACEITA' });
      prisma.proposta.findFirst.mockResolvedValue(prop);

      await expect(
        service.changeStatus(fakeUser(), 'prop-1', { status: 'ENVIADA' }),
      ).rejects.toBeInstanceOf(BusinessRuleException);
    });

    it('EXPIRADA pode ser reenviada → EXPIRADA → ENVIADA é válida', async () => {
      const prop = fakeProposta({ status: 'EXPIRADA' });
      prisma.proposta.findFirst.mockResolvedValue(prop);
      prisma.proposta.updateMany.mockResolvedValue({ count: 1 });
      prisma.proposta.findUniqueOrThrow.mockResolvedValue(fakeProposta({ status: 'ENVIADA' }));

      await expect(
        service.changeStatus(fakeUser(), 'prop-1', { status: 'ENVIADA' }),
      ).resolves.toBeDefined();
    });

    it('appends motivo às observacoes quando fornecido', async () => {
      const prop = fakeProposta({ status: 'ENVIADA', observacoes: 'Nota inicial' });
      prisma.proposta.findFirst.mockResolvedValue(prop);
      prisma.proposta.updateMany.mockResolvedValue({ count: 1 });
      prisma.proposta.findUniqueOrThrow.mockResolvedValue(fakeProposta({ status: 'RECUSADA' }));

      await service.changeStatus(fakeUser(), 'prop-1', {
        status: 'RECUSADA',
        motivo: 'Preço alto',
      });

      const args = prisma.proposta.updateMany.mock.calls[0][0];
      expect(args.data.observacoes).toContain('Nota inicial');
      expect(args.data.observacoes).toContain('RECUSADA');
      expect(args.data.observacoes).toContain('Preço alto');
    });

    it('usa updateMany com id E empresaId (proteção TOCTOU)', async () => {
      const prop = fakeProposta({ status: 'RASCUNHO', empresaId: 'emp-1' });
      prisma.proposta.findFirst.mockResolvedValue(prop);
      prisma.proposta.updateMany.mockResolvedValue({ count: 1 });
      prisma.proposta.findUniqueOrThrow.mockResolvedValue(fakeProposta({ status: 'ENVIADA' }));

      await service.changeStatus(fakeUser(), 'prop-1', { status: 'ENVIADA' });

      const args = prisma.proposta.updateMany.mock.calls[0][0];
      expect(args.where.empresaId).toBe('emp-1');
    });
  });

  // -------------------------------------------------------------------------
  // converterEmPedido
  // -------------------------------------------------------------------------

  describe('converterEmPedido', () => {
    it('o pedido carrega o NÚMERO DA PROPOSTA que o originou', async () => {
      // "De onde veio essa venda?" precisa ter resposta em todo pedido nascido
      // de proposta — o do app e o que desce do ERP. Antes só o do ERP tinha.
      prisma.proposta.findFirst.mockResolvedValue(
        fakeProposta({
          status: 'ACEITA',
          pedidoId: null,
          numero: 'PROP-0042',
          itens: [
            {
              produtoId: 'p-1',
              quantidade: 1,
              precoUnitario: 50,
              desconto: 0,
              total: 50,
              negociado: false,
            },
          ],
        }),
      );
      sequence.next.mockResolvedValue(7);
      const tx = prisma._tx;
      tx.pedido.create.mockResolvedValue({ id: 'ped-new', numero: 'PED-0007' });
      tx.proposta.updateMany.mockResolvedValue({ count: 1 });

      await service.converterEmPedido(fakeUser(), 'prop-1');

      expect(tx.pedido.create.mock.calls[0][0].data.propostaNumero).toBe('PROP-0042');
    });

    it('converte proposta ACEITA em pedido via transação', async () => {
      const prop = fakeProposta({
        status: 'ACEITA',
        pedidoId: null,
        itens: [
          {
            produtoId: 'p-1',
            quantidade: 2,
            precoUnitario: 50,
            desconto: 0,
            total: 100,
            negociado: false,
          },
        ],
      });
      prisma.proposta.findFirst.mockResolvedValue(prop);
      sequence.next.mockResolvedValue(7);

      const txMock = prisma._tx;
      txMock.pedido.create.mockResolvedValue({ id: 'ped-new', numero: 'PED-0007' });
      txMock.proposta.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.converterEmPedido(fakeUser(), 'prop-1');

      expect(result).toEqual({ pedidoId: 'ped-new', numero: 'PED-0007' });
    });

    it('desconto acima do teto do rep → pedido AGUARDANDO_APROVACAO + AprovacaoDesconto (não burla aprovação)', async () => {
      const prop = fakeProposta({
        status: 'ACEITA',
        pedidoId: null,
        representanteId: 'rep-1',
        itens: [{ produtoId: 'p-1', quantidade: 1, precoUnitario: 100, desconto: 40, total: 60 }],
      });
      prisma.proposta.findFirst.mockResolvedValue(prop);
      prisma.usuario.findUnique.mockResolvedValue({ role: 'REP', tetoDesconto: 5 }); // teto baixo
      pedidoPricing.avaliarAprovacaoProposta.mockReturnValue({
        requerAprovacao: true,
        statusPedido: 'AGUARDANDO_APROVACAO',
        maxDescontoPercentual: 40,
      });
      sequence.next.mockResolvedValue(9);
      const txMock = prisma._tx;
      txMock.pedido.create.mockResolvedValue({ id: 'ped-9', numero: 'PED-0009' });
      txMock.proposta.updateMany.mockResolvedValue({ count: 1 });

      await service.converterEmPedido(fakeUser(), 'prop-1');

      expect(txMock.pedido.create.mock.calls[0][0].data.status).toBe('AGUARDANDO_APROVACAO');
      expect(txMock.aprovacaoDesconto.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            pedidoId: 'ped-9',
            representanteId: 'rep-1',
            status: 'PENDENTE',
          }),
        }),
      );
    });

    it('número do pedido usa padding de 4 dígitos', async () => {
      const prop = fakeProposta({ status: 'ACEITA', pedidoId: null, itens: [] });
      prisma.proposta.findFirst.mockResolvedValue(prop);
      sequence.next.mockResolvedValue(3);

      const txMock = prisma._tx;
      txMock.pedido.create.mockResolvedValue({ id: 'ped-x', numero: 'PED-0003' });
      txMock.proposta.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.converterEmPedido(fakeUser(), 'prop-1');

      expect(result.numero).toBe('PED-0003');
    });

    it('lança BusinessRuleException se proposta não está ACEITA', async () => {
      prisma.proposta.findFirst.mockResolvedValue(fakeProposta({ status: 'ENVIADA' }));

      await expect(service.converterEmPedido(fakeUser(), 'prop-1')).rejects.toBeInstanceOf(
        BusinessRuleException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('CAÇADA-BUG #23: proposta VENCIDA (validoAte no passado) não converte', async () => {
      prisma.proposta.findFirst.mockResolvedValue(
        fakeProposta({
          status: 'ACEITA',
          pedidoId: null,
          validoAte: new Date(Date.now() - 3 * 86_400_000), // 3 dias atrás (fora da tolerância fim-do-dia BRT ~27h)
        }),
      );

      await expect(service.converterEmPedido(fakeUser(), 'prop-1')).rejects.toThrow(/vencida/i);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('CAÇADA-BUG #24: proposta com produto INATIVO não converte', async () => {
      prisma.proposta.findFirst.mockResolvedValue(
        fakeProposta({
          status: 'ACEITA',
          pedidoId: null,
          itens: [{ produtoId: 'p-1', quantidade: 1, precoUnitario: 100, desconto: 0, total: 100 }],
        }),
      );
      // findMany(ativo:false) devolve o produto → está inativo agora.
      prisma.produto.findMany.mockResolvedValue([{ nome: 'Produto Fora de Linha' }]);

      await expect(service.converterEmPedido(fakeUser(), 'prop-1')).rejects.toThrow(/inativo/i);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('lança BusinessRuleException se proposta já foi convertida', async () => {
      prisma.proposta.findFirst.mockResolvedValue(
        fakeProposta({ status: 'ACEITA', pedidoId: 'ped-existente' }),
      );

      await expect(service.converterEmPedido(fakeUser(), 'prop-1')).rejects.toBeInstanceOf(
        BusinessRuleException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('vincula pedidoId na proposta dentro da transação', async () => {
      const prop = fakeProposta({ status: 'ACEITA', pedidoId: null, itens: [] });
      prisma.proposta.findFirst.mockResolvedValue(prop);
      sequence.next.mockResolvedValue(1);

      const txMock = prisma._tx;
      txMock.pedido.create.mockResolvedValue({ id: 'ped-123', numero: 'PED-0001' });
      txMock.proposta.updateMany.mockResolvedValue({ count: 1 });

      await service.converterEmPedido(fakeUser(), 'prop-1');

      // updateMany = claim CAS (seta convertidaEm); o pedidoId é vinculado no update final.
      expect(txMock.proposta.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ pedidoId: 'ped-123' }),
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // #17 Fase 3 — dinheiro Decimal lido/somado como number (não string)
  // -------------------------------------------------------------------------

  describe('exportarPdf — Prisma.Decimal', () => {
    it('lê dinheiro Decimal e normaliza pra number somável (não concatena) — #17', async () => {
      // Pós-migração, Proposta/PropostaItem.dinheiro são Decimal — findFirst devolve Decimal.
      // dadosParaExport precisa converter pra number (DTO do export é number), provando que
      // os valores entram em aritmética de verdade e não viram string concatenada.
      const prop = fakeProposta({
        status: 'ENVIADA',
        subtotal: new Prisma.Decimal('10000.50'),
        valor: new Prisma.Decimal('9500.25'),
        comissaoEstimada: new Prisma.Decimal('475.01'),
        itens: [
          {
            produtoNome: 'Produto A',
            quantidade: 2,
            precoUnitario: new Prisma.Decimal('5000.25'),
            desconto: 0,
            total: new Prisma.Decimal('10000.50'),
          },
          {
            produtoNome: 'Produto B',
            quantidade: 1,
            precoUnitario: new Prisma.Decimal('2000.50'),
            desconto: 0,
            total: new Prisma.Decimal('2000.50'),
          },
        ],
      });
      prisma.proposta.findFirst.mockResolvedValue(prop);
      prisma.cliente.findUnique.mockResolvedValue({ nome: 'Cliente X', cnpj: null, email: null });
      prisma.empresa.findUnique.mockResolvedValue({
        descontoPixPct: 0,
        descontoBoletoAvistaPct: 0,
        nome: 'Empresa Y',
        cnpj: null,
      });

      await service.exportarPdf(fakeUser(), 'prop-1');

      const data = exportSvc.gerarPdf.mock.calls[0][0] as {
        subtotal: number;
        valor: number;
        itens: Array<{ precoUnitario: number; total: number }>;
      };

      // Campos do cabeçalho viraram number (não Decimal/string).
      expect(typeof data.subtotal).toBe('number');
      expect(data.subtotal).toBe(10_000.5);
      expect(data.valor).toBe(9_500.25);

      // Soma JS dos totais dos itens: 10000.50 + 2000.50 = 12001 (número, não "10000.52000.5").
      const somaItens = data.itens.reduce((s, i) => s + i.total, 0);
      expect(somaItens).toBe(12_001);
      expect(typeof data.itens[0].precoUnitario).toBe('number');
      expect(data.itens[0].precoUnitario).toBe(5_000.25);
    });
  });
  /**
   * RETOMAR O LEVANTAMENTO (Léo, 18/09).
   *
   * 🔴 Antes destas rotas o levantamento vivia só na memória do navegador: o rep
   * media cinco quadros dentro do cliente, fechava a aba e perdia tudo — em campo,
   * onde a bateria acaba e a rede cai.
   */
  describe('itens de proposta em rascunho', () => {
    const RASCUNHO = {
      id: 'p1',
      empresaId: 'emp-1',
      clienteId: 'cli-1',
      status: 'RASCUNHO',
      modalidade: 'LOCACAO',
      representanteId: 'rep-1',
      descontoGeral: 0,
      formaPagamento: 'PIX',
      condicaoPagamento: '30dias',
      itens: [],
    };

    it('adiciona um quadro e recalcula os totais', async () => {
      prisma.proposta.findFirst.mockResolvedValue(RASCUNHO);
      prisma.proposta.findUniqueOrThrow.mockResolvedValue({ ...RASCUNHO, itens: [] });
      prisma.cliente.findFirst.mockResolvedValue({ id: 'cli-1', empresaId: 'emp-1' });
      prisma.produto.findMany.mockResolvedValue([
        {
          id: 'p-1',
          sku: 'MB-04',
          nome: 'MB-04',
          ativo: true,
          precoTabela: 50,
          precoLocacaoMensal: 9,
        },
      ]);
      prisma.propostaItem = { create: vi.fn(), deleteMany: vi.fn() };

      await service.adicionarItem(fakeUser(), 'p1', {
        produtoId: 'p-1',
        quantidade: 1,
        desconto: 0,
        quadroPainel: 'QGBT',
        tensaoV: 380,
        correnteA: 420,
      } as never);

      const data = prisma.propostaItem.create.mock.calls[0][0].data;
      // O levantamento tem que sobreviver ao salvar — é o ponto da rota.
      expect(data.quadroPainel).toBe('QGBT');
      expect(data.correnteA).toBe(420);
      expect(prisma.proposta.update).toHaveBeenCalled();
    });

    /**
     * ⛔ Proposta ENVIADA já foi vista pelo cliente. Acrescentar item nela mudaria
     * por baixo o que ele está lendo no link de aceite.
     */
    it.each(['ENVIADA', 'ACEITA', 'AGUARDANDO_ASSINATURA'])(
      'RECUSA mexer em itens no status %s',
      async (status) => {
        prisma.proposta.findFirst.mockResolvedValue({ ...RASCUNHO, status });
        prisma.propostaItem = { create: vi.fn(), deleteMany: vi.fn() };

        await expect(
          service.adicionarItem(fakeUser(), 'p1', {
            produtoId: 'p-1',
            quantidade: 1,
            desconto: 0,
          } as never),
        ).rejects.toThrow(/já viu esta versão/);
        expect(prisma.propostaItem.create).not.toHaveBeenCalled();
      },
    );

    it('remover item filtra pela proposta, não só pelo id do item', async () => {
      prisma.proposta.findFirst.mockResolvedValue(RASCUNHO);
      prisma.proposta.findUniqueOrThrow.mockResolvedValue({ ...RASCUNHO, itens: [] });
      prisma.propostaItem = {
        create: vi.fn(),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      };

      await service.removerItem(fakeUser(), 'p1', 'item-9');

      // Id de item sozinho atravessaria pra outra proposta, inclusive de outra empresa.
      expect(prisma.propostaItem.deleteMany.mock.calls[0][0].where).toEqual({
        id: 'item-9',
        propostaId: 'p1',
      });
    });

    it('404 ao remover item que não é desta proposta', async () => {
      prisma.proposta.findFirst.mockResolvedValue(RASCUNHO);
      prisma.propostaItem = {
        create: vi.fn(),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      };

      await expect(service.removerItem(fakeUser(), 'p1', 'de-outra')).rejects.toThrow(
        /não encontrado/,
      );
    });
  });

  /** Os prazos do Anexo II são coletados pelo rep e viram texto do documento. */
  describe('prazos do Anexo II na proposta', () => {
    it('grava os três prazos no create', async () => {
      prisma.cliente.findFirst.mockResolvedValue({
        id: 'cli-1',
        empresaId: 'emp-1',
        representanteId: null,
        erpStatus: 'ATIVO',
      });
      prisma.produto.findMany.mockResolvedValue([
        {
          id: 'p-1',
          sku: 'MB-04',
          nome: 'Produto A',
          ativo: true,
          precoTabela: 50,
          precoLocacaoMensal: 9,
        },
      ]);
      prisma.proposta.create.mockResolvedValue(fakeProposta({ status: 'RASCUNHO' }));

      await service.create(fakeUser(), {
        clienteId: 'cli-1',
        itens: [{ produtoId: 'p-1', quantidade: 1, desconto: 0 }],
        formaPagamento: 'PIX' as const,
        condicaoPagamento: '30dias' as const,
        descontoGeral: 0,
        probabilidade: 50,
        prazoEntregaDias: 45,
        prazoInstalacaoDias: 15,
        prazoSoftwareDias: 7,
      } as never);

      const data = prisma.proposta.create.mock.calls[0][0].data;
      expect(data.prazoEntregaDias).toBe(45);
      expect(data.prazoInstalacaoDias).toBe(15);
      expect(data.prazoSoftwareDias).toBe(7);
    });

    it('sem prazo definido não grava número nenhum', async () => {
      prisma.cliente.findFirst.mockResolvedValue({
        id: 'cli-1',
        empresaId: 'emp-1',
        representanteId: null,
        erpStatus: 'ATIVO',
      });
      prisma.produto.findMany.mockResolvedValue([
        {
          id: 'p-1',
          sku: 'MB-04',
          nome: 'Produto A',
          ativo: true,
          precoTabela: 50,
          precoLocacaoMensal: 9,
        },
      ]);
      prisma.proposta.create.mockResolvedValue(fakeProposta({ status: 'RASCUNHO' }));

      await service.create(fakeUser(), {
        clienteId: 'cli-1',
        itens: [{ produtoId: 'p-1', quantidade: 1, desconto: 0 }],
        formaPagamento: 'PIX',
        condicaoPagamento: '30dias',
        descontoGeral: 0,
        probabilidade: 50,
      } as never);

      // ⛔ Prazo padrão sairia impresso num documento que alguém assina, e ninguém
      // saberia que o número não foi combinado com o cliente.
      const data = prisma.proposta.create.mock.calls[0][0].data;
      expect(data.prazoEntregaDias).toBeUndefined();
    });
  });
});
