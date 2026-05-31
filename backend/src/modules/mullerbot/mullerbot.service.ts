import { Injectable, Logger } from '@nestjs/common';
import { EnvService } from '@config/env.service';
import { UsuarioIntegracoesService } from '@modules/integracoes/usuario-integracoes.service';
import {
  BusinessRuleException,
  ForbiddenException,
  IntegrationException,
} from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { HttpClientService } from '@shared/http/http-client.service';
import { HttpClientError } from '@shared/http/http-client.types';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import type { PerguntarDto } from './mullerbot.dto';
import type { LlmCredenciais, MullerBotResposta } from './mullerbot.types';
import { MullerBotCacheService, type HistoricoMsg } from './mullerbot-cache.service';
import { MullerBotPersonaService } from './persona.service';
import { ProdutoSearchService, type ProdutoRelevante } from './produto-search.service';

// SYSTEM_PROMPT agora vem do MullerBotPersonaService.compilarSystemPrompt
// (configurável por empresa via UI /mullerbot/persona).

/** Heurística simples: PT-BR ≈ 4 chars/token em GPT-4 tokenizer. Conservador. */
const CHARS_PER_TOKEN = 4;

/**
 * Espaço fixo reservado em tokens pra response + formatação JSON da API.
 * Garante margem mesmo quando a estimativa erra por baixo.
 */
const SAFETY_MARGIN_TOKENS = 200;

@Injectable()
export class MullerBotService {
  private readonly logger = new Logger(MullerBotService.name);

  constructor(
    private readonly http: HttpClientService,
    private readonly env: EnvService,
    private readonly userIntegracoes: UsuarioIntegracoesService,
    private readonly produtoSearch: ProdutoSearchService,
    private readonly cache: MullerBotCacheService,
    private readonly persona: MullerBotPersonaService,
  ) {}

  async perguntar(user: AuthenticatedUser, dto: PerguntarDto): Promise<MullerBotResposta> {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    const creds = await this.resolverCredenciais(user);
    const modelo = dto.modelo ?? creds.model ?? this.env.get('MULLERBOT_MODEL');
    const maxInputTokens = this.env.get('MULLERBOT_MAX_INPUT_TOKENS');
    const maxOutputTokens = dto.maxOutputTokens ?? this.env.get('MULLERBOT_MAX_OUTPUT_TOKENS');

    // 0. Compila system prompt usando persona ativa da empresa
    const systemPrompt = await this.persona.compilarSystemPrompt(user.empresaIdAtiva);

    // 1. Busca produtos relevantes (top-K)
    const produtos = await this.produtoSearch.buscar(user.empresaIdAtiva, dto.pergunta, dto.topK);

    // 2. Verifica orçamento: pergunta sozinha não pode estourar
    const overheadTokens =
      this.estimarTokens(systemPrompt) + this.estimarTokens(dto.pergunta) + SAFETY_MARGIN_TOKENS;
    if (overheadTokens >= maxInputTokens) {
      throw new BusinessRuleException(
        `Pergunta muito longa: estima ${overheadTokens} tokens, limite é ${maxInputTokens}. Reduza o texto.`,
      );
    }

    // 3. Monta user message respeitando orçamento — pode truncar catálogo
    const orcamentoCatalogo = maxInputTokens - overheadTokens;
    const { userMessage, produtosIncluidos, tokensEstimados, truncados } = this.montarUserMessage(
      dto.pergunta,
      produtos,
      orcamentoCatalogo,
    );

    // 4. Cache: tenta hit ANTES de gastar OpenAI.
    // Cache só vale pra perguntas SEM histórico — com histórico, mesmas perguntas
    // podem ter respostas diferentes dependendo do contexto anterior.
    const cacheKey =
      !dto.sessionId && !dto.semCache
        ? this.cache.buildAnswerKey({
            empresaId: user.empresaIdAtiva,
            modelo,
            pergunta: dto.pergunta,
            produtoIds: produtosIncluidos.map((p) => p.id),
          })
        : null;
    if (cacheKey) {
      const cached = await this.cache.getAnswer(cacheKey);
      if (cached) {
        this.logger.log(
          `MullerBot CACHE HIT usuario=${user.id} pergunta="${dto.pergunta.slice(0, 60)}"`,
        );
        return cached;
      }
    }

    // 5. Carrega histórico se sessionId fornecido
    const historico = dto.sessionId ? await this.cache.getHistorico(user.id, dto.sessionId) : [];

    // 6. Chama OpenAI (com histórico injetado, se houver)
    const resultado = await this.chamarOpenAI(
      creds,
      modelo,
      systemPrompt,
      userMessage,
      maxOutputTokens,
      historico,
    );

    this.logger.log(
      `MullerBot resposta usuario=${user.id} modelo=${modelo} produtos=${produtosIncluidos.length}/${produtos.length} truncados=${truncados} tokens_in=${resultado.tokensIn ?? '?'} tokens_out=${resultado.tokensOut ?? '?'} histTurns=${historico.length / 2}`,
    );

    const resposta: MullerBotResposta = {
      resposta: resultado.texto,
      produtosUsados: produtosIncluidos.map((p) => ({
        id: p.id,
        nome: p.nome,
        sku: p.sku,
        codigoOmie: p.codigoOmie,
        precoTabela: p.precoTabela,
        score: p.score,
      })),
      produtosTruncados: truncados,
      modelo,
      tokensInEstimados: tokensEstimados + overheadTokens,
      tokensIn: resultado.tokensIn,
      tokensOut: resultado.tokensOut,
    };

    // 7. Persiste cache + histórico (best-effort)
    if (cacheKey) {
      void this.cache.setAnswer(cacheKey, resposta);
    }
    if (dto.sessionId) {
      void this.cache.pushTurn(user.id, dto.sessionId, dto.pergunta, resultado.texto);
    }

    return resposta;
  }

  /**
   * Fase 2 — resposta automática do bot no WhatsApp da EMPRESA.
   *
   * Diferente de `perguntar`:
   *  - Credencial = chave OpenAI da empresa (env OPENAI_API_KEY), não a do rep.
   *  - Sem cache (cada conversa é única).
   *
   * Catálogo no contexto: HOJE o bot do WhatsApp roda em modo "puro conversa"
   * (sem catálogo/RAG) — só o prompt conversacional da persona + histórico.
   * O parâmetro `opts.incluirCatalogo` deixa o gancho pronto pra, no futuro,
   * injetar o catálogo (ou torná-lo "sob demanda", só quando a mensagem citar
   * produto) SEM reescrever este fluxo. Mantido desligado por padrão pra não
   * inflar tokens/custo enquanto não decidimos ligar.
   *
   * Retorna também `promptTokensAprox` (estimativa do tamanho do prompt enviado)
   * pra rastrear de onde vem o gasto — útil quando o catálogo for ligado.
   *
   * @param historico mensagens anteriores em ordem cronológica (user/assistant).
   */
  async responderComoEmpresa(
    empresaId: string,
    mensagemCliente: string,
    historico: HistoricoMsg[] = [],
    opts: { incluirCatalogo?: boolean } = {},
  ): Promise<{
    texto: string;
    tokensIn?: number;
    tokensOut?: number;
    promptTokensAprox: number;
    modelo: string;
    usouCatalogo: boolean;
    produtosIncluidos: number;
  }> {
    const apiKey = this.env.get('OPENAI_API_KEY');
    if (!apiKey) {
      throw new IntegrationException(
        'OPENAI_API_KEY não configurada — o bot do WhatsApp não pode responder.',
        ErrorCode.INTEGRATION_ERROR,
      );
    }
    // Modelo escolhido pela empresa (tela Persona Bot); senão o padrão do servidor.
    const modelo = (await this.persona.obterModelo(empresaId)) ?? this.env.get('MULLERBOT_MODEL');
    const maxOutputTokens = this.env.get('MULLERBOT_MAX_OUTPUT_TOKENS');

    // Liga o catálogo (RAG) quando pedido. Default = puro conversa.
    const usarCatalogo = opts.incluirCatalogo ?? false;

    let systemPrompt: string;
    let userMessage = mensagemCliente;
    let produtosIncluidos = 0;

    if (usarCatalogo) {
      // ── Modo RAG (pronto, ligado via env MULLERBOT_WHATSAPP_CATALOGO) ──
      // System prompt COM guardrails de catálogo (proíbe alucinação) + produtos
      // relevantes montados com orçamento de tokens (mesma lógica do perguntar()).
      systemPrompt = await this.persona.compilarSystemPrompt(empresaId);
      const maxInputTokens = this.env.get('MULLERBOT_MAX_INPUT_TOKENS');
      const produtos = await this.produtoSearch.buscar(empresaId, mensagemCliente);
      const overhead =
        this.estimarTokens(systemPrompt) +
        this.estimarTokens(mensagemCliente) +
        SAFETY_MARGIN_TOKENS;
      const orcamentoCatalogo = Math.max(0, maxInputTokens - overhead);
      const montado = this.montarUserMessage(mensagemCliente, produtos, orcamentoCatalogo);
      userMessage = montado.userMessage;
      produtosIncluidos = montado.produtosIncluidos.length;
    } else {
      // ── Modo puro conversa (atual): prompt conversacional, sem catálogo ──
      systemPrompt = await this.persona.compilarSystemPromptConversa(empresaId);
    }

    // Estimativa do tamanho do prompt (system + histórico + mensagem) — rastreia custo.
    const promptTokensAprox =
      this.estimarTokens(systemPrompt) +
      historico.reduce((acc, h) => acc + this.estimarTokens(h.content), 0) +
      this.estimarTokens(userMessage);

    const r = await this.chamarOpenAI(
      { apiKey },
      modelo,
      systemPrompt,
      userMessage,
      maxOutputTokens,
      historico,
    );
    return { ...r, promptTokensAprox, modelo, usouCatalogo: usarCatalogo, produtosIncluidos };
  }

  /**
   * Diagnóstico do bot do WhatsApp da empresa — usado pela tela Persona Bot.
   * Verifica se a `OPENAI_API_KEY` do servidor existe e faz um ping mínimo na
   * OpenAI pra confirmar que a chave responde. Nunca lança — retorna o status.
   */
  async diagnosticarBot(): Promise<{
    envKeyPresente: boolean;
    modelo: string;
    catalogoLigado: boolean;
    teste: { ok: boolean; erro?: string };
  }> {
    const envKey = this.env.get('OPENAI_API_KEY');
    const modelo = this.env.get('MULLERBOT_MODEL');
    const catalogoLigado = this.env.get('MULLERBOT_WHATSAPP_CATALOGO');
    if (!envKey) {
      return {
        envKeyPresente: false,
        modelo,
        catalogoLigado,
        teste: {
          ok: false,
          erro:
            'A OPENAI_API_KEY não está configurada no servidor (Railway). O bot do ' +
            'WhatsApp usa essa chave do ambiente — a chave cadastrada na tela de ' +
            'integrações não vale pra ele.',
        },
      };
    }
    try {
      await this.chamarOpenAI({ apiKey: envKey }, modelo, 'Responda só: ok', 'ping', 5, []);
      return { envKeyPresente: true, modelo, catalogoLigado, teste: { ok: true } };
    } catch (err) {
      const erro = err instanceof Error ? err.message : String(err);
      return { envKeyPresente: true, modelo, catalogoLigado, teste: { ok: false, erro } };
    }
  }

  /**
   * Lista os modelos de chat disponíveis na conta OpenAI (chave do servidor).
   * Usado pra popular o dropdown de modelo na tela Persona Bot — sempre reflete
   * o que a conta tem acesso (inclusive os mais novos). Nunca lança.
   */
  async listarModelos(): Promise<{ modelos: string[]; fonte: 'openai' | 'fallback' }> {
    const envKey = this.env.get('OPENAI_API_KEY');
    if (!envKey) return { modelos: [], fonte: 'fallback' };
    try {
      const res = await this.http.get<{ data?: Array<{ id: string }> }>(
        'https://api.openai.com/v1/models',
        {
          headers: { Authorization: `Bearer ${envKey}` },
          integration: 'openai',
          redactKeys: ['authorization'],
          timeoutMs: 15_000,
        },
      );
      const ids = (res.data.data ?? []).map((m) => m.id);
      const chat = ids.filter((id) => this.ehModeloChat(id)).sort((a, b) => b.localeCompare(a));
      return { modelos: chat, fonte: 'openai' };
    } catch {
      return { modelos: [], fonte: 'fallback' };
    }
  }

  /** Heurística: mantém só modelos de conversa (texto), tira áudio/imagem/embeddings/etc. */
  private ehModeloChat(id: string): boolean {
    const base = /^(gpt-|o[1-9]|chatgpt)/.test(id);
    const excluir =
      /(audio|realtime|transcribe|tts|whisper|embedding|image|dall|moderation|search|instruct|davinci|babbage)/.test(
        id,
      );
    return base && !excluir;
  }

  // ─── Histórico (acesso público pra controller) ────────────────────────

  async limparHistorico(user: AuthenticatedUser, sessionId: string): Promise<{ ok: true }> {
    return this.cache.limparHistorico(user.id, sessionId);
  }

  // ─── Credenciais (OpenAI only) ────────────────────────────────────────

  /**
   * Política de resolução de credenciais OpenAI:
   *  - REP: OBRIGADO a ter chave própria em `UsuarioIntegracao(servico=openai)`.
   *    Sem chave própria → erro com instrução pra conectar. Não há fallback
   *    pro env (cada rep usa o próprio crédito OpenAI).
   *  - ADMIN/DIRECTOR/GERENTE/SAC: usam chave própria se tiverem; senão,
   *    fallback pro `OPENAI_API_KEY` do env (chave corporativa).
   */
  private async resolverCredenciais(user: AuthenticatedUser): Promise<LlmCredenciais> {
    // 1. tenta credencial do usuário
    try {
      const conn = await this.userIntegracoes.obterCredenciaisInternas(user.id, 'openai');
      const c = conn.credenciais as { apiKey?: string; model?: string };
      if (c.apiKey) return { apiKey: c.apiKey, model: c.model };
    } catch {
      // se REP não configurou, vai cair no throw abaixo. Outros roles podem usar env.
    }

    if (user.role === 'REP') {
      throw new IntegrationException(
        'Para usar o MullerBot você precisa conectar sua chave OpenAI pessoal. ' +
          'Vá em Configurações → Integrações e cadastre uma chave do serviço "openai".',
        ErrorCode.INTEGRATION_ERROR,
      );
    }

    // 2. fallback env (apenas pra equipe interna)
    const envKey = this.env.get('OPENAI_API_KEY');
    if (envKey) return { apiKey: envKey };
    throw new IntegrationException(
      'OpenAI não configurado. Conecte sua chave em /usuario/integracoes (servico=openai) ou defina OPENAI_API_KEY no ambiente.',
      ErrorCode.INTEGRATION_ERROR,
    );
  }

  // ─── Montagem do prompt (com orçamento de tokens) ─────────────────────

  /**
   * Monta a mensagem do usuário com o máximo de produtos que cabe no orçamento.
   * Estratégia:
   *  1. Tenta inserir cada produto com descrição completa
   *  2. Se não couber, tenta versão sem descrição (mais compacta)
   *  3. Se ainda assim não couber, pula
   */
  private montarUserMessage(
    pergunta: string,
    produtos: ProdutoRelevante[],
    orcamentoTokens: number,
  ): {
    userMessage: string;
    produtosIncluidos: ProdutoRelevante[];
    tokensEstimados: number;
    truncados: number;
  } {
    if (produtos.length === 0) {
      const msg = `O catálogo da empresa não retornou nenhum produto relevante para a pergunta abaixo. Responda dizendo que não encontrou.\n\nPergunta: ${pergunta}`;
      return {
        userMessage: msg,
        produtosIncluidos: [],
        tokensEstimados: this.estimarTokens(msg),
        truncados: 0,
      };
    }

    const partes: string[] = [];
    const incluidos: ProdutoRelevante[] = [];
    let tokensCorpo = 0;
    let truncados = 0;

    for (let i = 0; i < produtos.length; i++) {
      const p = produtos[i];
      const completo = this.formatarProduto(p, incluidos.length + 1, true);
      const tCompleto = this.estimarTokens(completo);
      if (tokensCorpo + tCompleto <= orcamentoTokens) {
        partes.push(completo);
        incluidos.push(p);
        tokensCorpo += tCompleto;
        continue;
      }
      // Tenta versão compacta
      const compacto = this.formatarProduto(p, incluidos.length + 1, false);
      const tCompacto = this.estimarTokens(compacto);
      if (tokensCorpo + tCompacto <= orcamentoTokens) {
        partes.push(compacto);
        incluidos.push(p);
        tokensCorpo += tCompacto;
      } else {
        truncados++;
      }
    }

    const catalogo = partes.join('\n\n');
    const userMessage = `# Catálogo relevante para a pergunta\n${catalogo}\n\n# Pergunta\n${pergunta}`;
    return {
      userMessage,
      produtosIncluidos: incluidos,
      tokensEstimados: this.estimarTokens(userMessage),
      truncados,
    };
  }

  private formatarProduto(p: ProdutoRelevante, indice: number, incluirDescricao: boolean): string {
    const linhas: Array<string | null> = [
      `${indice}. ${p.nome}${p.sku ? ` (SKU ${p.sku})` : ''}`,
      p.marca ? `   Marca: ${p.marca}` : null,
      p.linha || p.categoria
        ? `   Categoria: ${[p.linha, p.categoria].filter(Boolean).join(' / ')}`
        : null,
      p.unidade ? `   Unidade: ${p.unidade}` : null,
      `   Preço de tabela: R$ ${p.precoTabela.toFixed(2)}`,
      incluirDescricao && p.descricao ? `   Descrição: ${p.descricao}` : null,
    ];
    return linhas.filter((l) => l !== null).join('\n');
  }

  /** Estimativa conservadora — chars / CHARS_PER_TOKEN, mínimo 1. */
  private estimarTokens(texto: string): number {
    return Math.max(1, Math.ceil(texto.length / CHARS_PER_TOKEN));
  }

  // ─── OpenAI call ──────────────────────────────────────────────────────

  private async chamarOpenAI(
    creds: LlmCredenciais,
    modelo: string,
    systemPrompt: string,
    userMessage: string,
    maxOutputTokens: number,
    historico: HistoricoMsg[] = [],
  ): Promise<{ texto: string; tokensIn?: number; tokensOut?: number }> {
    // Constrói array de mensagens: system + histórico (alternando user/assistant)
    // + pergunta atual. OpenAI espera ordem cronológica.
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
    ];
    for (const h of historico) {
      messages.push({ role: h.role, content: h.content });
    }
    messages.push({ role: 'user', content: userMessage });

    try {
      const res = await this.http.post<{
        choices: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      }>('https://api.openai.com/v1/chat/completions', {
        body: {
          model: modelo,
          max_tokens: maxOutputTokens,
          messages,
        },
        headers: { Authorization: `Bearer ${creds.apiKey}` },
        integration: 'openai',
        redactKeys: ['authorization', 'api_key'],
        retries: 1,
        timeoutMs: 60_000,
      });
      const texto = (res.data.choices?.[0]?.message?.content ?? '').trim();
      return {
        texto: texto || '(resposta vazia)',
        tokensIn: res.data.usage?.prompt_tokens,
        tokensOut: res.data.usage?.completion_tokens,
      };
    } catch (err) {
      if (err instanceof HttpClientError) {
        const detail =
          typeof err.body === 'object' && err.body !== null
            ? JSON.stringify(err.body).slice(0, 400)
            : String(err.body ?? '').slice(0, 400);
        throw new IntegrationException(
          `OpenAI HTTP ${err.status}: ${detail}`,
          ErrorCode.INTEGRATION_ERROR,
        );
      }
      throw err instanceof Error ? err : new Error(String(err));
    }
  }
}
