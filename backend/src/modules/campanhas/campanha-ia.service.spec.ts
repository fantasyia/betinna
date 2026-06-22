import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { UserRole } from '@prisma/client';
import { ForbiddenException, IntegrationException } from '@shared/errors/app-exception';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { HttpClientError } from '@shared/http/http-client.types';
import type { GerarConteudoDto } from './campanhas.dto';
import { CampanhaIaService } from './campanha-ia.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type MockModel = Record<string, ReturnType<typeof vi.fn>>;

const makePrismaMock = () => ({
  empresa: {
    findUnique: vi.fn().mockResolvedValue({ nome: 'Betinna Alimentos', ramo: 'Alimentos' }),
  } satisfies MockModel,
  produto: {
    findMany: vi.fn().mockResolvedValue([]),
  } satisfies MockModel,
  cliente: {
    groupBy: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
  } satisfies MockModel,
  campanha: {
    findFirst: vi.fn().mockResolvedValue(null),
  } satisfies MockModel,
  campanhaDestinatario: {
    groupBy: vi.fn().mockResolvedValue([]),
  } satisfies MockModel,
  tag: {
    findMany: vi.fn().mockResolvedValue([]),
  } satisfies MockModel,
});

const makeHttpMock = () => ({
  post: vi.fn(),
});

const makeEnvMock = (overrides: Record<string, string> = {}) => ({
  get: vi.fn((k: string): string | undefined => {
    const defaults: Record<string, string | undefined> = {
      OPENAI_API_KEY: 'env-openai-key',
      MULLERBOT_MODEL: undefined, // undefined → ?? cai para DEFAULT_MODEL
      ...overrides,
    };
    return defaults[k];
  }),
});

const makeUserIntegracoessMock = () => ({
  obterCredenciaisInternas: vi.fn().mockRejectedValue(new Error('sem integração')),
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

// Monta um GerarConteudoDto completo (os defaults de segmentação/numVariacoes
// que o schema Zod injeta precisam estar presentes no tipo inferido).
const gerarDto = (
  overrides: Pick<GerarConteudoDto, 'objetivo' | 'tom' | 'canal'> & Partial<GerarConteudoDto>,
): GerarConteudoDto => ({
  segTagIds: [],
  segRepIds: [],
  segClienteIds: [],
  numVariacoes: 2,
  ...overrides,
});

const fakeOpenAIResponse = (content: string) => ({
  data: {
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 100, completion_tokens: 50 },
  },
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('CampanhaIaService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let http: ReturnType<typeof makeHttpMock>;
  let userIntegracoes: ReturnType<typeof makeUserIntegracoessMock>;
  let service: CampanhaIaService;

  beforeEach(() => {
    prisma = makePrismaMock();
    http = makeHttpMock();
    userIntegracoes = makeUserIntegracoessMock();
    service = new CampanhaIaService(
      prisma as never,
      http as never,
      makeEnvMock() as never,
      userIntegracoes as never,
    );
  });

  // -------------------------------------------------------------------------
  // Controle de acesso
  // -------------------------------------------------------------------------

  describe('acesso sem empresaIdAtiva → ForbiddenException', () => {
    const noEmp = fakeUser({ empresaIdAtiva: null });

    it('gerarConteudo', async () => {
      await expect(
        service.gerarConteudo(noEmp, gerarDto({ objetivo: 'X', tom: 'formal', canal: 'EMAIL' })),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('analisarResultado', async () => {
      await expect(service.analisarResultado(noEmp, 'camp-1', {})).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('sugerirSegmento', async () => {
      await expect(
        service.sugerirSegmento(noEmp, { objetivo: 'reativar clientes' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  // -------------------------------------------------------------------------
  // resolverCredenciais
  // -------------------------------------------------------------------------

  describe('resolverCredenciais', () => {
    it('usa chave do usuário quando disponível', async () => {
      userIntegracoes.obterCredenciaisInternas.mockResolvedValue({
        credenciais: { apiKey: 'user-key', model: 'gpt-4o' },
      });
      http.post.mockResolvedValue(
        fakeOpenAIResponse(
          JSON.stringify({
            mensagemWa: 'Olá!',
            mensagemEmail: null,
            assunto: null,
            variacoes: [],
            dicas: [],
          }),
        ),
      );

      await service.gerarConteudo(
        fakeUser(),
        gerarDto({ objetivo: 'vender', tom: 'formal', canal: 'WHATSAPP' }),
      );

      // Deve ter chamado OpenAI com o token do usuário
      const headers = http.post.mock.calls[0][1].headers;
      expect(headers.Authorization).toBe('Bearer user-key');
    });

    it('usa OPENAI_API_KEY do env quando usuário não tem chave', async () => {
      userIntegracoes.obterCredenciaisInternas.mockRejectedValue(new Error('sem integração'));
      http.post.mockResolvedValue(
        fakeOpenAIResponse(
          JSON.stringify({
            mensagemWa: 'Olá!',
            mensagemEmail: null,
            assunto: null,
            variacoes: [],
            dicas: [],
          }),
        ),
      );

      await service.gerarConteudo(
        fakeUser(),
        gerarDto({ objetivo: 'vender', tom: 'formal', canal: 'WHATSAPP' }),
      );

      const headers = http.post.mock.calls[0][1].headers;
      expect(headers.Authorization).toBe('Bearer env-openai-key');
    });

    it('lança IntegrationException quando nem usuário nem env têm chave', async () => {
      const serviceNoKey = new CampanhaIaService(
        prisma as never,
        http as never,
        makeEnvMock({ OPENAI_API_KEY: '' }) as never,
        userIntegracoes as never,
      );

      await expect(
        serviceNoKey.gerarConteudo(
          fakeUser(),
          gerarDto({ objetivo: 'X', tom: 'formal', canal: 'EMAIL' }),
        ),
      ).rejects.toBeInstanceOf(IntegrationException);
    });
  });

  // -------------------------------------------------------------------------
  // gerarConteudo
  // -------------------------------------------------------------------------

  describe('gerarConteudo', () => {
    beforeEach(() => {
      http.post.mockResolvedValue(
        fakeOpenAIResponse(
          JSON.stringify({
            mensagemWa: 'Olá {{cliente.nome}}! Confira nossos produtos.',
            mensagemEmail: '<p>Email aqui</p>',
            assunto: 'Oferta especial',
            variacoes: [{ mensagemWa: 'Variação A', assunto: 'Subj A' }],
            dicas: ['Dica 1', 'Dica 2'],
          }),
        ),
      );
    });

    it('retorna estrutura ConteudoGerado com modelo, tokensIn e tokensOut', async () => {
      const result = await service.gerarConteudo(
        fakeUser(),
        gerarDto({ objetivo: 'aumentar vendas', tom: 'amigavel', canal: 'WHATSAPP_EMAIL' }),
      );

      expect(result).toMatchObject({
        mensagemWa: expect.any(String),
        mensagemEmail: expect.any(String),
        assunto: expect.any(String),
        variacoes: expect.any(Array),
        dicas: expect.any(Array),
        modelo: expect.any(String),
        tokensIn: 100,
        tokensOut: 50,
      });
    });

    it('usa modelo padrão gpt-4o-mini quando não especificado', async () => {
      await service.gerarConteudo(
        fakeUser(),
        gerarDto({ objetivo: 'X', tom: 'formal', canal: 'EMAIL' }),
      );

      const body = http.post.mock.calls[0][1].body;
      expect(body.model).toBe('gpt-4o-mini');
    });

    it('usa modelo do DTO quando especificado', async () => {
      await service.gerarConteudo(
        fakeUser(),
        gerarDto({ objetivo: 'X', tom: 'formal', canal: 'EMAIL', modelo: 'gpt-4o' }),
      );

      const body = http.post.mock.calls[0][1].body;
      expect(body.model).toBe('gpt-4o');
    });

    it('retorna fallback quando IA retorna JSON inválido', async () => {
      http.post.mockResolvedValue(fakeOpenAIResponse('INVALID JSON {{'));

      const result = await service.gerarConteudo(
        fakeUser(),
        gerarDto({ objetivo: 'X', tom: 'formal', canal: 'EMAIL' }),
      );

      expect(result.mensagemWa).toBeNull();
      expect(result.dicas).toEqual([]);
    });

    it('lança IntegrationException quando OpenAI retorna erro HTTP', async () => {
      const err = new HttpClientError(
        401,
        { error: 'invalid_api_key' },
        'https://api.openai.com/v1/chat/completions',
        'POST',
        1,
      );
      http.post.mockRejectedValue(err);

      await expect(
        service.gerarConteudo(
          fakeUser(),
          gerarDto({ objetivo: 'X', tom: 'formal', canal: 'EMAIL' }),
        ),
      ).rejects.toBeInstanceOf(IntegrationException);
    });

    it('lança IntegrationException quando OpenAI retorna conteúdo vazio (não dispara em branco)', async () => {
      // Resposta vazia não pode virar mensagem/conteúdo em branco — deve falhar e avisar o operador.
      http.post.mockResolvedValue(fakeOpenAIResponse('   '));

      await expect(
        service.gerarConteudo(
          fakeUser(),
          gerarDto({ objetivo: 'X', tom: 'formal', canal: 'EMAIL' }),
        ),
      ).rejects.toBeInstanceOf(IntegrationException);
    });

    it('inclui perfil da empresa no prompt (nome e ramo)', async () => {
      prisma.empresa.findUnique.mockResolvedValue({ nome: 'Alimentos SA', ramo: 'Bebidas' });
      prisma.produto.findMany.mockResolvedValue([{ nome: 'Suco de Laranja' }]);

      await service.gerarConteudo(
        fakeUser(),
        gerarDto({ objetivo: 'X', tom: 'formal', canal: 'EMAIL' }),
      );

      const body = http.post.mock.calls[0][1].body;
      const userMsg = body.messages[1].content;
      expect(userMsg).toContain('Alimentos SA');
      expect(userMsg).toContain('Bebidas');
      expect(userMsg).toContain('Suco de Laranja');
    });
  });

  // -------------------------------------------------------------------------
  // otimizarMensagem
  // -------------------------------------------------------------------------

  describe('otimizarMensagem', () => {
    it('retorna mensagem original e melhorada', async () => {
      http.post.mockResolvedValue(
        fakeOpenAIResponse(
          JSON.stringify({
            melhorada: 'Versão melhorada da mensagem!',
            variacoes: ['Variação A', 'Variação B'],
            dicas: ['Dica 1'],
          }),
        ),
      );

      const result = await service.otimizarMensagem(fakeUser(), {
        mensagem: 'Mensagem original',
        canal: 'WHATSAPP',
      });

      expect(result).toMatchObject({
        original: 'Mensagem original',
        melhorada: 'Versão melhorada da mensagem!',
        variacoes: ['Variação A', 'Variação B'],
        dicas: ['Dica 1'],
        modelo: expect.any(String),
      });
    });

    it('usa mensagem original como fallback quando IA retorna JSON inválido', async () => {
      http.post.mockResolvedValue(fakeOpenAIResponse('NOT JSON'));

      const result = await service.otimizarMensagem(fakeUser(), {
        mensagem: 'Original fallback',
        canal: 'EMAIL',
      });

      expect(result.melhorada).toBe('Original fallback');
    });
  });

  // -------------------------------------------------------------------------
  // analisarResultado
  // -------------------------------------------------------------------------

  describe('analisarResultado', () => {
    const fakeCampanha = {
      id: 'camp-1',
      nome: 'Campanha Verão',
      objetivo: 'aumentar vendas',
      canal: 'EMAIL',
      status: 'ENVIADA',
      mensagemWa: null,
      assunto: 'Promoção de verão',
      iniciadoEm: new Date('2026-01-01'),
      finalizadoEm: new Date('2026-01-10'),
    };

    it('lança NotFoundException quando campanha não é encontrada', async () => {
      prisma.campanha.findFirst.mockResolvedValue(null);

      const { NotFoundException } = await import('@shared/errors/app-exception');
      await expect(service.analisarResultado(fakeUser(), 'camp-99', {})).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('retorna análise estruturada com pontos fortes, melhorar e recomendações', async () => {
      prisma.campanha.findFirst.mockResolvedValue(fakeCampanha);
      prisma.campanhaDestinatario.groupBy.mockResolvedValue([
        { status: 'ENVIADO', _count: { _all: 80 } },
        { status: 'LIDO', _count: { _all: 20 } },
      ]);
      http.post.mockResolvedValue(
        fakeOpenAIResponse(
          JSON.stringify({
            resumoExecutivo: 'Campanha com boa performance.',
            pontosFortes: ['Alta taxa de abertura'],
            pontosAMelhorar: ['Chamada à ação fraca'],
            recomendacoes: ['Melhorar CTA'],
            proximasCampanhas: ['Retargeting dos lidos'],
            scorePerformance: 8,
          }),
        ),
      );

      const result = await service.analisarResultado(fakeUser(), 'camp-1', {});

      expect(result).toMatchObject({
        resumoExecutivo: expect.any(String),
        pontosFortes: expect.any(Array),
        pontosAMelhorar: expect.any(Array),
        recomendacoes: expect.any(Array),
        scorePerformance: 8,
        modelo: expect.any(String),
      });
    });
  });

  // -------------------------------------------------------------------------
  // sugerirSegmento
  // -------------------------------------------------------------------------

  describe('sugerirSegmento', () => {
    it('retorna segmento sugerido com tagIds validados contra banco', async () => {
      prisma.tag.findMany.mockResolvedValue([
        { id: 'tag-vip', nome: 'VIP' },
        { id: 'tag-risco', nome: 'Risco' },
      ]);
      http.post.mockResolvedValue(
        fakeOpenAIResponse(
          JSON.stringify({
            justificativa: 'Clientes VIP têm maior potencial',
            tagIds: ['tag-vip', 'tag-inexistente'], // tag-inexistente deve ser filtrada
            segmentosTextuais: ['Clientes premium'],
            tonRecomendado: 'formal',
            estimativaAlcance: 50,
            melhorHorario: 'terça-feira, 9h-11h',
          }),
        ),
      );

      const result = await service.sugerirSegmento(fakeUser(), {
        objetivo: 'reativar clientes VIP',
      });

      // tag-inexistente deve ter sido filtrada
      expect(result.tagIds).toEqual(['tag-vip']);
      expect(result.tagIds).not.toContain('tag-inexistente');
    });

    it('retorna tagIds vazio quando IA sugere tags que não existem', async () => {
      prisma.tag.findMany.mockResolvedValue([]);
      http.post.mockResolvedValue(
        fakeOpenAIResponse(
          JSON.stringify({
            justificativa: 'Análise',
            tagIds: ['tag-qualquer'],
            segmentosTextuais: [],
            tonRecomendado: 'amigavel',
            estimativaAlcance: 10,
            melhorHorario: 'segunda, 9h',
          }),
        ),
      );

      const result = await service.sugerirSegmento(fakeUser(), { objetivo: 'X' });

      expect(result.tagIds).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // personalizarMensagemCliente
  // -------------------------------------------------------------------------

  describe('personalizarMensagemCliente', () => {
    const baseParams = {
      criadoPorId: 'user-1',
      templateWa: 'Olá! Confira nossa oferta.',
      templateEmail: '<p>Email template</p>',
      cliente: { nome: 'João Silva', segmento: 'Restaurante', cidade: 'SP', uf: 'SP' },
      objetivo: 'reativar cliente',
      empresaNome: 'Betinna',
    };

    it('retorna mensagem personalizada quando IA responde com sucesso', async () => {
      userIntegracoes.obterCredenciaisInternas.mockResolvedValue({
        credenciais: { apiKey: 'key' },
      });
      http.post.mockResolvedValue(
        fakeOpenAIResponse(
          JSON.stringify({
            mensagemWa: 'Olá João! Oferta especial para restaurantes em SP.',
            mensagemEmail: '<p>Email personalizado</p>',
          }),
        ),
      );

      const result = await service.personalizarMensagemCliente(baseParams);

      expect(result.mensagemWa).toContain('João');
    });

    it('retorna template original quando IA falha (fail-safe)', async () => {
      userIntegracoes.obterCredenciaisInternas.mockRejectedValue(new Error('sem integração'));
      // sem env key também
      const serviceNoKey = new CampanhaIaService(
        prisma as never,
        http as never,
        makeEnvMock({ OPENAI_API_KEY: '' }) as never,
        userIntegracoes as never,
      );

      const result = await serviceNoKey.personalizarMensagemCliente(baseParams);

      // Deve retornar o template sem personalização
      expect(result.mensagemWa).toBe(baseParams.templateWa);
      expect(result.mensagemEmail).toBe(baseParams.templateEmail);
    });

    it('retorna template original quando OpenAI HTTP falha', async () => {
      userIntegracoes.obterCredenciaisInternas.mockResolvedValue({
        credenciais: { apiKey: 'key' },
      });
      http.post.mockRejectedValue(new Error('Network error'));

      const result = await service.personalizarMensagemCliente(baseParams);

      expect(result.mensagemWa).toBe(baseParams.templateWa);
      expect(result.mensagemEmail).toBe(baseParams.templateEmail);
    });

    it('retorna template original quando IA responde vazio (fail-safe, nunca dispara em branco)', async () => {
      userIntegracoes.obterCredenciaisInternas.mockResolvedValue({
        credenciais: { apiKey: 'key' },
      });
      http.post.mockResolvedValue(fakeOpenAIResponse(''));

      const result = await service.personalizarMensagemCliente(baseParams);

      expect(result.mensagemWa).toBe(baseParams.templateWa);
      expect(result.mensagemEmail).toBe(baseParams.templateEmail);
    });
  });
});
