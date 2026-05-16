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
import { ProdutoSearchService, type ProdutoRelevante } from './produto-search.service';

const SYSTEM_PROMPT = `Você é o MullerBot, assistente comercial da Betinna.ai.

Responsabilidade: ajudar o representante comercial respondendo perguntas sobre o catálogo de produtos da empresa dele.

Regras OBRIGATÓRIAS:
1. Use APENAS o catálogo fornecido na mensagem do usuário. NÃO invente produtos, preços, especificações nem disponibilidade.
2. Se a pergunta não puder ser respondida com o catálogo fornecido, diga claramente: "Não encontrei essa informação no catálogo. Confirme com a equipe comercial."
3. Quando citar um produto, mencione nome + SKU (se disponível) entre parênteses. Ex: "Óleo de Girassol 5L (SKU OLE-GIR-5L)".
4. Mantenha respostas concisas e diretas — 2-4 parágrafos curtos no máximo.
5. NÃO repita o prompt nem mencione "catálogo fornecido" ou "MullerBot"; apenas responda naturalmente.
6. Responda em português brasileiro.`;

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
  ) {}

  async perguntar(user: AuthenticatedUser, dto: PerguntarDto): Promise<MullerBotResposta> {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException(
        'Empresa não definida',
        ErrorCode.TENANT_ACCESS_DENIED,
      );
    }
    const creds = await this.resolverCredenciais(user);
    const modelo = dto.modelo ?? creds.model ?? this.env.get('MULLERBOT_MODEL');
    const maxInputTokens = this.env.get('MULLERBOT_MAX_INPUT_TOKENS');
    const maxOutputTokens = dto.maxOutputTokens ?? this.env.get('MULLERBOT_MAX_OUTPUT_TOKENS');

    // 1. Busca produtos relevantes (top-K)
    const produtos = await this.produtoSearch.buscar(
      user.empresaIdAtiva,
      dto.pergunta,
      dto.topK,
    );

    // 2. Verifica orçamento: pergunta sozinha não pode estourar
    const overheadTokens =
      this.estimarTokens(SYSTEM_PROMPT) +
      this.estimarTokens(dto.pergunta) +
      SAFETY_MARGIN_TOKENS;
    if (overheadTokens >= maxInputTokens) {
      throw new BusinessRuleException(
        `Pergunta muito longa: estima ${overheadTokens} tokens, limite é ${maxInputTokens}. Reduza o texto.`,
      );
    }

    // 3. Monta user message respeitando orçamento — pode truncar catálogo
    const orcamentoCatalogo = maxInputTokens - overheadTokens;
    const {
      userMessage,
      produtosIncluidos,
      tokensEstimados,
      truncados,
    } = this.montarUserMessage(dto.pergunta, produtos, orcamentoCatalogo);

    // 4. Chama OpenAI
    const resultado = await this.chamarOpenAI(
      creds,
      modelo,
      userMessage,
      maxOutputTokens,
    );

    this.logger.log(
      `MullerBot resposta usuario=${user.id} modelo=${modelo} produtos=${produtosIncluidos.length}/${produtos.length} truncados=${truncados} tokens_in=${resultado.tokensIn ?? '?'} tokens_out=${resultado.tokensOut ?? '?'}`,
    );

    return {
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

  private formatarProduto(
    p: ProdutoRelevante,
    indice: number,
    incluirDescricao: boolean,
  ): string {
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
    userMessage: string,
    maxOutputTokens: number,
  ): Promise<{ texto: string; tokensIn?: number; tokensOut?: number }> {
    try {
      const res = await this.http.post<{
        choices: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      }>('https://api.openai.com/v1/chat/completions', {
        body: {
          model: modelo,
          max_tokens: maxOutputTokens,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userMessage },
          ],
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
