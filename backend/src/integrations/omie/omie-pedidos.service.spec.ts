import { describe, expect, it, vi, beforeEach } from 'vitest';
import { BusinessRuleException } from '@shared/errors/app-exception';
import { OmiePedidosService } from './omie-pedidos.service';

// Stub OmieMapper — testamos o orquestrador, não o mapper (que tem spec próprio)
vi.mock('./omie.mapper', () => ({
  OmieMapper: {
    dateToOmie: vi.fn((_d: Date) => '01/01/2026'),
    pedidoItemToOmie: vi.fn((item) => ({
      ide: { codigo_item_integracao: item.produtoSku ?? 'sku' },
      produto: {
        codigo_produto: item.produtoCodigoOmie ? Number(item.produtoCodigoOmie) : 0,
        quantidade: item.quantidade,
        valor_unitario: Number(item.precoUnitario),
      },
      inf_adic: { dados_adicionais_item: '' },
    })),
  },
}));

const makePrismaMock = () => ({
  pedido: {
    findFirst: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
  },
});

const makeOmieClientMock = () => ({
  incluirPedido: vi.fn(),
  // Default: pedido NÃO existe no OMIE (heal só reconcilia se a consulta achar).
  consultarPedidoPorIntegracao: vi.fn().mockResolvedValue(null),
});

const makeIntegracoesMock = () => ({
  registrarSyncOk: vi.fn().mockResolvedValue({}),
});

const fakePedido = (overrides: Record<string, unknown> = {}) => ({
  id: 'ped-1',
  empresaId: 'emp-1',
  numero: 'PED-2026-001',
  status: 'APROVADO',
  observacoes: null,
  prazoEntrega: null,
  enviadoOmieEm: null,
  numeroOmie: null,
  cliente: {
    id: 'cli-1',
    codigoOmie: '12345',
    nome: 'Cliente Teste',
    omieStatus: 'ATIVO',
  },
  itens: [
    {
      id: 'item-1',
      quantidade: 10,
      precoUnitario: 25.5,
      desconto: 0,
      produto: {
        id: 'prod-1',
        codigoOmie: '789',
        sku: 'SKU-001',
        nome: 'Produto A',
      },
    },
  ],
  ...overrides,
});

const fakeOmieResponse = (overrides: Record<string, unknown> = {}) => ({
  numero_pedido: 99999,
  codigo_pedido: 555555,
  codigo_status: '101',
  descricao_status: 'Pedido cadastrado com sucesso',
  ...overrides,
});

describe('OmiePedidosService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let omie: ReturnType<typeof makeOmieClientMock>;
  let integracoes: ReturnType<typeof makeIntegracoesMock>;
  let service: OmiePedidosService;

  beforeEach(() => {
    prisma = makePrismaMock();
    omie = makeOmieClientMock();
    integracoes = makeIntegracoesMock();
    service = new OmiePedidosService(
      prisma as never,
      omie as never,
      integracoes as never,
      {
        omiePush: { inc: vi.fn() },
        omiePushDuration: { startTimer: vi.fn().mockReturnValue(() => undefined) },
      } as never,
    );
  });

  describe('enviarPedido', () => {
    it('lança BusinessRuleException quando pedido não existe', async () => {
      prisma.pedido.findFirst.mockResolvedValue(null);

      await expect(service.enviarPedido('ped-999')).rejects.toBeInstanceOf(BusinessRuleException);
    });

    it('lança BusinessRuleException quando cliente não tem codigoOmie', async () => {
      prisma.pedido.findFirst.mockResolvedValue(
        fakePedido({ cliente: { id: 'cli-1', codigoOmie: null, nome: 'X' } }),
      );

      await expect(service.enviarPedido('ped-1')).rejects.toBeInstanceOf(BusinessRuleException);
      expect(omie.incluirPedido).not.toHaveBeenCalled();
    });

    it('envia pedido pra OMIE e atualiza status local', async () => {
      prisma.pedido.findFirst.mockResolvedValue(fakePedido());
      omie.incluirPedido.mockResolvedValue(fakeOmieResponse());

      const result = await service.enviarPedido('ped-1');

      expect(omie.incluirPedido).toHaveBeenCalledWith('emp-1', expect.any(Object));
      expect(prisma.pedido.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'ped-1' },
          data: expect.objectContaining({
            status: 'ENVIADO_OMIE',
            numeroOmie: '99999',
            enviadoOmieEm: expect.any(Date),
          }),
        }),
      );
      expect(result.pedidoId).toBe('ped-1');
      expect(result.numeroOmie).toBe('99999');
      expect(result.codigoStatusOmie).toBe('101');
    });

    it('usa codigo_pedido como fallback quando numero_pedido está ausente', async () => {
      prisma.pedido.findFirst.mockResolvedValue(fakePedido());
      omie.incluirPedido.mockResolvedValue(fakeOmieResponse({ numero_pedido: undefined }));

      const result = await service.enviarPedido('ped-1');

      expect(result.numeroOmie).toBe('555555');
    });

    it('payload inclui cabeçalho com codigo_cliente e codigo_pedido_integracao', async () => {
      prisma.pedido.findFirst.mockResolvedValue(fakePedido());
      omie.incluirPedido.mockResolvedValue(fakeOmieResponse());

      await service.enviarPedido('ped-1');

      const payload = omie.incluirPedido.mock.calls[0][1];
      expect(payload.cabecalho).toMatchObject({
        codigo_cliente: 12345,
        codigo_pedido_integracao: 'PED-2026-001',
        quantidade_itens: 1,
      });
    });

    it('inclui observações no payload quando presentes', async () => {
      prisma.pedido.findFirst.mockResolvedValue(fakePedido({ observacoes: 'Entregar manhã' }));
      omie.incluirPedido.mockResolvedValue(fakeOmieResponse());

      await service.enviarPedido('ped-1');

      const payload = omie.incluirPedido.mock.calls[0][1];
      expect(payload.observacoes).toEqual({ obs_venda: 'Entregar manhã' });
    });

    it('omite observacoes do payload quando vazias', async () => {
      prisma.pedido.findFirst.mockResolvedValue(fakePedido({ observacoes: null }));
      omie.incluirPedido.mockResolvedValue(fakeOmieResponse());

      await service.enviarPedido('ped-1');

      const payload = omie.incluirPedido.mock.calls[0][1];
      expect(payload.observacoes).toBeUndefined();
    });

    it('registra sync OK ao concluir (best-effort, ignora falha)', async () => {
      prisma.pedido.findFirst.mockResolvedValue(fakePedido());
      omie.incluirPedido.mockResolvedValue(fakeOmieResponse());
      integracoes.registrarSyncOk.mockRejectedValue(new Error('DB down'));

      // Não deve lançar — registrarSyncOk é best-effort
      await expect(service.enviarPedido('ped-1')).resolves.toBeDefined();
    });

    it('mapeia 1 item de pedido = 1 entrada det no payload', async () => {
      const pedidoTresItens = fakePedido({
        itens: [
          { quantidade: 1, precoUnitario: 10, desconto: 0, produto: { codigoOmie: '1', sku: 'A' } },
          { quantidade: 2, precoUnitario: 20, desconto: 0, produto: { codigoOmie: '2', sku: 'B' } },
          { quantidade: 3, precoUnitario: 30, desconto: 0, produto: { codigoOmie: '3', sku: 'C' } },
        ],
      });
      prisma.pedido.findFirst.mockResolvedValue(pedidoTresItens);
      omie.incluirPedido.mockResolvedValue(fakeOmieResponse());

      await service.enviarPedido('ped-1');

      const payload = omie.incluirPedido.mock.calls[0][1];
      expect(payload.det).toHaveLength(3);
      expect(payload.cabecalho.quantidade_itens).toBe(3);
    });

    it('HEAL: reconcilia quando incluirPedido falha mas o pedido já existe no OMIE', async () => {
      prisma.pedido.findFirst.mockResolvedValue(fakePedido());
      // Envio falha (timeout / "já cadastrado")...
      omie.incluirPedido.mockRejectedValue(new Error('OMIE.IncluirPedido: ja cadastrado'));
      // ...mas o pedido REALMENTE existe no OMIE (resposta perdida num envio anterior):
      omie.consultarPedidoPorIntegracao.mockResolvedValue(
        fakeOmieResponse({ numero_pedido: 77777, codigo_status: 'reconciliado' }),
      );

      const result = await service.enviarPedido('ped-1');

      // Consultou pelo codigo_pedido_integracao (= pedido.numero)
      expect(omie.consultarPedidoPorIntegracao).toHaveBeenCalledWith('emp-1', 'PED-2026-001');
      // Reconciliou: status local vira ENVIADO_OMIE com o número de lá (em vez de falhar)
      expect(prisma.pedido.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'ENVIADO_OMIE', numeroOmie: '77777' }),
        }),
      );
      expect(result.numeroOmie).toBe('77777');
    });

    it('HEAL: propaga o erro original quando o pedido NÃO existe no OMIE', async () => {
      prisma.pedido.findFirst.mockResolvedValue(fakePedido());
      const erro = new Error('OMIE.IncluirPedido: cliente nao encontrado');
      omie.incluirPedido.mockRejectedValue(erro);
      omie.consultarPedidoPorIntegracao.mockResolvedValue(null); // não existe lá → erro real

      await expect(service.enviarPedido('ped-1')).rejects.toBe(erro);
      expect(prisma.pedido.update).not.toHaveBeenCalled(); // não marcou como enviado
    });
  });
});
