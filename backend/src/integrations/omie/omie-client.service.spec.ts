import { describe, expect, it, vi, beforeEach } from 'vitest';
import { IntegrationException } from '@shared/errors/app-exception';
import { HttpClientError } from '@shared/http/http-client.types';
import { OmieClientService } from './omie-client.service';

// Stub do OmieDemo — testamos o orquestrador, não a fonte demo
vi.mock('./omie.demo', () => ({
  OmieDemo: class {
    listarClientes() {
      return { clientes_cadastro: [], total_de_paginas: 1, total_de_registros: 0, pagina: 1 };
    }
    listarProdutos() {
      return {
        produto_servico_cadastro: [],
        total_de_paginas: 1,
        total_de_registros: 0,
        pagina: 1,
      };
    }
    incluirPedido() {
      return {
        numero_pedido: 1,
        codigo_pedido: 1,
        codigo_status: '0',
        descricao_status: 'demo',
      };
    }
  },
}));

const makeHttpMock = () => ({ post: vi.fn() });

const makeEnvMock = (overrides: Record<string, string | number | boolean> = {}) => ({
  get: vi.fn((k: string) => {
    const d: Record<string, string | number | boolean> = {
      OMIE_BASE_URL: 'https://app.omie.com.br/api/v1',
      OMIE_TIMEOUT_MS: 30000,
      OMIE_DEMO_MODE: false,
      OMIE_APP_KEY: '',
      OMIE_APP_SECRET: '',
      ...overrides,
    };
    return d[k];
  }),
});

const makeIntegracoesMock = () => ({
  obterCredenciaisInternas: vi.fn(),
  registrarSyncErro: vi.fn().mockResolvedValue({}),
});

describe('OmieClientService', () => {
  let http: ReturnType<typeof makeHttpMock>;
  let integracoes: ReturnType<typeof makeIntegracoesMock>;

  beforeEach(() => {
    http = makeHttpMock();
    integracoes = makeIntegracoesMock();
  });

  describe('modo demo', () => {
    it('isDemoMode retorna true quando env=true', () => {
      const service = new OmieClientService(
        http as never,
        makeEnvMock({ OMIE_DEMO_MODE: true }) as never,
        integracoes as never,
      );
      expect(service.isDemoMode()).toBe(true);
    });

    it('listarClientes em modo demo não chama HTTP', async () => {
      const service = new OmieClientService(
        http as never,
        makeEnvMock({ OMIE_DEMO_MODE: true }) as never,
        integracoes as never,
      );

      await service.listarClientes('emp-1', 1);

      expect(http.post).not.toHaveBeenCalled();
    });
  });

  describe('resolução de credenciais', () => {
    it('usa credenciais por empresa quando disponíveis', async () => {
      const service = new OmieClientService(
        http as never,
        makeEnvMock() as never,
        integracoes as never,
      );
      integracoes.obterCredenciaisInternas.mockResolvedValue({
        credenciais: { appKey: 'emp-key', appSecret: 'emp-secret' },
      });
      http.post.mockResolvedValue({
        data: { clientes_cadastro: [], total_de_paginas: 1, pagina: 1, total_de_registros: 0 },
      });

      await service.listarClientes('emp-1', 1);

      const body = http.post.mock.calls[0][1].body;
      expect(body.app_key).toBe('emp-key');
      expect(body.app_secret).toBe('emp-secret');
    });

    it('cai pro env quando integração não tem credenciais', async () => {
      const service = new OmieClientService(
        http as never,
        makeEnvMock({ OMIE_APP_KEY: 'env-key', OMIE_APP_SECRET: 'env-secret' }) as never,
        integracoes as never,
      );
      integracoes.obterCredenciaisInternas.mockRejectedValue(new Error('not configured'));
      http.post.mockResolvedValue({
        data: { clientes_cadastro: [], total_de_paginas: 1, pagina: 1, total_de_registros: 0 },
      });

      await service.listarClientes('emp-1', 1);

      const body = http.post.mock.calls[0][1].body;
      expect(body.app_key).toBe('env-key');
    });

    it('lança IntegrationException quando nem empresa nem env têm credenciais', async () => {
      const service = new OmieClientService(
        http as never,
        makeEnvMock() as never,
        integracoes as never,
      );
      integracoes.obterCredenciaisInternas.mockRejectedValue(new Error('off'));

      await expect(service.listarClientes('emp-1', 1)).rejects.toBeInstanceOf(IntegrationException);
    });
  });

  describe('envelope OMIE', () => {
    beforeEach(() => {
      integracoes.obterCredenciaisInternas.mockResolvedValue({
        credenciais: { appKey: 'k', appSecret: 's' },
      });
    });

    it('envia call + app_key + app_secret + param array', async () => {
      const service = new OmieClientService(
        http as never,
        makeEnvMock() as never,
        integracoes as never,
      );
      http.post.mockResolvedValue({
        data: { clientes_cadastro: [], total_de_paginas: 1, pagina: 1, total_de_registros: 0 },
      });

      await service.listarClientes('emp-1', 2);

      const body = http.post.mock.calls[0][1].body;
      expect(body).toMatchObject({
        call: 'ListarClientes',
        app_key: 'k',
        app_secret: 's',
        param: [expect.objectContaining({ pagina: 2 })],
      });
    });

    it('redacta app_key e app_secret nos logs', async () => {
      const service = new OmieClientService(
        http as never,
        makeEnvMock() as never,
        integracoes as never,
      );
      http.post.mockResolvedValue({
        data: {
          produto_servico_cadastro: [],
          total_de_paginas: 1,
          pagina: 1,
          total_de_registros: 0,
        },
      });

      await service.listarProdutos('emp-1', 1);

      const opts = http.post.mock.calls[0][1];
      expect(opts.redactKeys).toEqual(expect.arrayContaining(['app_key', 'app_secret']));
    });
  });

  describe('tratamento de erros', () => {
    beforeEach(() => {
      integracoes.obterCredenciaisInternas.mockResolvedValue({
        credenciais: { appKey: 'k', appSecret: 's' },
      });
    });

    it('detecta fault no body (HTTP 200) e lança IntegrationException', async () => {
      const service = new OmieClientService(
        http as never,
        makeEnvMock() as never,
        integracoes as never,
      );
      http.post.mockResolvedValue({
        data: { faultcode: 'CRM-001', faultstring: 'cliente não encontrado' },
      });

      try {
        await service.listarClientes('emp-1', 1);
        expect.fail('throw');
      } catch (e) {
        expect(e).toBeInstanceOf(IntegrationException);
        expect((e as Error).message).toContain('CRM-001');
        expect((e as Error).message).toContain('cliente não encontrado');
      }
    });

    it('embrulha HttpClientError em IntegrationException', async () => {
      const service = new OmieClientService(
        http as never,
        makeEnvMock() as never,
        integracoes as never,
      );
      http.post.mockRejectedValue(new HttpClientError(500, { e: 'down' }, 'u', 'POST', 1));

      await expect(service.listarClientes('emp-1', 1)).rejects.toBeInstanceOf(IntegrationException);
    });

    it('registra sync erro quando OMIE retorna fault', async () => {
      const service = new OmieClientService(
        http as never,
        makeEnvMock() as never,
        integracoes as never,
      );
      http.post.mockResolvedValue({
        data: { faultcode: 'X', faultstring: 'erro' },
      });

      await expect(service.listarClientes('emp-1', 1)).rejects.toBeInstanceOf(IntegrationException);
      expect(integracoes.registrarSyncErro).toHaveBeenCalledWith('emp-1', 'omie');
    });
  });

  // -------------------------------------------------------------------------
  // Retry exponencial em faults transient (audit fix 2026-05-17)
  // -------------------------------------------------------------------------

  describe('retry em fault retryable', () => {
    beforeEach(() => {
      integracoes.obterCredenciaisInternas.mockResolvedValue({
        credenciais: { appKey: 'k', appSecret: 's' },
      });
    });

    it('retenta em fault "sem comunicação" e tem sucesso na 2ª tentativa', async () => {
      const service = new OmieClientService(
        http as never,
        makeEnvMock() as never,
        integracoes as never,
      );
      // Primeira tentativa: fault transient. Segunda: sucesso.
      http.post
        .mockResolvedValueOnce({
          data: { faultcode: 'SOAP-ENV:Server', faultstring: 'Sem comunicação com o servidor' },
        })
        .mockResolvedValueOnce({
          data: { clientes_cadastro: [], total_de_registros: 0, pagina: 1, total_de_paginas: 1 },
        });

      const r = await service.listarClientes('emp-1', 1);
      expect(r).toBeDefined();
      expect(http.post).toHaveBeenCalledTimes(2);
    });

    it('retenta em fault "tempo limite excedido"', async () => {
      const service = new OmieClientService(
        http as never,
        makeEnvMock() as never,
        integracoes as never,
      );
      http.post
        .mockResolvedValueOnce({
          data: { faultcode: 'SOAP-ENV:Server', faultstring: 'Timeout' },
        })
        .mockResolvedValueOnce({
          data: { clientes_cadastro: [], total_de_registros: 0, pagina: 1, total_de_paginas: 1 },
        });

      await service.listarClientes('emp-1', 1);
      expect(http.post).toHaveBeenCalledTimes(2);
    });

    it('NÃO retenta em fault definitivo (cliente não encontrado)', async () => {
      const service = new OmieClientService(
        http as never,
        makeEnvMock() as never,
        integracoes as never,
      );
      http.post.mockResolvedValue({
        data: { faultcode: 'CRM-001', faultstring: 'Cliente não encontrado' },
      });

      await expect(service.listarClientes('emp-1', 1)).rejects.toBeInstanceOf(IntegrationException);
      // Só 1 tentativa: fault permanente não retenta
      expect(http.post).toHaveBeenCalledTimes(1);
    });

    it('NÃO retenta em fault de credencial inválida', async () => {
      const service = new OmieClientService(
        http as never,
        makeEnvMock() as never,
        integracoes as never,
      );
      http.post.mockResolvedValue({
        data: { faultcode: 'SOAP-ENV:Client-401', faultstring: 'App Key inválida' },
      });

      await expect(service.listarClientes('emp-1', 1)).rejects.toBeInstanceOf(IntegrationException);
      expect(http.post).toHaveBeenCalledTimes(1);
    });

    it('esgota 3 tentativas em fault transient persistente e lança', async () => {
      const service = new OmieClientService(
        http as never,
        makeEnvMock() as never,
        integracoes as never,
      );
      http.post.mockResolvedValue({
        data: { faultcode: 'SOAP-ENV:Server', faultstring: 'Servidor em manutenção' },
      });

      await expect(service.listarClientes('emp-1', 1)).rejects.toBeInstanceOf(IntegrationException);
      expect(http.post).toHaveBeenCalledTimes(3);
    });

    it('retenta em rate limit ("aguarde alguns segundos")', async () => {
      const service = new OmieClientService(
        http as never,
        makeEnvMock() as never,
        integracoes as never,
      );
      http.post
        .mockResolvedValueOnce({
          data: { faultcode: 'SOAP-ENV:Server', faultstring: 'Aguarde alguns segundos' },
        })
        .mockResolvedValueOnce({
          data: { clientes_cadastro: [], total_de_registros: 0, pagina: 1, total_de_paginas: 1 },
        });

      await service.listarClientes('emp-1', 1);
      expect(http.post).toHaveBeenCalledTimes(2);
    });
  });

  describe('endpoints de alto nível', () => {
    beforeEach(() => {
      integracoes.obterCredenciaisInternas.mockResolvedValue({
        credenciais: { appKey: 'k', appSecret: 's' },
      });
    });

    it('listarClientes usa resource geral/clientes/ e call ListarClientes', async () => {
      const service = new OmieClientService(
        http as never,
        makeEnvMock() as never,
        integracoes as never,
      );
      http.post.mockResolvedValue({
        data: { clientes_cadastro: [], total_de_paginas: 1, pagina: 1, total_de_registros: 0 },
      });

      await service.listarClientes('emp-1', 1);

      expect(http.post.mock.calls[0][0]).toContain('geral/clientes/');
      expect(http.post.mock.calls[0][1].body.call).toBe('ListarClientes');
    });

    it('listarProdutos usa resource geral/produtos/ e call ListarProdutos', async () => {
      const service = new OmieClientService(
        http as never,
        makeEnvMock() as never,
        integracoes as never,
      );
      http.post.mockResolvedValue({
        data: {
          produto_servico_cadastro: [],
          total_de_paginas: 1,
          pagina: 1,
          total_de_registros: 0,
        },
      });

      await service.listarProdutos('emp-1', 1);

      expect(http.post.mock.calls[0][0]).toContain('geral/produtos/');
      expect(http.post.mock.calls[0][1].body.call).toBe('ListarProdutos');
    });

    it('incluirPedido usa resource produtos/pedido/ e call IncluirPedido', async () => {
      const service = new OmieClientService(
        http as never,
        makeEnvMock() as never,
        integracoes as never,
      );
      http.post.mockResolvedValue({
        data: {
          numero_pedido: 99,
          codigo_pedido: 100,
          codigo_status: '0',
          descricao_status: 'ok',
        },
      });

      await service.incluirPedido('emp-1', {
        cabecalho: {
          codigo_cliente: 1,
          codigo_pedido_integracao: 'P',
          data_previsao: '01/01/2026',
          quantidade_itens: 1,
        },
        det: [],
      });

      expect(http.post.mock.calls[0][0]).toContain('produtos/pedido/');
      expect(http.post.mock.calls[0][1].body.call).toBe('IncluirPedido');
    });
  });

  // -------------------------------------------------------------------------
  // Escrita não retenta (evita pedido duplicado / "já cadastrado")
  // -------------------------------------------------------------------------

  describe('escrita (IncluirPedido) não retenta', () => {
    const pedidoParam = {
      cabecalho: {
        codigo_cliente: 1,
        codigo_pedido_integracao: 'P-1',
        data_previsao: '01/01/2026',
        quantidade_itens: 1,
      },
      det: [],
    };

    beforeEach(() => {
      integracoes.obterCredenciaisInternas.mockResolvedValue({
        credenciais: { appKey: 'k', appSecret: 's' },
      });
    });

    it('passa retries=0 ao HttpClient (escrita não retenta no transporte)', async () => {
      const service = new OmieClientService(
        http as never,
        makeEnvMock() as never,
        integracoes as never,
      );
      http.post.mockResolvedValue({
        data: { numero_pedido: 1, codigo_pedido: 1, codigo_status: '0', descricao_status: 'ok' },
      });

      await service.incluirPedido('emp-1', pedidoParam);

      expect(http.post.mock.calls[0][1].retries).toBe(0);
    });

    it('NÃO retenta fault transient — falha na 1ª tentativa (vs leitura que retenta)', async () => {
      const service = new OmieClientService(
        http as never,
        makeEnvMock() as never,
        integracoes as never,
      );
      // "Tempo limite" é retryable em LEITURA, mas escrita não pode arriscar duplicar.
      http.post.mockResolvedValue({
        data: { faultcode: 'SOAP-ENV:Server', faultstring: 'Tempo limite excedido' },
      });

      await expect(service.incluirPedido('emp-1', pedidoParam)).rejects.toBeInstanceOf(
        IntegrationException,
      );
      expect(http.post).toHaveBeenCalledTimes(1); // sem fault-retry em escrita
    });
  });

  // -------------------------------------------------------------------------
  // Heal idempotente: ConsultarPedido por codigo_pedido_integracao
  // -------------------------------------------------------------------------

  describe('consultarPedidoPorIntegracao (heal)', () => {
    beforeEach(() => {
      integracoes.obterCredenciaisInternas.mockResolvedValue({
        credenciais: { appKey: 'k', appSecret: 's' },
      });
    });

    it('devolve o pedido quando o OMIE tem ele (cabecalho com numero_pedido)', async () => {
      const service = new OmieClientService(
        http as never,
        makeEnvMock() as never,
        integracoes as never,
      );
      http.post.mockResolvedValue({
        data: {
          pedido_venda_produto: { cabecalho: { codigo_pedido: 555, numero_pedido: '77777' } },
        },
      });

      const r = await service.consultarPedidoPorIntegracao('emp-1', 'PED-2026-001');

      expect(r?.numero_pedido).toBe('77777');
      expect(http.post.mock.calls[0][1].body.call).toBe('ConsultarPedido');
      expect(http.post.mock.calls[0][1].body.param[0]).toMatchObject({
        codigo_pedido_integracao: 'PED-2026-001',
      });
    });

    it('devolve null quando o OMIE NÃO encontra o pedido (fault)', async () => {
      const service = new OmieClientService(
        http as never,
        makeEnvMock() as never,
        integracoes as never,
      );
      http.post.mockResolvedValue({
        data: { faultcode: 'SOAP-ENV:Client-104', faultstring: 'Pedido nao encontrado' },
      });

      const r = await service.consultarPedidoPorIntegracao('emp-1', 'PED-INEXISTENTE');
      expect(r).toBeNull();
    });

    it('em demo mode devolve null sem chamar HTTP', async () => {
      const service = new OmieClientService(
        http as never,
        makeEnvMock({ OMIE_DEMO_MODE: true }) as never,
        integracoes as never,
      );

      const r = await service.consultarPedidoPorIntegracao('emp-1', 'PED-1');

      expect(r).toBeNull();
      expect(http.post).not.toHaveBeenCalled();
    });
  });
});
