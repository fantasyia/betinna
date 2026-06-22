import { describe, expect, it, vi } from 'vitest';
import type { UserRole } from '@prisma/client';
import {
  BusinessRuleException,
  ForbiddenException,
  IntegrationException,
} from '@shared/errors/app-exception';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { MullerBotService } from './mullerbot.service';

/**
 * Default = ADMIN (cai pro env quando não tem credencial própria).
 * Testes que validam política específica do REP passam `role: 'REP'` explícito.
 */
const fakeUser = (overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  id: 'u1',
  email: 'admin@x.com',
  nome: 'Admin',
  role: 'ADMIN' as UserRole,
  empresaIds: ['emp-1'],
  empresaIdAtiva: 'emp-1',
  ...overrides,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const makeHttp = (): { post: any } => ({
  post: vi.fn(async (_url: string, _opts: unknown) => ({
    status: 200,
    ok: true,
    headers: {},
    data: { choices: [{ message: { content: 'resposta openai' } }] },
    attempts: 1,
    durationMs: 5,
  })),
});

const makeEnv = (overrides: Record<string, unknown> = {}) => ({
  get: vi.fn((k: string): unknown => {
    const map: Record<string, unknown> = {
      OPENAI_API_KEY: '',
      MULLERBOT_MODEL: 'gpt-4o-mini',
      MULLERBOT_MAX_INPUT_TOKENS: 4000,
      MULLERBOT_MAX_OUTPUT_TOKENS: 1024,
      ...overrides,
    };
    return map[k] ?? '';
  }),
});

const makeUserIntegracoes = (
  resolverImpl: () => Promise<unknown> = async () => {
    throw new Error('não configurada');
  },
) => ({
  obterCredenciaisInternas: vi.fn(async (_u: string, _s: string) => resolverImpl()),
});

/**
 * Stub das integrações de ESCOPO EMPRESA (IntegracaoConexao servico='openai').
 * Default = sem credencial da empresa (lança), pra cair na chave do usuário/env
 * exatamente como os testes esperam.
 */
const makeIntegracoes = (
  resolverImpl: () => Promise<unknown> = async () => {
    throw new Error('não configurada');
  },
) => ({
  obterCredenciaisInternas: vi.fn(async (_e: string, _s: string) => resolverImpl()),
});

const makeProdutoSearch = (resultado: unknown[] = []) => ({
  buscar: vi.fn(async () => resultado),
});

/** Cache stub — sempre miss, não persiste nada. Não interfere nos asserts. */
const makeCache = () => ({
  buildAnswerKey: vi.fn(() => 'mb:answer:test'),
  getAnswer: vi.fn(async () => null),
  setAnswer: vi.fn(async () => undefined),
  getHistorico: vi.fn(async () => []),
  pushTurn: vi.fn(async () => undefined),
  limparHistorico: vi.fn(async () => ({ ok: true as const })),
});

/**
 * Persona stub — retorna prompt curto pra testes não dependerem do conteúdo
 * real do prompt da empresa. Conteúdo só precisa ser determinístico pra
 * cálculo de tokens ser estável entre runs.
 */
const makePersona = () => ({
  compilarSystemPrompt: vi.fn(
    async (_empresaId: string) =>
      'Você é a Bê, assistente comercial. Use APENAS o catálogo fornecido.',
  ),
});

const PRODUTO_BASE = {
  id: 'p1',
  nome: 'Óleo de Girassol 5L',
  descricao: 'Óleo refinado em garrafa de 5 litros',
  marca: 'Soya',
  linha: 'Alimentos',
  categoria: 'Óleos',
  unidade: 'UN',
  precoTabela: 48,
  sku: 'OLE-GIR-5L',
  codigoOmie: '2001',
  score: 3,
  matches: [],
};

describe('MullerBotService.perguntar — credenciais', () => {
  it('falha quando empresaIdAtiva ausente', async () => {
    const svc = new MullerBotService(
      makeHttp() as never,
      makeEnv() as never,
      makeUserIntegracoes() as never,
      makeProdutoSearch() as never,
      makeCache() as never,
      makePersona() as never,
      makeIntegracoes() as never,
    );
    await expect(
      svc.perguntar(fakeUser({ empresaIdAtiva: undefined }), {
        pergunta: 'x',
        topK: 5,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lança IntegrationException quando OpenAI não configurado em nenhum lugar', async () => {
    const svc = new MullerBotService(
      makeHttp() as never,
      makeEnv() as never,
      makeUserIntegracoes() as never,
      makeProdutoSearch() as never,
      makeCache() as never,
      makePersona() as never,
      makeIntegracoes() as never,
    );
    await expect(svc.perguntar(fakeUser(), { pergunta: 'oi', topK: 5 })).rejects.toBeInstanceOf(
      IntegrationException,
    );
  });

  it('usa credencial OpenAI do usuário quando configurada', async () => {
    const http = makeHttp();
    const ui = makeUserIntegracoes(async () => ({
      credenciais: { apiKey: 'sk-user-key', model: 'gpt-4o-mini' },
    }));
    const svc = new MullerBotService(
      http as never,
      makeEnv() as never,
      ui as never,
      makeProdutoSearch() as never,
      makeCache() as never,
      makePersona() as never,
      makeIntegracoes() as never,
    );
    const r = await svc.perguntar(fakeUser(), { pergunta: 'tem óleo?', topK: 5 });
    expect(r.modelo).toBe('gpt-4o-mini');
    const [, opts] = http.post.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(opts.headers.Authorization).toBe('Bearer sk-user-key');
  });

  it('REP é OBRIGADO a ter chave própria — não cai pro env mesmo se houver', async () => {
    const http = makeHttp();
    const svc = new MullerBotService(
      http as never,
      makeEnv({ OPENAI_API_KEY: 'sk-env-disponivel' }) as never,
      makeUserIntegracoes() as never,
      makeProdutoSearch() as never,
      makeCache() as never,
      makePersona() as never,
      makeIntegracoes() as never,
    );
    // REP explícito: mesmo com OPENAI_API_KEY no env, deve falhar
    await expect(
      svc.perguntar(fakeUser({ role: 'REP' as UserRole }), { pergunta: 'tem óleo?', topK: 5 }),
    ).rejects.toBeInstanceOf(IntegrationException);
    expect(http.post).not.toHaveBeenCalled();
  });

  it('SAC/Diretor cai pro env quando não tem credencial própria', async () => {
    const http = makeHttp();
    const svc = new MullerBotService(
      http as never,
      makeEnv({ OPENAI_API_KEY: 'sk-env' }) as never,
      makeUserIntegracoes() as never,
      makeProdutoSearch() as never,
      makeCache() as never,
      makePersona() as never,
      makeIntegracoes() as never,
    );
    const r = await svc.perguntar(fakeUser({ role: 'SAC' as UserRole }), {
      pergunta: 'tem óleo?',
      topK: 5,
    });
    expect(r.resposta).toBe('resposta openai');
    const [, opts] = http.post.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(opts.headers.Authorization).toBe('Bearer sk-env');
  });
});

describe('MullerBotService.perguntar — modo mock (MULLERBOT_MOCK)', () => {
  it('devolve resposta fake sem chamar a OpenAI, mesmo sem credencial', async () => {
    const http = makeHttp();
    const svc = new MullerBotService(
      http as never,
      makeEnv({ MULLERBOT_MOCK: true }) as never,
      makeUserIntegracoes() as never,
      makeProdutoSearch([PRODUTO_BASE]) as never,
      makeCache() as never,
      makePersona() as never,
      makeIntegracoes() as never,
    );
    const r = await svc.perguntar(fakeUser(), { pergunta: 'tem óleo?', topK: 5 });
    expect(typeof r.resposta).toBe('string');
    expect(r.resposta.length).toBeGreaterThan(0);
    expect(http.post).not.toHaveBeenCalled();
  });

  it('mock funciona até pra REP sem chave própria (ignora exigência de credencial)', async () => {
    const http = makeHttp();
    const svc = new MullerBotService(
      http as never,
      makeEnv({ MULLERBOT_MOCK: true }) as never,
      makeUserIntegracoes() as never,
      makeProdutoSearch([PRODUTO_BASE]) as never,
      makeCache() as never,
      makePersona() as never,
      makeIntegracoes() as never,
    );
    const r = await svc.perguntar(fakeUser({ role: 'REP' as UserRole }), {
      pergunta: 'oi',
      topK: 5,
    });
    expect(r.resposta.length).toBeGreaterThan(0);
    expect(http.post).not.toHaveBeenCalled();
  });
});

describe('MullerBotService.perguntar — limite de tokens', () => {
  it('bloqueia pergunta que sozinha estoura o limite de input', async () => {
    const http = makeHttp();
    const svc = new MullerBotService(
      http as never,
      makeEnv({ OPENAI_API_KEY: 'sk', MULLERBOT_MAX_INPUT_TOKENS: 100 }) as never,
      makeUserIntegracoes() as never,
      makeProdutoSearch() as never,
      makeCache() as never,
      makePersona() as never,
      makeIntegracoes() as never,
    );
    const perguntaLonga = 'x'.repeat(5000); // ~1250 tokens
    await expect(
      svc.perguntar(fakeUser(), { pergunta: perguntaLonga, topK: 5 }),
    ).rejects.toBeInstanceOf(BusinessRuleException);
    expect(http.post).not.toHaveBeenCalled();
  });

  it('inclui todos os produtos quando orçamento permite', async () => {
    const produtos = Array.from({ length: 3 }, (_, i) => ({
      ...PRODUTO_BASE,
      id: `p${i}`,
      nome: `Produto ${i}`,
      sku: `SKU-${i}`,
    }));
    const http = makeHttp();
    const svc = new MullerBotService(
      http as never,
      makeEnv({ OPENAI_API_KEY: 'sk', MULLERBOT_MAX_INPUT_TOKENS: 4000 }) as never,
      makeUserIntegracoes() as never,
      makeProdutoSearch(produtos) as never,
      makeCache() as never,
      makePersona() as never,
      makeIntegracoes() as never,
    );
    const r = await svc.perguntar(fakeUser(), { pergunta: 'tem isso?', topK: 5 });
    expect(r.produtosUsados).toHaveLength(3);
    expect(r.produtosTruncados).toBe(0);
  });

  it('trunca produtos quando orçamento de tokens é apertado', async () => {
    // Cria 10 produtos com descrição grande (~250 chars cada → ~62 tokens cada)
    const descricaoGrande = 'A'.repeat(500);
    const produtos = Array.from({ length: 10 }, (_, i) => ({
      ...PRODUTO_BASE,
      id: `p${i}`,
      nome: `Produto ${i}`,
      sku: `SKU-${i}`,
      descricao: descricaoGrande,
    }));
    const http = makeHttp();
    const svc = new MullerBotService(
      http as never,
      // Orçamento bem apertado: 500 tokens totais
      makeEnv({ OPENAI_API_KEY: 'sk', MULLERBOT_MAX_INPUT_TOKENS: 500 }) as never,
      makeUserIntegracoes() as never,
      makeProdutoSearch(produtos) as never,
      makeCache() as never,
      makePersona() as never,
      makeIntegracoes() as never,
    );
    const r = await svc.perguntar(fakeUser(), { pergunta: 'oi', topK: 10 });
    expect(r.produtosUsados.length).toBeLessThan(10);
    expect(r.produtosTruncados).toBeGreaterThan(0);
    expect(r.produtosUsados.length + r.produtosTruncados).toBe(10);
  });

  it('passa max_tokens pra OpenAI usando MULLERBOT_MAX_OUTPUT_TOKENS', async () => {
    const http = makeHttp();
    const svc = new MullerBotService(
      http as never,
      makeEnv({ OPENAI_API_KEY: 'sk', MULLERBOT_MAX_OUTPUT_TOKENS: 256 }) as never,
      makeUserIntegracoes() as never,
      makeProdutoSearch([PRODUTO_BASE]) as never,
      makeCache() as never,
      makePersona() as never,
      makeIntegracoes() as never,
    );
    await svc.perguntar(fakeUser(), { pergunta: 'oi', topK: 5 });
    const [, opts] = http.post.mock.calls[0] as [string, { body: { max_tokens: number } }];
    expect(opts.body.max_tokens).toBe(256);
  });

  it('usa max_completion_tokens (não max_tokens) pra modelos novos (gpt-5/série o)', async () => {
    const http = makeHttp();
    const svc = new MullerBotService(
      http as never,
      makeEnv({ OPENAI_API_KEY: 'sk', MULLERBOT_MAX_OUTPUT_TOKENS: 256 }) as never,
      makeUserIntegracoes() as never,
      makeProdutoSearch([PRODUTO_BASE]) as never,
      makeCache() as never,
      makePersona() as never,
      makeIntegracoes() as never,
    );
    await svc.perguntar(fakeUser(), { pergunta: 'oi', topK: 5, modelo: 'gpt-5.4-mini' });
    const [, opts] = http.post.mock.calls[0] as [
      string,
      { body: { max_completion_tokens?: number; max_tokens?: number } },
    ];
    expect(opts.body.max_completion_tokens).toBe(256);
    expect(opts.body.max_tokens).toBeUndefined();
  });

  it('respeita override de maxOutputTokens via DTO', async () => {
    const http = makeHttp();
    const svc = new MullerBotService(
      http as never,
      makeEnv({ OPENAI_API_KEY: 'sk' }) as never,
      makeUserIntegracoes() as never,
      makeProdutoSearch([PRODUTO_BASE]) as never,
      makeCache() as never,
      makePersona() as never,
      makeIntegracoes() as never,
    );
    await svc.perguntar(fakeUser(), { pergunta: 'oi', topK: 5, maxOutputTokens: 512 });
    const [, opts] = http.post.mock.calls[0] as [string, { body: { max_tokens: number } }];
    expect(opts.body.max_tokens).toBe(512);
  });
});

describe('MullerBotService.perguntar — montagem do prompt', () => {
  it('quando produtos vazios, instrui o LLM a admitir não encontrar', async () => {
    const http = makeHttp();
    const svc = new MullerBotService(
      http as never,
      makeEnv({ OPENAI_API_KEY: 'sk' }) as never,
      makeUserIntegracoes() as never,
      makeProdutoSearch([]) as never,
      makeCache() as never,
      makePersona() as never,
      makeIntegracoes() as never,
    );
    await svc.perguntar(fakeUser(), { pergunta: 'qual o preço?', topK: 5 });
    const [, opts] = http.post.mock.calls[0] as [
      string,
      { body: { messages: Array<{ content: string }> } },
    ];
    const userMsg = opts.body.messages[1].content; // [0]=system, [1]=user
    expect(userMsg).toContain('nenhum produto relevante');
  });

  it('inclui SKU + preço + descrição quando produto cabe no orçamento', async () => {
    const http = makeHttp();
    const svc = new MullerBotService(
      http as never,
      makeEnv({ OPENAI_API_KEY: 'sk', MULLERBOT_MAX_INPUT_TOKENS: 4000 }) as never,
      makeUserIntegracoes() as never,
      makeProdutoSearch([PRODUTO_BASE]) as never,
      makeCache() as never,
      makePersona() as never,
      makeIntegracoes() as never,
    );
    await svc.perguntar(fakeUser(), { pergunta: 'tem óleo?', topK: 5 });
    const [, opts] = http.post.mock.calls[0] as [
      string,
      { body: { messages: Array<{ content: string }> } },
    ];
    const userMsg = opts.body.messages[1].content;
    expect(userMsg).toContain('SKU OLE-GIR-5L');
    expect(userMsg).toContain('R$ 48.00');
    expect(userMsg).toContain('Óleo refinado em garrafa');
    expect(userMsg).toContain('Soya');
  });
});
