import { Injectable, Logger } from '@nestjs/common';
import { EnvService } from '@config/env.service';
import { PrismaService } from '@database/prisma.service';
import { UsuarioIntegracoesService } from '@modules/integracoes/usuario-integracoes.service';
import {
  ForbiddenException,
  IntegrationException,
  NotFoundException,
} from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { HttpClientService } from '@shared/http/http-client.service';
import { HttpClientError } from '@shared/http/http-client.types';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import type {
  AnalisarResultadoDto,
  GerarConteudoDto,
  OtimizarMensagemDto,
  SugerirSegmentoDto,
} from './campanhas.dto';

// ─── Tipos de retorno ──────────────────────────────────────────────────────────

export interface ConteudoGerado {
  mensagemWa: string | null;
  mensagemEmail: string | null;
  assunto: string | null;
  variacoes: Array<{ mensagemWa?: string; assunto?: string }>;
  dicas: string[];
  modelo: string;
  tokensIn?: number;
  tokensOut?: number;
}

export interface MensagemOtimizada {
  original: string;
  melhorada: string;
  variacoes: string[];
  dicas: string[];
  modelo: string;
}

export interface AnaliseResultado {
  resumoExecutivo: string;
  pontosFortes: string[];
  pontosAMelhorar: string[];
  recomendacoes: string[];
  proximasCampanhas: string[];
  scorePerformance: number; // 1–10
  modelo: string;
}

export interface SegmentoSugerido {
  justificativa: string;
  tagIds: string[];
  segmentosTextuais: string[];
  tonRecomendado: string;
  estimativaAlcance: number;
  melhorHorario: string;
  modelo: string;
}

// ─── Credenciais ──────────────────────────────────────────────────────────────

interface LlmCredenciais {
  apiKey: string;
  model?: string;
}

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class CampanhaIaService {
  private readonly logger = new Logger(CampanhaIaService.name);
  private static readonly CHARS_PER_TOKEN = 4;
  private static readonly DEFAULT_MODEL = 'gpt-4o-mini';

  constructor(
    private readonly prisma: PrismaService,
    private readonly http: HttpClientService,
    private readonly env: EnvService,
    private readonly userIntegracoes: UsuarioIntegracoesService,
  ) {}

  // ─── 1. Geração de conteúdo ──────────────────────────────────────────────

  async gerarConteudo(user: AuthenticatedUser, dto: GerarConteudoDto): Promise<ConteudoGerado> {
    const empresaId = this.requireEmpresa(user);
    const creds = await this.resolverCredenciais(user.id);
    const modelo =
      dto.modelo ??
      creds.model ??
      this.env.get('MULLERBOT_MODEL') ??
      CampanhaIaService.DEFAULT_MODEL;
    const perfil = await this.perfilEmpresa(empresaId);

    const systemPrompt = `Você é um especialista em marketing B2B para empresas de alimentos, bebidas, químicos e embalagens no Brasil.
Crie conteúdo de campanha de marketing que converte para WhatsApp e email corporativo.

REGRAS OBRIGATÓRIAS:
1. Português brasileiro profissional, linguagem acessível ao setor
2. WhatsApp: máximo 280 caracteres, sem markdown, SEM emojis excessivos (no máximo 1-2), chamada à ação clara
3. Email HTML: 2-3 parágrafos curtos, pode incluir {{cliente.nome}}, {{empresa.nome}} como variáveis
4. Inclua chamada à ação específica ao objetivo
5. Retorne SOMENTE JSON válido no formato abaixo, sem texto adicional`;

    const numVar = dto.numVariacoes ?? 2;
    const variacoesSchema =
      numVar > 0
        ? `"variacoes": [${Array(numVar).fill('{"mensagemWa":"...","assunto":"..."}').join(',')}],`
        : '"variacoes": [],';

    const userMessage = `
EMPRESA: ${perfil.nomeEmpresa}${perfil.ramo ? ` (${perfil.ramo})` : ''}
OBJETIVO DA CAMPANHA: ${dto.objetivo}
TOM: ${dto.tom}
CANAL: ${dto.canal}
${perfil.topProdutos.length > 0 ? `PRODUTOS PRINCIPAIS: ${perfil.topProdutos.join(', ')}` : ''}
${perfil.topSegmentos.length > 0 ? `SEGMENTOS DE CLIENTES: ${perfil.topSegmentos.join(', ')}` : ''}
TOTAL DE CLIENTES ATIVOS: ${perfil.totalClientes}

Retorne JSON exato:
{
  "mensagemWa": ${dto.canal !== 'EMAIL' ? '"mensagem para whatsapp"' : 'null'},
  "mensagemEmail": ${dto.canal !== 'WHATSAPP' ? '"<html>email html completo</html>"' : 'null'},
  "assunto": ${dto.canal !== 'WHATSAPP' ? '"assunto do email"' : 'null'},
  ${variacoesSchema}
  "dicas": ["dica 1", "dica 2", "dica 3"]
}`;

    const resultado = await this.chamarOpenAI(creds, systemPrompt, userMessage, modelo, 1500);
    type ConteudoSemMeta = Omit<ConteudoGerado, 'modelo' | 'tokensIn' | 'tokensOut'>;
    const parsed = this.parseJson<ConteudoSemMeta>(resultado.texto, {
      mensagemWa: null,
      mensagemEmail: null,
      assunto: null,
      variacoes: [],
      dicas: [],
    });

    this.logger.log(
      `IA gerou conteúdo para campanha · objetivo="${dto.objetivo.slice(0, 50)}" · modelo=${modelo}`,
    );
    return {
      ...parsed,
      modelo,
      tokensIn: resultado.tokensIn,
      tokensOut: resultado.tokensOut,
    };
  }

  // ─── 2. Otimização de mensagem ───────────────────────────────────────────

  async otimizarMensagem(
    user: AuthenticatedUser,
    dto: OtimizarMensagemDto,
  ): Promise<MensagemOtimizada> {
    const creds = await this.resolverCredenciais(user.id);
    const modelo = dto.modelo ?? creds.model ?? CampanhaIaService.DEFAULT_MODEL;

    const systemPrompt = `Você é um especialista em copywriting B2B para WhatsApp e email comercial no Brasil.
Sua tarefa é melhorar mensagens de campanha de marketing para aumentar taxa de resposta e conversão.
Retorne SOMENTE JSON válido, sem texto adicional.`;

    const canalInstr =
      dto.canal === 'WHATSAPP'
        ? 'WhatsApp (máximo 280 chars na versão melhorada, sem markdown)'
        : 'Email (pode usar formatação HTML básica)';

    const userMessage = `
CANAL: ${canalInstr}
${dto.objetivo ? `OBJETIVO: ${dto.objetivo}` : ''}
${dto.assunto ? `ASSUNTO ATUAL (email): ${dto.assunto}` : ''}

MENSAGEM ORIGINAL:
${dto.mensagem}

Retorne JSON exato:
{
  "melhorada": "versão melhorada da mensagem",
  "variacoes": ["variação A mais curta", "variação B mais urgente"],
  "dicas": [
    "explique o que foi melhorado e por quê converte mais",
    "dica específica para este tipo de campanha",
    "dica sobre timing ou segmentação"
  ]
}`;

    const resultado = await this.chamarOpenAI(creds, systemPrompt, userMessage, modelo, 800);
    const parsed = this.parseJson<{ melhorada: string; variacoes: string[]; dicas: string[] }>(
      resultado.texto,
      { melhorada: dto.mensagem, variacoes: [], dicas: [] },
    );

    return {
      original: dto.mensagem,
      melhorada: parsed.melhorada,
      variacoes: parsed.variacoes,
      dicas: parsed.dicas,
      modelo,
    };
  }

  // ─── 3. Análise de resultados ────────────────────────────────────────────

  async analisarResultado(
    user: AuthenticatedUser,
    campanhaId: string,
    dto: AnalisarResultadoDto,
  ): Promise<AnaliseResultado> {
    const empresaId = this.requireEmpresa(user);
    const creds = await this.resolverCredenciais(user.id);
    const modelo = dto.modelo ?? creds.model ?? CampanhaIaService.DEFAULT_MODEL;

    const campanha = await this.prisma.campanha.findFirst({
      where: { id: campanhaId, empresaId },
    });
    if (!campanha) throw new NotFoundException('Campanha', campanhaId);

    // Métricas de destinatários
    const grp = await this.prisma.campanhaDestinatario.groupBy({
      by: ['status'],
      where: { campanhaId },
      _count: { _all: true },
    });

    const byStatus: Record<string, number> = {};
    for (const g of grp) byStatus[g.status] = g._count._all;
    const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
    const enviados = (byStatus['ENVIADO'] ?? 0) + (byStatus['LIDO'] ?? 0);
    const lidos = byStatus['LIDO'] ?? 0;
    const erros = byStatus['ERRO'] ?? 0;

    const systemPrompt = `Você é um analista sênior de marketing digital B2B especializado em campanhas por WhatsApp e email.
Analise os resultados da campanha e forneça insights acionáveis para a equipe comercial.
Seja específico, prático e orientado a resultados. Retorne SOMENTE JSON válido.`;

    const userMessage = `
CAMPANHA: "${campanha.nome}"
OBJETIVO: ${campanha.objetivo ?? '(não informado)'}
CANAL: ${campanha.canal}
STATUS: ${campanha.status}

MÉTRICAS:
- Total destinatários: ${total}
- Enviados com sucesso: ${enviados} (${total > 0 ? Math.round((enviados / total) * 100) : 0}%)
- Lidos/abertos: ${lidos} (${enviados > 0 ? Math.round((lidos / enviados) * 100) : 0}%)
- Erros de entrega: ${erros} (${total > 0 ? Math.round((erros / total) * 100) : 0}%)
- Período de envio: ${campanha.iniciadoEm?.toLocaleDateString('pt-BR') ?? 'n/a'} a ${campanha.finalizadoEm?.toLocaleDateString('pt-BR') ?? 'em andamento'}

${campanha.mensagemWa ? `MENSAGEM WHATSAPP:\n${campanha.mensagemWa.slice(0, 300)}` : ''}
${campanha.assunto ? `ASSUNTO EMAIL: ${campanha.assunto}` : ''}

Retorne JSON exato:
{
  "resumoExecutivo": "parágrafo curto com avaliação geral",
  "pontosFortes": ["ponto 1", "ponto 2"],
  "pontosAMelhorar": ["ponto 1", "ponto 2"],
  "recomendacoes": ["ação concreta 1", "ação concreta 2", "ação concreta 3"],
  "proximasCampanhas": ["ideia de próxima campanha 1", "ideia 2"],
  "scorePerformance": 7
}`;

    const resultado = await this.chamarOpenAI(creds, systemPrompt, userMessage, modelo, 1000);
    const parsed = this.parseJson<Omit<AnaliseResultado, 'modelo'>>(resultado.texto, {
      resumoExecutivo: 'Análise indisponível.',
      pontosFortes: [],
      pontosAMelhorar: [],
      recomendacoes: [],
      proximasCampanhas: [],
      scorePerformance: 5,
    });

    this.logger.log(`IA analisou campanha "${campanha.nome}" · score=${parsed.scorePerformance}`);
    return { ...parsed, modelo };
  }

  // ─── 4. Sugestão de segmento ─────────────────────────────────────────────

  async sugerirSegmento(
    user: AuthenticatedUser,
    dto: SugerirSegmentoDto,
  ): Promise<SegmentoSugerido> {
    const empresaId = this.requireEmpresa(user);
    const creds = await this.resolverCredenciais(user.id);
    const modelo = dto.modelo ?? creds.model ?? CampanhaIaService.DEFAULT_MODEL;
    const perfil = await this.perfilEmpresa(empresaId);

    // Carrega tags disponíveis
    const tags = await this.prisma.tag.findMany({
      where: { clientes: { some: { cliente: { empresaId } } } },
      select: { id: true, nome: true },
      take: 30,
    });

    const systemPrompt = `Você é um especialista em segmentação de clientes B2B para equipes de vendas no Brasil.
Com base no perfil da empresa e nos dados dos clientes, sugira a melhor segmentação para o objetivo informado.
Retorne SOMENTE JSON válido.`;

    const userMessage = `
EMPRESA: ${perfil.nomeEmpresa}${perfil.ramo ? ` (${perfil.ramo})` : ''}
OBJETIVO DA CAMPANHA: ${dto.objetivo}
TOTAL CLIENTES ATIVOS: ${perfil.totalClientes}
SEGMENTOS EXISTENTES: ${perfil.topSegmentos.join(', ') || 'não identificados'}
PRODUTOS PRINCIPAIS: ${perfil.topProdutos.join(', ') || 'não identificados'}
TAGS DISPONÍVEIS: ${tags.map((t) => `${t.nome} (id:${t.id})`).join(', ') || 'nenhuma tag cadastrada'}

Retorne JSON exato:
{
  "justificativa": "explique por que este segmento é o mais adequado para o objetivo",
  "tagIds": ["id de tag 1 se relevante"],
  "segmentosTextuais": ["segmento 1", "segmento 2"],
  "tonRecomendado": "formal|amigavel|urgente|consultivo",
  "estimativaAlcance": 42,
  "melhorHorario": "ex: terça ou quarta-feira pela manhã, entre 9h e 11h"
}`;

    const resultado = await this.chamarOpenAI(creds, systemPrompt, userMessage, modelo, 600);
    const parsed = this.parseJson<Omit<SegmentoSugerido, 'modelo'>>(resultado.texto, {
      justificativa: 'Análise indisponível.',
      tagIds: [],
      segmentosTextuais: [],
      tonRecomendado: 'amigavel',
      estimativaAlcance: 0,
      melhorHorario: 'segunda a sexta, entre 9h e 11h',
    });

    // Valida que os tagIds retornados pela IA existem
    const tagIdsValidos = tags.map((t) => t.id);
    parsed.tagIds = parsed.tagIds.filter((id) => tagIdsValidos.includes(id));

    return { ...parsed, modelo };
  }

  // ─── 5. Personalização por cliente (chamado pelo Processor) ──────────────

  /**
   * Gera uma versão personalizada da mensagem para um cliente específico.
   * Chamado pelo CampanhaEnvioProcessor quando `usarIaPersonalizacao=true`.
   * Fail-safe: retorna o template original se IA falhar.
   */
  async personalizarMensagemCliente(params: {
    criadoPorId: string;
    templateWa: string | null;
    templateEmail: string | null;
    cliente: { nome: string; segmento: string | null; cidade: string | null; uf: string | null };
    objetivo: string | null;
    empresaNome: string;
  }): Promise<{ mensagemWa: string | null; mensagemEmail: string | null }> {
    try {
      const creds = await this.resolverCredenciais(params.criadoPorId);
      const modelo = creds.model ?? CampanhaIaService.DEFAULT_MODEL;

      const systemPrompt = `Você é um assistente de copywriting B2B. Personalize levemente a mensagem para o cliente específico.
Mantenha o conteúdo essencial, apenas adicione um toque personalizado natural (mencione nome, segmento ou cidade se relevante).
WhatsApp: máximo 300 chars. Retorne SOMENTE JSON.`;

      const userMessage = `
CLIENTE: ${params.cliente.nome}
${params.cliente.segmento ? `SEGMENTO: ${params.cliente.segmento}` : ''}
${params.cliente.cidade ? `LOCALIDADE: ${params.cliente.cidade}${params.cliente.uf ? `/${params.cliente.uf}` : ''}` : ''}
${params.objetivo ? `OBJETIVO: ${params.objetivo}` : ''}
EMPRESA REMETENTE: ${params.empresaNome}

${params.templateWa ? `TEMPLATE WHATSAPP:\n${params.templateWa}` : ''}
${params.templateEmail ? `TEMPLATE EMAIL (trecho):\n${params.templateEmail.slice(0, 300)}` : ''}

Retorne JSON: {"mensagemWa": "...", "mensagemEmail": "..."}`;

      const resultado = await this.chamarOpenAI(creds, systemPrompt, userMessage, modelo, 400);
      const parsed = this.parseJson<{ mensagemWa: string | null; mensagemEmail: string | null }>(
        resultado.texto,
        { mensagemWa: params.templateWa, mensagemEmail: params.templateEmail },
      );

      return {
        mensagemWa: parsed.mensagemWa ?? params.templateWa,
        mensagemEmail: parsed.mensagemEmail ?? params.templateEmail,
      };
    } catch (err) {
      // Fail-safe: retorna template sem personalização
      this.logger.warn(
        `IA personalização falhou para ${params.cliente.nome}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { mensagemWa: params.templateWa, mensagemEmail: params.templateEmail };
    }
  }

  // ─── Internos ────────────────────────────────────────────────────────────

  private requireEmpresa(user: AuthenticatedUser): string {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    return user.empresaIdAtiva;
  }

  /** Mesma política do MullerBot: ADMIN/DIRECTOR/GERENTE/SAC usam env como fallback. */
  private async resolverCredenciais(userId: string): Promise<LlmCredenciais> {
    try {
      const conn = await this.userIntegracoes.obterCredenciaisInternas(userId, 'openai');
      const c = conn.credenciais as { apiKey?: string; model?: string };
      if (c.apiKey) return { apiKey: c.apiKey, model: c.model };
    } catch {
      // sem chave do usuário → tenta env
    }
    const envKey = this.env.get('OPENAI_API_KEY');
    if (envKey) return { apiKey: envKey };
    throw new IntegrationException(
      'OpenAI não configurado. Conecte sua chave em /usuario/integracoes (servico=openai) ou defina OPENAI_API_KEY no ambiente.',
      ErrorCode.INTEGRATION_ERROR,
    );
  }

  /** Perfil resumido da empresa para enriquecer os prompts. */
  private async perfilEmpresa(empresaId: string): Promise<{
    nomeEmpresa: string;
    ramo: string | null;
    topProdutos: string[];
    topSegmentos: string[];
    totalClientes: number;
  }> {
    const [empresa, produtos, segmentos, totalClientes] = await Promise.all([
      this.prisma.empresa.findUnique({
        where: { id: empresaId },
        select: { nome: true, ramo: true },
      }),
      this.prisma.produto.findMany({
        where: { empresaId, ativo: true },
        orderBy: { popularidade: 'desc' },
        select: { nome: true },
        take: 8,
      }),
      this.prisma.cliente.groupBy({
        by: ['segmento'],
        where: { empresaId, omieStatus: 'ATIVO', segmento: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { segmento: 'desc' } },
        take: 5,
      }),
      this.prisma.cliente.count({ where: { empresaId, omieStatus: 'ATIVO' } }),
    ]);

    return {
      nomeEmpresa: empresa?.nome ?? 'Empresa',
      ramo: empresa?.ramo ?? null,
      topProdutos: produtos.map((p) => p.nome),
      topSegmentos: segmentos.map((s) => s.segmento).filter((s): s is string => s !== null),
      totalClientes,
    };
  }

  private async chamarOpenAI(
    creds: LlmCredenciais,
    systemPrompt: string,
    userMessage: string,
    modelo: string,
    maxTokens: number,
  ): Promise<{ texto: string; tokensIn?: number; tokensOut?: number }> {
    try {
      const res = await this.http.post<{
        choices: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      }>('https://api.openai.com/v1/chat/completions', {
        body: {
          model: modelo,
          max_tokens: maxTokens,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
        },
        headers: { Authorization: `Bearer ${creds.apiKey}` },
        integration: 'openai',
        redactKeys: ['authorization'],
        retries: 1,
        timeoutMs: 45_000,
      });
      const texto = (res.data.choices?.[0]?.message?.content ?? '').trim();
      return {
        texto: texto || '{}',
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

  /** Parse seguro de JSON — retorna fallback em caso de erro. */
  private parseJson<T>(texto: string, fallback: T): T {
    try {
      return JSON.parse(texto) as T;
    } catch {
      this.logger.warn(`IA retornou JSON inválido: ${texto.slice(0, 200)}`);
      return fallback;
    }
  }
}
