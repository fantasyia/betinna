import { Injectable, Logger } from '@nestjs/common';
import { EnvService } from '@config/env.service';
import { UsuarioIntegracoesService } from '@modules/integracoes/usuario-integracoes.service';
import { IntegracoesService } from '@modules/integracoes/integracoes.service';
import {
  KnowledgeSearchService,
  type ConhecimentoRelevante,
} from '@modules/rag/knowledge-search.service';
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
import { BotCustoService } from './bot-custo.service';
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
/** Custo fixo aproximado de uma imagem no orçamento (gpt-4o vision, tile padrão ~765 tk). */
const IMAGE_TOKENS_APROX = 765;

/**
 * Lista de reserva pro dropdown de modelo quando a OpenAI não lista (chave sem
 * permissão de /models, falha de rede, etc). Evita dropdown vazio. A lista real
 * vem ao vivo da conta quando a chamada funciona.
 */
const MODELOS_FALLBACK = [
  'gpt-5',
  'gpt-5-mini',
  'gpt-5-nano',
  'gpt-4.1',
  'gpt-4.1-mini',
  'gpt-4.1-nano',
  'gpt-4o',
  'gpt-4o-mini',
  'o4-mini',
  'o3-mini',
  'gpt-3.5-turbo',
];

/**
 * Instrução (anexada ao system prompt) que faz a IA quebrar a resposta em
 * vários balões curtos de WhatsApp. Pede LINHA EM BRANCO entre as mensagens
 * (parágrafos) — que os modelos seguem de forma confiável — e o muller-whatsapp
 * .service divide nesse sinal (e também no "|||", caso o modelo use). O envio
 * real (split + digitando + pausa por balão) é feito lá.
 */
function instrucaoQuebra(max: number): string {
  return [
    '## Formato da resposta no WhatsApp',
    'Você conversa pelo WhatsApp, onde as pessoas mandam várias mensagens curtas em sequência — não um textão único.',
    `Quando a resposta tiver mais de uma ideia, quebre em mensagens curtas e separe CADA uma com uma LINHA EM BRANCO (um parágrafo por mensagem). Use no máximo ${max} mensagens.`,
    'Regras:',
    '- Resposta simples (saudação, "sim", uma única frase): mande UMA mensagem só.',
    '- Cada mensagem curta e natural, como um balãozinho de WhatsApp.',
    '- Não repita a saudação em cada mensagem. Não force a quebra: só quebre quando deixar a conversa mais natural.',
  ].join('\n');
}

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
    private readonly integracoes: IntegracoesService,
    private readonly custo: BotCustoService,
    private readonly conhecimentoSearch: KnowledgeSearchService,
  ) {}

  /**
   * Resolve a chave OpenAI da EMPRESA (escopo empresa): primeiro a integração
   * configurada no app (IntegracaoConexao servico='openai', cifrada — lida tanto
   * pela api quanto pelo worker), senão a `OPENAI_API_KEY` do ambiente (Railway).
   */
  private async resolverChaveEmpresa(empresaId: string): Promise<string | undefined> {
    try {
      const conn = await this.integracoes.obterCredenciaisInternas(empresaId, 'openai');
      const k = (conn.credenciais as { apiKey?: string }).apiKey;
      if (k && k.trim()) return k.trim();
    } catch {
      // Empresa não configurou OpenAI no app — cai pro env (Railway).
    }
    return this.env.get('OPENAI_API_KEY') || undefined;
  }

  /**
   * Credenciais LLM pro bot INTERNO da empresa (chat do rep + WhatsApp): usa a
   * chave da EMPRESA (resolverChaveEmpresa). A chave PESSOAL do usuário NÃO entra
   * aqui — ela é só pro bot pessoal do rep. Mock em MULLERBOT_MOCK.
   */
  private async resolverCredenciaisEmpresa(empresaId: string): Promise<LlmCredenciais> {
    if (this.env.get('MULLERBOT_MOCK')) return { apiKey: 'mock' };
    const apiKey = await this.resolverChaveEmpresa(empresaId);
    if (!apiKey) {
      throw new IntegrationException(
        'A empresa não tem chave OpenAI configurada. O DIRETOR precisa cadastrá-la em ' +
          'Integrações (escopo empresa) — é a chave que o assistente usa.',
        ErrorCode.INTEGRATION_ERROR,
      );
    }
    return { apiKey };
  }

  async perguntar(user: AuthenticatedUser, dto: PerguntarDto): Promise<MullerBotResposta> {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    // O bot INTERNO da empresa (rep tira dúvidas de produto/regras/FAQ) usa a chave
    // da EMPRESA — a chave pessoal do rep é só pro bot pessoal dele, nada da empresa.
    const creds = await this.resolverCredenciaisEmpresa(user.empresaIdAtiva);
    const modelo =
      dto.modelo ??
      (await this.persona.obterModelo(user.empresaIdAtiva)) ??
      this.env.get('MULLERBOT_MODEL');
    const maxInputTokens = this.env.get('MULLERBOT_MAX_INPUT_TOKENS');
    const maxOutputTokens = dto.maxOutputTokens ?? this.env.get('MULLERBOT_MAX_OUTPUT_TOKENS');

    // 0. Compila system prompt usando persona ativa da empresa
    const systemPrompt = await this.persona.compilarSystemPrompt(user.empresaIdAtiva);

    // 1. Busca produtos relevantes (top-K) + base de CONHECIMENTO (FAQ, regras,
    // condições, prazos, devolução…). O bot interno responde dos DOIS: catálogo
    // pra "tem tal produto?" e conhecimento pra "qual a política de X?".
    const [produtos, chunks] = await Promise.all([
      this.produtoSearch.buscar(user.empresaIdAtiva, dto.pergunta, dto.topK),
      this.conhecimentoSearch
        .buscar(user.empresaIdAtiva, dto.pergunta, 4)
        .catch(() => [] as ConhecimentoRelevante[]),
    ]);
    const blocoConhecimento = this.formatarConhecimento(chunks);

    // Histórico carregado ANTES do orçamento — senão a estimativa ignora os turns anteriores
    // e a truncagem do catálogo fica otimista demais (risco de estourar o context window).
    const historico = dto.sessionId ? await this.cache.getHistorico(user.id, dto.sessionId) : [];
    const tokensHistorico = historico.reduce((acc, h) => acc + this.estimarTokens(h.content), 0);

    // 2. Verifica orçamento: pergunta + histórico + conhecimento não podem estourar
    const overheadTokens =
      this.estimarTokens(systemPrompt) +
      this.estimarTokens(dto.pergunta) +
      this.estimarTokens(blocoConhecimento) +
      tokensHistorico +
      SAFETY_MARGIN_TOKENS;
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
      blocoConhecimento,
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

    // 4.5 Teto de custo do tenant ANTES de gastar OpenAI — senão um insider (ou credencial
    // vazada) queima crédito via /mullerbot/perguntar até a fatura. Cache hit acima é grátis e
    // não passa por aqui.
    const teto = await this.custo.verificarTeto(user.empresaIdAtiva);
    if (teto.bloqueado) {
      throw new BusinessRuleException(
        teto.motivo ?? 'Teto de custo de IA do mês atingido para esta empresa',
        ErrorCode.BUSINESS_RULE_VIOLATION,
      );
    }

    // 5. Chama OpenAI (com histórico injetado, se houver — já carregado acima p/ o orçamento)
    const resultado = await this.chamarOpenAI(
      creds,
      modelo,
      systemPrompt,
      userMessage,
      maxOutputTokens,
      historico,
    );
    void this.custo.registrarUso(
      user.empresaIdAtiva,
      resultado.tokensIn ?? 0,
      resultado.tokensOut ?? 0,
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
    opts: {
      incluirCatalogo?: boolean;
      quebrarMensagens?: boolean;
      maxMensagens?: number;
      /** Imagem (data URL base64) pra visão da IA — quando o cliente manda foto. */
      imagemDataUrl?: string;
    } = {},
  ): Promise<{
    texto: string;
    tokensIn?: number;
    tokensOut?: number;
    promptTokensAprox: number;
    modelo: string;
    usouCatalogo: boolean;
    produtosIncluidos: number;
  }> {
    const apiKey = await this.resolverChaveEmpresa(empresaId);
    if (!apiKey) {
      throw new IntegrationException(
        'OpenAI não configurada — defina a chave da empresa em Integrações (ou OPENAI_API_KEY no ambiente). O bot do WhatsApp não pode responder.',
        ErrorCode.INTEGRATION_ERROR,
      );
    }
    // Modelo: pra IMAGEM usa o modelo de VISÃO (o de chat pode não enxergar);
    // senão, o escolhido pela empresa (tela Persona Bot) ou o padrão do servidor.
    const modelo = opts.imagemDataUrl
      ? this.env.get('MULLERBOT_VISION_MODEL')
      : ((await this.persona.obterModelo(empresaId)) ?? this.env.get('MULLERBOT_MODEL'));
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
        // Imagem consome tokens de visão que o estimador de texto ignora — conta o custo fixo
        // pra a truncagem do catálogo não estourar o context window quando vem foto.
        (opts.imagemDataUrl ? IMAGE_TOKENS_APROX : 0) +
        SAFETY_MARGIN_TOKENS;
      const orcamentoCatalogo = Math.max(0, maxInputTokens - overhead);
      const montado = this.montarUserMessage(mensagemCliente, produtos, orcamentoCatalogo);
      userMessage = montado.userMessage;
      produtosIncluidos = montado.produtosIncluidos.length;
    } else {
      // ── Modo puro conversa (atual): prompt conversacional, sem catálogo ──
      systemPrompt = await this.persona.compilarSystemPromptConversa(empresaId);
    }

    // Quebra de resposta em vários balões (mais humano). Só no WhatsApp — a IA
    // separa as mensagens com "|||" e o muller-whatsapp.service divide no envio.
    if (opts.quebrarMensagens) {
      systemPrompt += '\n\n' + instrucaoQuebra(opts.maxMensagens ?? 3);
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
      opts.imagemDataUrl,
    );
    return { ...r, promptTokensAprox, modelo, usouCatalogo: usarCatalogo, produtosIncluidos };
  }

  /**
   * Orquestração (Fase B) — gera uma resposta com um SYSTEM PROMPT arbitrário
   * (o prompt escolhido no nó "Conversar com IA"), usando a chave OpenAI do
   * servidor. Respeita MULLERBOT_MOCK. Retorna texto + tokens + modelo usado.
   */
  async gerarRespostaIa(
    empresaId: string,
    systemPrompt: string,
    mensagem: string,
    historico: HistoricoMsg[] = [],
    imagemDataUrl?: string,
  ): Promise<{ texto: string; tokensIn?: number; tokensOut?: number; modelo: string }> {
    const apiKey = await this.resolverChaveEmpresa(empresaId);
    if (!apiKey) {
      throw new IntegrationException(
        'OpenAI não configurada — defina a chave da empresa em Integrações (ou OPENAI_API_KEY no ambiente). O nó "Conversar com IA" não pode rodar.',
        ErrorCode.INTEGRATION_ERROR,
      );
    }
    const modelo = (await this.persona.obterModelo(empresaId)) ?? this.env.get('MULLERBOT_MODEL');
    const maxOutputTokens = this.env.get('MULLERBOT_MAX_OUTPUT_TOKENS');
    const r = await this.chamarOpenAI(
      { apiKey },
      modelo,
      systemPrompt,
      mensagem,
      maxOutputTokens,
      historico,
      // Visão: quando o lead manda foto no fluxo (e "analisar imagem" está ligado).
      imagemDataUrl,
    );
    return { ...r, modelo };
  }

  /**
   * Transcreve um áudio recebido (voz → texto) via OpenAI. Usa a chave da
   * empresa. Modelo configurável (MULLERBOT_TRANSCRIBE_MODEL, default whisper-1).
   * Multipart via fetch nativo (o HttpClient é JSON-only). Retorna o texto.
   */
  async transcreverAudio(empresaId: string, audio: Buffer, mime: string): Promise<string> {
    if (this.env.get('MULLERBOT_MOCK')) return '(transcrição de teste)';
    const apiKey = await this.resolverChaveEmpresa(empresaId);
    if (!apiKey) {
      throw new IntegrationException(
        'OpenAI não configurada — não dá pra transcrever o áudio.',
        ErrorCode.INTEGRATION_ERROR,
      );
    }
    const modelo = this.env.get('MULLERBOT_TRANSCRIBE_MODEL');
    // Extensão coerente com o mime (WhatsApp manda voz em ogg/opus).
    const m = (mime || '').toLowerCase();
    const ext =
      m.includes('mpeg') || m.includes('mp3')
        ? 'mp3'
        : m.includes('wav')
          ? 'wav'
          : m.includes('m4a') || m.includes('mp4')
            ? 'm4a'
            : m.includes('webm')
              ? 'webm'
              : 'ogg';
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(audio)], { type: mime || 'audio/ogg' }),
      `audio.${ext}`,
    );
    form.append('model', modelo);
    form.append('language', 'pt');
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!res.ok) {
      const corpo = await res.text().catch(() => '');
      throw new IntegrationException(
        `Transcrição falhou (HTTP ${res.status}): ${corpo.slice(0, 200)}`,
        ErrorCode.INTEGRATION_ERROR,
      );
    }
    const data = (await res.json()) as { text?: string };
    return (data.text ?? '').trim();
  }

  /**
   * Diagnóstico do bot do WhatsApp da empresa — usado pela tela Persona Bot.
   * Verifica se a `OPENAI_API_KEY` do servidor existe e faz um ping mínimo na
   * OpenAI pra confirmar que a chave responde. Nunca lança — retorna o status.
   */
  async diagnosticarBot(empresaId?: string): Promise<{
    envKeyPresente: boolean;
    empresaKeyPresente: boolean;
    fonte: 'empresa' | 'env' | 'nenhuma';
    modelo: string;
    catalogoLigado: boolean;
    teste: { ok: boolean; erro?: string };
  }> {
    const envKey = this.env.get('OPENAI_API_KEY');
    // Pinga o MESMO modelo que o bot usa de verdade (o da persona da empresa),
    // não o padrão do env — senão o teste passa com gpt-4o-mini enquanto o bot
    // falha com o modelo escolhido (ex: gpt-5.4-mini). Reflete a realidade.
    const modelo =
      (empresaId ? await this.persona.obterModelo(empresaId) : null) ??
      this.env.get('MULLERBOT_MODEL');
    const catalogoLigado = this.env.get('MULLERBOT_WHATSAPP_CATALOGO');

    // A empresa tem chave PRÓPRIA (tela Integrações, escopo empresa)? Essa tem
    // precedência sobre o env — é exatamente o que o bot usa em runtime.
    let empresaKeyPresente = false;
    if (empresaId) {
      try {
        const conn = await this.integracoes.obterCredenciaisInternas(empresaId, 'openai');
        empresaKeyPresente = !!(conn.credenciais as { apiKey?: string }).apiKey?.trim();
      } catch {
        empresaKeyPresente = false; // não configurada/inativa → cai pro env
      }
    }

    // Chave EFETIVA que o bot vai usar (mesma lógica do resolverChaveEmpresa).
    const chave = empresaId ? await this.resolverChaveEmpresa(empresaId) : envKey || undefined;
    const fonte: 'empresa' | 'env' | 'nenhuma' = empresaKeyPresente
      ? 'empresa'
      : envKey
        ? 'env'
        : 'nenhuma';

    if (!chave) {
      return {
        envKeyPresente: !!envKey,
        empresaKeyPresente,
        fonte,
        modelo,
        catalogoLigado,
        teste: {
          ok: false,
          erro:
            'Nenhuma chave OpenAI ativa pra esta empresa. Configure a chave em ' +
            'Integrações (escopo empresa, como DIRECTOR) — é a que o bot usa — ou ' +
            'a OPENAI_API_KEY no servidor (Railway, serviços api e worker).',
        },
      };
    }
    try {
      await this.chamarOpenAI({ apiKey: chave }, modelo, 'Responda só: ok', 'ping', 5, []);
      return {
        envKeyPresente: !!envKey,
        empresaKeyPresente,
        fonte,
        modelo,
        catalogoLigado,
        teste: { ok: true },
      };
    } catch (err) {
      const erro = err instanceof Error ? err.message : String(err);
      return {
        envKeyPresente: !!envKey,
        empresaKeyPresente,
        fonte,
        modelo,
        catalogoLigado,
        teste: { ok: false, erro },
      };
    }
  }

  /**
   * Lista os modelos de chat disponíveis na chave OpenAI da EMPRESA — a MESMA que
   * o bot usa em runtime (IntegracaoConexao escopo empresa, senão OPENAI_API_KEY do
   * env). Popula o dropdown de modelo nas telas Persona/Prompts (config de empresa).
   * NÃO usa a chave PESSOAL do usuário: essa é só pro chatbot pessoal do rep e não
   * tem nada a ver com o modelo que a empresa escolhe. NUNCA lança e NUNCA volta
   * vazio: se a chamada falhar, devolve uma lista curada de reserva.
   */
  async listarModelos(user: AuthenticatedUser): Promise<{
    modelos: string[];
    fonte: 'openai' | 'fallback';
    /** Quando fonte='fallback', explica o PORQUÊ (pra UI orientar o usuário).
     *  sem_permissao_modelos = chave VÁLIDA (bot funciona) mas sem escopo de
     *  listar modelos (project key restrita → 401 só no GET /models). */
    motivo?: 'sem_chave' | 'mock' | 'erro_openai' | 'sem_modelos_chat' | 'sem_permissao_modelos';
  }> {
    // Chave da EMPRESA (a que o bot usa) — NÃO a pessoal do usuário.
    const empresaId = user.empresaIdAtiva;
    const apiKey = empresaId ? await this.resolverChaveEmpresa(empresaId) : undefined;
    if (!apiKey) {
      return { modelos: [...MODELOS_FALLBACK], fonte: 'fallback', motivo: 'sem_chave' };
    }
    if (apiKey === 'mock') {
      // MULLERBOT_MOCK ativo → não há chamada real; lista de reserva.
      return { modelos: [...MODELOS_FALLBACK], fonte: 'fallback', motivo: 'mock' };
    }
    try {
      const res = await this.http.get<{ data?: Array<{ id: string }> }>(
        'https://api.openai.com/v1/models',
        {
          headers: { Authorization: `Bearer ${apiKey}` },
          integration: 'openai',
          redactKeys: ['authorization'],
          timeoutMs: 15_000,
        },
      );
      const ids = (res.data.data ?? []).map((m) => m.id);
      const chat = ids.filter((id) => this.ehModeloChat(id)).sort((a, b) => b.localeCompare(a));
      if (chat.length) return { modelos: chat, fonte: 'openai' };
      this.logger.warn(
        `listarModelos: OpenAI respondeu mas sem modelos de chat (${ids.length} ids no total).`,
      );
      return { modelos: [...MODELOS_FALLBACK], fonte: 'fallback', motivo: 'sem_modelos_chat' };
    } catch (err) {
      // Não some com o erro: loga pra dar pra diagnosticar por que caiu no fallback.
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`listarModelos: falha ao listar da OpenAI (fallback): ${msg}`);
      // 401 no GET /models = chave restrita: funciona pro bot (chat) mas sem
      // escopo "Models: Read". Distingue de chave inválida/erro genérico.
      const motivo =
        err instanceof HttpClientError && err.status === 401
          ? 'sem_permissao_modelos'
          : 'erro_openai';
      return { modelos: [...MODELOS_FALLBACK], fonte: 'fallback', motivo };
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
    // Modo mock (E2E/dev): não exige chave real — a chamada à OpenAI é
    // curto-circuitada em chamarOpenAI. Permite testar o bot até como REP.
    if (this.env.get('MULLERBOT_MOCK')) {
      return { apiKey: 'mock' };
    }

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
  /** Formata os chunks da base de conhecimento (FAQ/regras) num bloco de contexto. */
  private formatarConhecimento(chunks: ConhecimentoRelevante[]): string {
    if (!chunks.length) return '';
    const linhas = chunks.map((c) => `- ${c.titulo}: ${c.conteudo}`);
    return `# Informações da empresa (regras, condições, FAQ)\n${linhas.join('\n')}`;
  }

  private montarUserMessage(
    pergunta: string,
    produtos: ProdutoRelevante[],
    orcamentoTokens: number,
    conhecimento = '',
  ): {
    userMessage: string;
    produtosIncluidos: ProdutoRelevante[];
    tokensEstimados: number;
    truncados: number;
  } {
    // Sem produtos MAS com conhecimento (ex.: "qual a política de devolução?"):
    // responde da base de conhecimento em vez de dizer "não encontrei".
    if (produtos.length === 0) {
      const msg = conhecimento
        ? `${conhecimento}\n\n# Pergunta\n${pergunta}`
        : `O catálogo da empresa não retornou nenhum produto relevante para a pergunta abaixo. Responda dizendo que não encontrou.\n\nPergunta: ${pergunta}`;
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
    const prefixoConhecimento = conhecimento ? `${conhecimento}\n\n` : '';
    const userMessage = `${prefixoConhecimento}# Catálogo relevante para a pergunta\n${catalogo}\n\n# Pergunta\n${pergunta}`;
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

  /** Respostas fake do modo MULLERBOT_MOCK (E2E/dev) — não chamam a OpenAI. */
  private static readonly MOCK_RESPOSTAS = [
    'Recebi sua mensagem! Já te respondo com os detalhes. 😊',
    'Boa pergunta — deixa eu consultar aqui e já te retorno.',
    'Obrigado pelo contato! Um representante vai dar sequência pra você.',
    'Anotado! Posso te ajudar com mais alguma coisa?',
    'Entendi seu pedido. Estou verificando a disponibilidade.',
    'Certo! Deixa eu checar essas informações pra você.',
    'Perfeito, recebido. Retorno em instantes com a resposta.',
    'Show! Já estou providenciando isso pra você.',
  ];

  /** Escolhe uma resposta fake aleatória (modo mock). */
  private static mockResposta(): string {
    const arr = MullerBotService.MOCK_RESPOSTAS;
    return arr[Math.floor(Math.random() * arr.length)];
  }

  private async chamarOpenAI(
    creds: LlmCredenciais,
    modelo: string,
    systemPrompt: string,
    userMessage: string,
    maxOutputTokens: number,
    historico: HistoricoMsg[] = [],
    imagemDataUrl?: string,
  ): Promise<{ texto: string; tokensIn?: number; tokensOut?: number }> {
    // Modo mock (E2E/dev): devolve resposta fake sem chamar a OpenAI. Ligado via
    // MULLERBOT_MOCK=true. Em produção (flag off) o fluxo segue normal.
    if (this.env.get('MULLERBOT_MOCK')) {
      const texto = MullerBotService.mockResposta();
      const tokensIn =
        this.estimarTokens(systemPrompt) +
        this.estimarTokens(userMessage) +
        historico.reduce((acc, h) => acc + this.estimarTokens(h.content), 0);
      this.logger.log('MullerBot MOCK ativo — resposta fake (sem chamar OpenAI)');
      return { texto, tokensIn, tokensOut: this.estimarTokens(texto) };
    }

    // Constrói array de mensagens: system + histórico (alternando user/assistant)
    // + pergunta atual. OpenAI espera ordem cronológica.
    // Pra VISÃO, o content da última msg vira array [texto, imagem] (formato OpenAI).
    type ContentPart =
      | { type: 'text'; text: string }
      | { type: 'image_url'; image_url: { url: string } };
    const messages: Array<{
      role: 'system' | 'user' | 'assistant';
      content: string | ContentPart[];
    }> = [{ role: 'system', content: systemPrompt }];
    for (const h of historico) {
      messages.push({ role: h.role, content: h.content });
    }
    const userContent: string | ContentPart[] = imagemDataUrl
      ? [
          {
            type: 'text',
            text: userMessage || 'O cliente enviou esta imagem. Responda sobre ela.',
          },
          { type: 'image_url', image_url: { url: imagemDataUrl } },
        ]
      : userMessage;
    messages.push({ role: 'user', content: userContent });

    // Modelos novos (série `o` e `gpt-5+`) NÃO aceitam `max_tokens` no
    // chat/completions — exigem `max_completion_tokens`. Os antigos (gpt-4o,
    // gpt-4, gpt-3.5) usam `max_tokens`. Mandar o parâmetro errado → HTTP 400 e
    // o bot caía no fallback (ex: gpt-5.4-mini). Escolhe pelo nome do modelo e
    // auto-corrige refazendo com o outro parâmetro se a OpenAI reclamar.
    const usaMaxCompletion = /^(o\d|gpt-[5-9])/i.test(modelo);
    const enviar = (maxCompletion: boolean) =>
      this.http.post<{
        choices: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      }>('https://api.openai.com/v1/chat/completions', {
        body: {
          model: modelo,
          ...(maxCompletion
            ? { max_completion_tokens: maxOutputTokens }
            : { max_tokens: maxOutputTokens }),
          messages,
        },
        headers: { Authorization: `Bearer ${creds.apiKey}` },
        integration: 'openai',
        redactKeys: ['authorization', 'api_key'],
        retries: 1,
        timeoutMs: 60_000,
      });

    try {
      const res = await enviar(usaMaxCompletion).catch((e: unknown) => {
        const reclamouDoParam =
          e instanceof HttpClientError &&
          e.status === 400 &&
          /max_completion_tokens|max_tokens/i.test(JSON.stringify(e.body ?? ''));
        if (reclamouDoParam) {
          this.logger.warn(
            `[openai] modelo ${modelo} recusou o parâmetro de tokens — refazendo com ${usaMaxCompletion ? 'max_tokens' : 'max_completion_tokens'}`,
          );
          return enviar(!usaMaxCompletion);
        }
        throw e;
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
