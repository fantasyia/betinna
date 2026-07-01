import { describe, expect, it, vi, beforeEach } from 'vitest';
import { BusinessRuleException } from '@shared/errors/app-exception';
import { OmieAmostrasService } from './omie-amostras.service';

// Usa o OmieMapper REAL — queremos validar que o CFOP entra no item da remessa.

const makePrismaMock = () => ({
  amostra: {
    findFirst: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
  },
});

const makeOmieClientMock = () => ({
  incluirPedido: vi.fn(),
  consultarPedidoPorIntegracao: vi.fn().mockResolvedValue(null),
});

const makeIntegracoesMock = () => ({
  registrarSyncOk: vi.fn().mockResolvedValue({}),
});

const makeMetricsMock = () => ({
  omiePush: { inc: vi.fn() },
  omiePushDuration: { startTimer: vi.fn().mockReturnValue(() => undefined) },
});

/** Env com os defaults do schema. */
const makeEnvMock = (cenario = 0) => ({
  get: vi.fn((key: string) => {
    switch (key) {
      case 'OMIE_CFOP_AMOSTRA_UF':
        return '5911';
      case 'OMIE_CFOP_AMOSTRA_INTERESTADUAL':
        return '6911';
      case 'OMIE_CENARIO_IMPOSTO_AMOSTRA':
        return cenario;
      default:
        return undefined;
    }
  }),
});

const fakeAmostra = (overrides: Record<string, unknown> = {}) => ({
  id: 'am-1',
  empresaId: 'emp-1',
  valor: 0,
  quantidade: 2,
  numeroOmie: null,
  produto: {
    id: 'prod-1',
    nome: 'Óleo de Girassol 5L',
    codigoOmie: '2001',
    sku: 'OLE-GIR-5L',
    precoTabela: 48,
  },
  cliente: {
    id: 'cli-1',
    nome: 'Restaurante X',
    codigoOmie: '1001',
    omieStatus: 'ATIVO',
    uf: 'SP',
  },
  empresa: { id: 'emp-1', uf: 'SP' },
  ...overrides,
});

const fakeOmieResponse = (overrides: Record<string, unknown> = {}) => ({
  numero_pedido: 700123,
  codigo_pedido: 555555,
  codigo_status: '0',
  descricao_status: 'Pedido incluído com sucesso',
  ...overrides,
});

describe('OmieAmostrasService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let omie: ReturnType<typeof makeOmieClientMock>;
  let integracoes: ReturnType<typeof makeIntegracoesMock>;
  let env: ReturnType<typeof makeEnvMock>;
  let service: OmieAmostrasService;

  const build = (cenario = 0) => {
    env = makeEnvMock(cenario);
    service = new OmieAmostrasService(
      prisma as never,
      omie as never,
      integracoes as never,
      makeMetricsMock() as never,
      env as never,
    );
  };

  beforeEach(() => {
    prisma = makePrismaMock();
    omie = makeOmieClientMock();
    integracoes = makeIntegracoesMock();
    build();
  });

  describe('enviarAmostra — validações', () => {
    it('lança BusinessRuleException quando amostra não existe', async () => {
      prisma.amostra.findFirst.mockResolvedValue(null);
      await expect(service.enviarAmostra('am-999')).rejects.toBeInstanceOf(BusinessRuleException);
    });

    it('lança quando amostra já foi enviada (numeroOmie preenchido)', async () => {
      prisma.amostra.findFirst.mockResolvedValue(fakeAmostra({ numeroOmie: '999' }));
      await expect(service.enviarAmostra('am-1')).rejects.toBeInstanceOf(BusinessRuleException);
      expect(omie.incluirPedido).not.toHaveBeenCalled();
    });

    it('lança quando não há produto vinculado', async () => {
      prisma.amostra.findFirst.mockResolvedValue(fakeAmostra({ produto: null }));
      await expect(service.enviarAmostra('am-1')).rejects.toBeInstanceOf(BusinessRuleException);
    });

    it('lança quando produto não tem codigoOmie nem sku', async () => {
      prisma.amostra.findFirst.mockResolvedValue(
        fakeAmostra({
          produto: { id: 'p', nome: 'X', codigoOmie: null, sku: null, precoTabela: 1 },
        }),
      );
      await expect(service.enviarAmostra('am-1')).rejects.toBeInstanceOf(BusinessRuleException);
    });

    it('lança quando cliente não tem codigoOmie', async () => {
      prisma.amostra.findFirst.mockResolvedValue(
        fakeAmostra({
          cliente: { id: 'c', nome: 'X', codigoOmie: null, omieStatus: 'ATIVO', uf: 'SP' },
        }),
      );
      await expect(service.enviarAmostra('am-1')).rejects.toBeInstanceOf(BusinessRuleException);
    });

    it('lança quando cliente está bloqueado no OMIE', async () => {
      prisma.amostra.findFirst.mockResolvedValue(
        fakeAmostra({
          cliente: { id: 'c', nome: 'X', codigoOmie: '1001', omieStatus: 'BLOQUEADO', uf: 'SP' },
        }),
      );
      await expect(service.enviarAmostra('am-1')).rejects.toBeInstanceOf(BusinessRuleException);
      expect(omie.incluirPedido).not.toHaveBeenCalled();
    });

    it('lança quando quantidade <= 0', async () => {
      prisma.amostra.findFirst.mockResolvedValue(fakeAmostra({ quantidade: 0 }));
      await expect(service.enviarAmostra('am-1')).rejects.toBeInstanceOf(BusinessRuleException);
    });
  });

  describe('enviarAmostra — envio', () => {
    it('envia remessa, persiste numeroOmie/enviadoOmieEm/cfop e retorna resultado', async () => {
      prisma.amostra.findFirst.mockResolvedValue(fakeAmostra());
      omie.incluirPedido.mockResolvedValue(fakeOmieResponse());

      const result = await service.enviarAmostra('am-1', 'emp-1');

      expect(omie.incluirPedido).toHaveBeenCalledWith('emp-1', expect.any(Object));
      expect(prisma.amostra.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'am-1' },
          data: expect.objectContaining({
            numeroOmie: '700123',
            enviadoOmieEm: expect.any(Date),
            cfop: '5911',
          }),
        }),
      );
      expect(result).toMatchObject({ amostraId: 'am-1', numeroOmie: '700123', cfop: '5911' });
    });

    it('heal idempotente: envio falha mas já existe no OMIE → reconcilia (não duplica)', async () => {
      prisma.amostra.findFirst.mockResolvedValue(fakeAmostra());
      omie.incluirPedido.mockRejectedValue(new Error('já cadastrado'));
      omie.consultarPedidoPorIntegracao.mockResolvedValue(fakeOmieResponse());

      const result = await service.enviarAmostra('am-1', 'emp-1');

      expect(omie.consultarPedidoPorIntegracao).toHaveBeenCalledWith('emp-1', 'AMO-am-1');
      expect(result.numeroOmie).toBe('700123');
      expect(prisma.amostra.update).toHaveBeenCalled(); // reconciliou (persistiu o número real)
    });

    it('erro real: envio falha e NÃO existe no OMIE → propaga (não marca enviado)', async () => {
      prisma.amostra.findFirst.mockResolvedValue(fakeAmostra());
      omie.incluirPedido.mockRejectedValue(new Error('credencial inválida'));
      omie.consultarPedidoPorIntegracao.mockResolvedValue(null);

      await expect(service.enviarAmostra('am-1', 'emp-1')).rejects.toThrow('credencial inválida');
      expect(prisma.amostra.update).not.toHaveBeenCalled();
    });

    it('usa CFOP 5911 quando empresa e cliente na mesma UF', async () => {
      prisma.amostra.findFirst.mockResolvedValue(fakeAmostra());
      omie.incluirPedido.mockResolvedValue(fakeOmieResponse());

      await service.enviarAmostra('am-1');

      const payload = omie.incluirPedido.mock.calls[0][1];
      expect(payload.det[0].produto.cfop).toBe('5911');
    });

    it('usa CFOP 6911 quando interestadual (UFs diferentes)', async () => {
      prisma.amostra.findFirst.mockResolvedValue(
        fakeAmostra({
          empresa: { id: 'emp-1', uf: 'SP' },
          cliente: { id: 'c', nome: 'X', codigoOmie: '1001', omieStatus: 'ATIVO', uf: 'RJ' },
        }),
      );
      omie.incluirPedido.mockResolvedValue(fakeOmieResponse());

      const result = await service.enviarAmostra('am-1');

      expect(result.cfop).toBe('6911');
      const payload = omie.incluirPedido.mock.calls[0][1];
      expect(payload.det[0].produto.cfop).toBe('6911');
    });

    it('cabeçalho usa codigo_cliente do OMIE e integração AMO-<id>', async () => {
      prisma.amostra.findFirst.mockResolvedValue(fakeAmostra());
      omie.incluirPedido.mockResolvedValue(fakeOmieResponse());

      await service.enviarAmostra('am-1');

      const payload = omie.incluirPedido.mock.calls[0][1];
      expect(payload.cabecalho).toMatchObject({
        codigo_cliente: 1001,
        codigo_pedido_integracao: 'AMO-am-1',
        quantidade_itens: 1,
      });
    });

    it('valor de referência cai no precoTabela do produto quando amostra.valor = 0', async () => {
      prisma.amostra.findFirst.mockResolvedValue(fakeAmostra({ valor: 0 }));
      omie.incluirPedido.mockResolvedValue(fakeOmieResponse());

      await service.enviarAmostra('am-1');

      const payload = omie.incluirPedido.mock.calls[0][1];
      expect(payload.det[0].produto.valor_unitario).toBe(48); // precoTabela
      expect(payload.det[0].produto.quantidade).toBe(2);
    });

    it('omite cenário fiscal quando OMIE_CENARIO_IMPOSTO_AMOSTRA = 0', async () => {
      prisma.amostra.findFirst.mockResolvedValue(fakeAmostra());
      omie.incluirPedido.mockResolvedValue(fakeOmieResponse());

      await service.enviarAmostra('am-1');

      const payload = omie.incluirPedido.mock.calls[0][1];
      expect(payload.informacoes_adicionais).toBeUndefined();
    });

    it('inclui codigo_cenario_imposto quando configurado (> 0)', async () => {
      build(7); // cenário fiscal 7
      prisma.amostra.findFirst.mockResolvedValue(fakeAmostra());
      omie.incluirPedido.mockResolvedValue(fakeOmieResponse());

      await service.enviarAmostra('am-1');

      const payload = omie.incluirPedido.mock.calls[0][1];
      expect(payload.informacoes_adicionais).toEqual({ codigo_cenario_imposto: 7 });
    });

    it('usa codigo_pedido como fallback quando numero_pedido ausente', async () => {
      prisma.amostra.findFirst.mockResolvedValue(fakeAmostra());
      omie.incluirPedido.mockResolvedValue(fakeOmieResponse({ numero_pedido: undefined }));

      const result = await service.enviarAmostra('am-1');

      expect(result.numeroOmie).toBe('555555');
    });
  });
});
