import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { RedisService } from '@database/redis.service';
import {
  BusinessRuleException,
  ForbiddenException,
  NotFoundException,
} from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { type Paginated, buildPaginated } from '@shared/types/pagination';
import { WhatsAppMediaService } from '@integrations/whatsapp/whatsapp-media.service';
import { FluxoEventBusService } from './fluxo-event-bus.service';
import { validarCronExpr } from './cron.util';
import type {
  CreateFluxoDto,
  UpdateFluxoDto,
  ListFluxosDto,
  ListExecucoesDto,
  TestarFluxoDto,
  ImportFluxoDto,
  UploadFluxoMidiaDto,
  DefinirGatilhoDto,
} from './fluxos.dto';

/** Fluxo serializado pro arquivo de export/import (.json). */
export interface ExportedFluxo {
  betinnaFluxo: 1;
  tipo: 'fluxo';
  nome: string;
  descricao: string | null;
  triggerTipo: string | null;
  triggerConfig: Record<string, unknown> | null;
  nos: Array<{
    id: string;
    tipo: string;
    acaoTipo: string | null;
    titulo: string;
    config: Record<string, unknown>;
    posX: number;
    posY: number;
  }>;
  arestas: Array<{ sourceNoId: string; targetNoId: string; label: string | null }>;
}

// Helper: converte Record<string, unknown> em InputJsonObject sem type error
const toJson = (v: Record<string, unknown>): Prisma.InputJsonObject =>
  v as unknown as Prisma.InputJsonObject;

/**
 * Mesma normalização do motor (fluxo-executor.service.ts avaliarCondicao):
 * trim + minúsculas + sem acento (NFKD) + espaços colapsados. Usada pra casar
 * rótulo de aresta com saída configurada sem depender de acento/espaço.
 */
const normalizarRotulo = (s: string): string =>
  s
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ');

const fluxoInclude = {
  nos: { orderBy: { posY: 'asc' as const } },
  arestas: true,
  // Só PRODUÇÃO: o "N execuções" do card é o que o usuário lê como "quanto este
  // fluxo rodou". Somar teste aí faz um fluxo pausado parecer que trabalhou.
  _count: { select: { execucoes: { where: { teste: false } } } },
} satisfies Prisma.FluxoInclude;

type FluxoWithRel = Prisma.FluxoGetPayload<{ include: typeof fluxoInclude }>;

const execucaoInclude = {
  logs: { orderBy: { iniciadoEm: 'asc' as const } },
} satisfies Prisma.FluxoExecucaoInclude;
type ExecucaoWithLogs = Prisma.FluxoExecucaoGetPayload<{ include: typeof execucaoInclude }>;

@Injectable()
export class FluxosService {
  private readonly logger = new Logger(FluxosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: FluxoEventBusService,
    private readonly redis: RedisService,
    private readonly whatsappMedia: WhatsAppMediaService,
  ) {}

  /**
   * Sobe um anexo da ação ENVIAR_WHATSAPP pro Supabase Storage e devolve o `storagePath` — o nó do
   * fluxo guarda só essa referência (não o base64). O envio no runtime usa o storagePath direto.
   * Reusa o mesmo upload da Inbox (`uploadOutbound`); o "peer" é fixo `fluxo` (não há destinatário
   * ainda no momento da configuração).
   */
  async uploadMidia(
    user: AuthenticatedUser,
    dto: UploadFluxoMidiaDto,
  ): Promise<{
    storagePath: string;
    tipo: string;
    mimetype?: string;
    fileName?: string;
    ptt?: boolean;
  }> {
    const empresaId = user.empresaIdAtiva;
    if (!empresaId) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    if (dto.tipo === 'DOCUMENT' && !dto.fileName) {
      throw new BusinessRuleException('fileName é obrigatório para DOCUMENT');
    }
    const buffer = Buffer.from(dto.dataBase64, 'base64');
    const storagePath = await this.whatsappMedia.uploadOutbound(
      empresaId,
      'fluxo',
      buffer,
      dto.mimetype,
    );
    if (!storagePath) {
      throw new BusinessRuleException('Falha ao subir o anexo (tamanho ou Storage indisponível)');
    }
    return {
      storagePath,
      tipo: dto.tipo,
      mimetype: dto.mimetype,
      fileName: dto.fileName,
      ptt: dto.ptt,
    };
  }

  /**
   * Limpa o cursor do próximo disparo do CRON_AGENDADO (Redis `cron:next:<id>`).
   * Necessário ao ativar ou trocar o agendamento: senão o cursor de um
   * agendamento ANTERIOR (data futura) sobrevive e o job fica esperando ele —
   * o fluxo nunca dispara mesmo ATIVO e com a expressão nova. Após limpar, o job
   * reavalia do zero (agenda o próximo a partir de agora). Best-effort.
   */
  private async limparCursorCron(id: string): Promise<void> {
    await this.redis.del(`cron:next:${id}`).catch((err) => {
      this.logger.warn(
        `Falha ao limpar cursor cron do fluxo ${id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }

  // ─── Guard helpers ───────────────────────────────────────────────

  private requireEmpresa(user: AuthenticatedUser): string {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    return user.empresaIdAtiva;
  }

  private requireAdminOrDirector(user: AuthenticatedUser): void {
    if (!['ADMIN', 'DIRECTOR'].includes(user.role)) {
      throw new ForbiddenException(
        'Apenas ADMIN ou DIRECTOR podem gerenciar fluxos de automação',
        ErrorCode.FORBIDDEN,
      );
    }
  }

  private ehGestao(user: AuthenticatedUser): boolean {
    return ['ADMIN', 'DIRECTOR'].includes(user.role);
  }

  /**
   * Quem pode MUTAR este fluxo (card 👤 21/08 — fluxo com dono):
   *  - fluxo da EMPRESA (usuarioId null): gestão, como sempre foi;
   *  - fluxo PESSOAL: SÓ o dono. Gestão enxerga (leitura, sob demanda — padrão
   *    dos quadros de rep) mas NÃO edita/testa/ativa o fluxo de outra pessoa:
   *    é a separação que o modelo existe pra criar.
   */
  private assertPodeGerirFluxo(user: AuthenticatedUser, fluxo: { usuarioId: string | null }): void {
    if (fluxo.usuarioId) {
      if (fluxo.usuarioId !== user.id) {
        throw new ForbiddenException(
          'Este fluxo é pessoal de outro usuário — só o dono pode mexer nele',
          ErrorCode.FORBIDDEN,
        );
      }
      return;
    }
    this.requireAdminOrDirector(user);
  }

  /** Ações que um fluxo PESSOAL não pode ter — extrapolam a carteira do dono. */
  private static readonly ACOES_PROIBIDAS_PESSOAL = new Set([
    'ATRIBUIR_REP',
    'TRANSFERIR_ATENDIMENTO',
    'LIBERAR_LOTE',
  ]);

  /**
   * Guarda-corpo do fluxo pessoal, na VALIDAÇÃO (não só escondido no editor —
   * senão qualquer um monta via API/import mesmo assim):
   *  - ações que agem fora da carteira são recusadas;
   *  - MOVER_LEAD_ETAPA só pra etapa de funil que o dono ENXERGA (visivelParaRep).
   */
  private async validarGrafoPessoal(
    empresaId: string,
    nos: Array<{ tipo: string; acaoTipo?: string | null; config?: unknown }>,
  ): Promise<void> {
    for (const no of nos) {
      if (no.tipo !== 'ACAO' || !no.acaoTipo) continue;
      if (FluxosService.ACOES_PROIBIDAS_PESSOAL.has(no.acaoTipo)) {
        throw new BusinessRuleException(
          `A ação ${no.acaoTipo} não é permitida em fluxo pessoal — ela age fora da sua carteira`,
          ErrorCode.FLUXO_INVALIDO,
        );
      }
      if (no.acaoTipo === 'MOVER_LEAD_ETAPA') {
        const cfg = (no.config ?? {}) as { funilEtapaId?: string };
        if (cfg.funilEtapaId) {
          const etapa = await this.prisma.funilEtapa.findFirst({
            where: { id: cfg.funilEtapaId, funil: { empresaId } },
            select: { funil: { select: { nome: true, visivelParaRep: true } } },
          });
          if (etapa && !etapa.funil.visivelParaRep) {
            throw new BusinessRuleException(
              `MOVER_LEAD_ETAPA aponta pra etapa do funil "${etapa.funil.nome}", que não é ` +
                'visível pra representantes — fluxo pessoal só move dentro dos funis que você vê',
              ErrorCode.FLUXO_INVALIDO,
            );
          }
        }
      }
    }
  }

  // ─── Validação do grafo ──────────────────────────────────────────

  /**
   * Valida estrutura mínima do grafo antes de ativar.
   * - Precisa ter exatamente 1 nó TRIGGER.
   * - Todo nó ACAO precisa de acaoTipo.
   * - Nenhuma aresta pode referenciar nó inexistente.
   */
  private validarGrafo(
    nos: {
      id: string;
      tipo: string;
      titulo?: string;
      acaoTipo?: string | null;
      config?: unknown;
    }[],
    arestas: { sourceNoId: string; targetNoId: string; label?: string | null }[],
    triggerTipo?: string | null,
  ): void {
    const triggersCount = nos.filter((n) => n.tipo === 'TRIGGER').length;
    if (triggersCount !== 1) {
      throw new BusinessRuleException(
        `O fluxo precisa ter exatamente 1 nó TRIGGER (encontrados: ${triggersCount})`,
        ErrorCode.FLUXO_INVALIDO,
      );
    }
    if (!triggerTipo) {
      throw new BusinessRuleException(
        'O fluxo precisa ter um triggerTipo definido antes de ser ativado',
        ErrorCode.FLUXO_NAO_PODE_ATIVAR,
      );
    }
    const noIds = new Set(nos.map((n) => n.id));
    for (const e of arestas) {
      if (!noIds.has(e.sourceNoId) || !noIds.has(e.targetNoId)) {
        throw new BusinessRuleException(
          `Aresta referencia nó inexistente (source=${e.sourceNoId}, target=${e.targetNoId})`,
          ErrorCode.FLUXO_INVALIDO,
        );
      }
    }
    for (const n of nos) {
      if (n.tipo === 'ACAO' && !n.acaoTipo) {
        throw new BusinessRuleException(
          `Nó ACAO sem acaoTipo definido (id=${n.id})`,
          ErrorCode.FLUXO_INVALIDO,
        );
      }
      // ATRIBUIR_REP sem representante: o runtime casaria um usuário arbitrário
      // da empresa (filtro undefined é descartado pelo Prisma). Barra no ativar.
      if (n.acaoTipo === 'ATRIBUIR_REP') {
        const cfg = (n.config ?? {}) as { representanteId?: string };
        if (!cfg.representanteId?.trim()) {
          throw new BusinessRuleException(
            `O bloco ${n.titulo ? `"${n.titulo}"` : `id=${n.id}`} (Atribuir representante) está sem representante escolhido.`,
            ErrorCode.FLUXO_INVALIDO,
          );
        }
      }
      // DELAY precisa de quantidade > 0. Sem isso o runtime cai em delay 0/indefinido
      // (o fluxo "pula" a espera em silêncio) — barra no ativar com erro claro.
      if (n.tipo === 'DELAY') {
        const cfg = (n.config ?? {}) as { quantidade?: unknown; valor?: unknown };
        const raw = cfg.quantidade ?? cfg.valor;
        const q = typeof raw === 'number' ? raw : Number(raw);
        if (!Number.isFinite(q) || q <= 0) {
          throw new BusinessRuleException(
            `Nó de espera (DELAY) precisa de uma quantidade maior que zero (id=${n.id})`,
            ErrorCode.FLUXO_INVALIDO,
          );
        }
      }

      // CONDICAO: o motor roteia comparando o LABEL da aresta com o que ele
      // emite ('Sim'/'Não' no modo simples, o valor da saída/'default' no
      // roteador). Config incompleta ou label que não casa = execução conclui
      // VERDE sem executar ramo nenhum — a falha mais silenciosa do sistema.
      if (n.tipo === 'CONDICAO') {
        this.validarCondicao(n, arestas);
      }
    }
  }

  /**
   * Fluxo CRON_AGENDADO precisa de expressão VÁLIDA pra rodar. Sem esta checagem
   * ele ativava com agendamento vazio ou inválido, ficava verde na lista e
   * simplesmente nunca disparava — sem erro em lugar nenhum.
   */
  private validarAgendamentoCron(fluxo: {
    triggerTipo: string | null;
    triggerConfig: unknown;
  }): void {
    if (fluxo.triggerTipo !== 'CRON_AGENDADO') return;
    const cfg = (fluxo.triggerConfig ?? {}) as { expressoes?: unknown; expressao?: unknown };
    const exprs = (
      Array.isArray(cfg.expressoes) && cfg.expressoes.length
        ? (cfg.expressoes as unknown[])
        : [cfg.expressao]
    )
      .filter((e): e is string => typeof e === 'string')
      .map((e) => e.trim())
      .filter(Boolean);

    if (exprs.length === 0) {
      throw new BusinessRuleException(
        'Este fluxo é agendado, mas não tem nenhum horário definido. Configure o agendamento no bloco de gatilho.',
        ErrorCode.FLUXO_INVALIDO,
      );
    }
    for (const e of exprs) {
      const { valido, erro } = validarCronExpr(e);
      if (!valido) {
        throw new BusinessRuleException(
          `Agendamento inválido ("${e}"): ${erro ?? 'expressão cron não reconhecida'}`,
          ErrorCode.FLUXO_INVALIDO,
        );
      }
    }
  }

  /** Checa config + labels de saída de um nó CONDICAO (ver validarGrafo). */
  private validarCondicao(
    no: { id: string; titulo?: string; config?: unknown },
    arestas: { sourceNoId: string; label?: string | null }[],
  ): void {
    const cfg = (no.config ?? {}) as {
      modo?: string;
      campo?: string;
      operador?: string;
      variavel?: string;
      saidas?: string[];
    };
    const nome = no.titulo ? `"${no.titulo}"` : `id=${no.id}`;
    const saindo = arestas.filter((e) => e.sourceNoId === no.id);
    // Nó-folha (sem saída nenhuma) é legítimo: fim de caminho.
    if (saindo.length === 0) return;

    const semLabel = saindo.filter((e) => !e.label?.trim());
    if (semLabel.length > 0) {
      throw new BusinessRuleException(
        `A condição ${nome} tem ${semLabel.length} conexão(ões) sem rótulo — o fluxo não saberia por onde seguir. Reconecte a partir das saídas do bloco.`,
        ErrorCode.FLUXO_INVALIDO,
      );
    }

    const labels = new Set(saindo.map((e) => normalizarRotulo(e.label as string)));

    if (cfg.modo === 'roteador') {
      if (!cfg.variavel?.trim()) {
        throw new BusinessRuleException(
          `A condição ${nome} está no modo roteador mas não tem variável definida.`,
          ErrorCode.FLUXO_INVALIDO,
        );
      }
      const saidas = (cfg.saidas ?? []).filter((s) => s?.trim());
      if (saidas.length === 0) {
        throw new BusinessRuleException(
          `A condição ${nome} está no modo roteador mas não tem nenhuma saída configurada.`,
          ErrorCode.FLUXO_INVALIDO,
        );
      }
      const faltando = saidas.filter((s) => !labels.has(normalizarRotulo(s)));
      if (faltando.length > 0) {
        throw new BusinessRuleException(
          `A condição ${nome} tem saída(s) sem conexão: ${faltando.join(', ')}. Todo caminho classificado precisa levar a algum bloco.`,
          ErrorCode.FLUXO_INVALIDO,
        );
      }
      return;
    }

    // Modo simples: precisa de campo + operador e dos DOIS ramos ligados.
    if (!cfg.campo?.trim() || !cfg.operador?.trim()) {
      throw new BusinessRuleException(
        `A condição ${nome} está incompleta (falta campo ou operador) — ela sempre cairia no "Não".`,
        ErrorCode.FLUXO_INVALIDO,
      );
    }
    const temSim = labels.has('sim') || labels.has('true');
    const temNao = labels.has('nao') || labels.has('false');
    if (!temSim || !temNao) {
      const falta = [!temSim && 'Sim', !temNao && 'Não'].filter(Boolean).join(' e ');
      throw new BusinessRuleException(
        `A condição ${nome} não tem o caminho "${falta}" conectado — leads que caírem nele parariam sem ação.`,
        ErrorCode.FLUXO_INVALIDO,
      );
    }
  }

  /**
   * Remapeia as CHAVES dos nós vindas do cliente ("trigger", "ia1") pra ids
   * internos novos. FluxoNo.id é PK GLOBAL: gravar a chave literal fazia dois
   * fluxos com as mesmas chaves colidirem em P2002 (o import já remapeava; o
   * create/update não). Arestas sempre ganham id novo e apontam pro id novo.
   */
  private remapearGrafo<
    N extends { id: string },
    E extends { sourceNoId: string; targetNoId: string; label?: string | null },
  >(nos: N[], arestas: E[]): { nos: N[]; arestas: (E & { id: string })[] } {
    const idMap = new Map<string, string>();
    for (const n of nos) idMap.set(n.id, randomUUID());
    // Aresta DUPLICADA (mesmo source→target→label) executa o ramo 2× no motor —
    // mensagem em dobro pro cliente (auditoria 20/08). Deduplica no ponto único
    // por onde create/update/import passam; mantém a 1ª ocorrência. Bônus: a
    // duplicata com label deixava o import estourar em P2002 feio.
    const vistas = new Set<string>();
    const semDuplicata = arestas.filter((e) => {
      const chave = `${e.sourceNoId}|${e.targetNoId}|${e.label ?? ''}`;
      if (vistas.has(chave)) return false;
      vistas.add(chave);
      return true;
    });
    return {
      nos: nos.map((n) => ({ ...n, id: idMap.get(n.id) as string })),
      arestas: semDuplicata.map((e) => ({
        ...e,
        id: randomUUID(),
        sourceNoId: idMap.get(e.sourceNoId) ?? e.sourceNoId,
        targetNoId: idMap.get(e.targetNoId) ?? e.targetNoId,
      })),
    };
  }

  // ─── CRUD ───────────────────────────────────────────────────────

  async create(user: AuthenticatedUser, dto: CreateFluxoDto): Promise<FluxoWithRel> {
    const empresaId = this.requireEmpresa(user);
    // Gestão cria fluxo da EMPRESA; qualquer outro papel cria fluxo PESSOAL
    // dele — o dono é o PAPEL, não um campo do body (rep não escolhe criar
    // fluxo de empresa, nem em nome de outro).
    const usuarioId = this.ehGestao(user) ? null : user.id;
    if (usuarioId) await this.validarGrafoPessoal(empresaId, dto.nos);

    // Cria fluxo + nós + arestas em transação
    const grafo = this.remapearGrafo(dto.nos, dto.arestas);
    let fluxoId!: string;
    await this.prisma.$transaction(async (tx) => {
      const created = await tx.fluxo.create({
        data: {
          empresaId,
          usuarioId,
          nome: dto.nome,
          descricao: dto.descricao ?? null,
          triggerTipo: dto.triggerTipo ?? null,
          triggerConfig: dto.triggerConfig ? toJson(dto.triggerConfig) : Prisma.JsonNull,
          status: 'RASCUNHO',
        },
      });
      fluxoId = created.id;

      if (grafo.nos.length > 0) {
        await tx.fluxoNo.createMany({
          data: grafo.nos.map((n) => ({
            id: n.id,
            fluxoId: created.id,
            tipo: n.tipo,
            acaoTipo: n.acaoTipo ?? null,
            titulo: n.titulo,
            config: toJson(n.config),
            posX: n.posX,
            posY: n.posY,
          })),
        });
      }
      if (grafo.arestas.length > 0) {
        await tx.fluxoEdge.createMany({
          data: grafo.arestas.map((e) => ({
            id: e.id,
            fluxoId: created.id,
            sourceNoId: e.sourceNoId,
            targetNoId: e.targetNoId,
            label: e.label ?? null,
          })),
        });
      }
    });

    this.logger.log(`Fluxo criado: ${fluxoId} (${dto.nome}) por ${user.id}`);
    return this.findOneById(fluxoId);
  }

  async list(user: AuthenticatedUser, params: ListFluxosDto): Promise<Paginated<FluxoWithRel>> {
    const empresaId = this.requireEmpresa(user);
    const where: Prisma.FluxoWhereInput = { empresaId };
    // Fluxo com DONO (card 👤): pessoal fica FORA da lista da empresa por
    // default — mesmo padrão dos quadros de rep. Gestão pede com
    // incluirPessoais (leitura); REP vê SÓ os dele; GERENTE vê os da empresa
    // (como sempre viu) + os dele.
    if (user.role === 'REP') {
      where.usuarioId = user.id;
    } else if (!this.ehGestao(user)) {
      // Em AND próprio: o filtro de `search` abaixo também usa OR e
      // sobrescreveria este se dividissem o mesmo slot.
      where.AND = [{ OR: [{ usuarioId: null }, { usuarioId: user.id }] }];
    } else if (!params.incluirPessoais) {
      where.usuarioId = null;
    }

    if (params.status) where.status = params.status;
    if (params.triggerTipo) where.triggerTipo = params.triggerTipo;
    if (params.search) {
      where.AND = [
        ...((where.AND as Prisma.FluxoWhereInput[]) ?? []),
        {
          OR: [
            { nome: { contains: params.search, mode: 'insensitive' } },
            { descricao: { contains: params.search, mode: 'insensitive' } },
          ],
        },
      ];
    }

    // Favoritos são POR USUÁRIO — o SAC vive na triagem, o diretor na
    // prospecção. Lidos antes pra (a) marcar cada item e (b) subir pro topo.
    const favoritos = new Set(
      (
        await this.prisma.fluxoFavorito.findMany({
          where: { usuarioId: user.id },
          select: { fluxoId: true },
        })
      ).map((f) => f.fluxoId),
    );
    if (params.favoritos) {
      // Filtro "só favoritos": lista vazia tem que dar ZERO resultado, não a
      // lista inteira — daí o `in: []` explícito em vez de pular a condição.
      where.id = { in: [...favoritos] };
    }

    // Ordenar favorito-primeiro não é expressável no orderBy do Prisma (a
    // relação é filtrada por usuário). Em vez de duplicar os filtros em SQL cru
    // — que é onde esse tipo de coisa apodrece —, ordena a lista de IDS (2
    // colunas, barato mesmo com centenas de fluxos) e busca só a página.
    const chaves = await this.prisma.fluxo.findMany({
      where,
      select: { id: true, nome: true, criadoEm: true, atualizadoEm: true },
    });

    // SITUAÇÃO + ordem por atividade precisam do resumo de execução (7d), que
    // não está no Fluxo. Uma agregação só pro lote inteiro — e apenas quando
    // algum dos dois foi pedido, pra a lista comum não pagar a query.
    const precisaExec = Boolean(params.situacao) || params.ordenar === 'execucoes';
    const execPorFluxo = new Map<string, { total: number; erros: number; ultima: number }>();
    if (precisaExec && chaves.length > 0) {
      const desde = new Date(Date.now() - 7 * 86_400_000);
      const agg = await this.prisma.fluxoExecucao.groupBy({
        by: ['fluxoId', 'status'],
        // `teste: false`: execução de teste não é sinal de saúde do fluxo — foi
        // essa mistura que já pintou fluxo de vermelho no painel antes.
        where: { empresaId, teste: false, criadoEm: { gte: desde } },
        _count: { _all: true },
        _max: { criadoEm: true },
      });
      for (const g of agg) {
        const atual = execPorFluxo.get(g.fluxoId) ?? { total: 0, erros: 0, ultima: 0 };
        atual.total += g._count._all;
        if (g.status === 'FALHOU') atual.erros += g._count._all;
        const em = g._max.criadoEm?.getTime() ?? 0;
        if (em > atual.ultima) atual.ultima = em;
        execPorFluxo.set(g.fluxoId, atual);
      }
    }

    const chavesFiltradas = params.situacao
      ? chaves.filter((c) => {
          const e = execPorFluxo.get(c.id);
          if (params.situacao === 'sem_execucao') return !e || e.total === 0;
          if (params.situacao === 'com_erro') return Boolean(e && e.erros > 0);
          return Boolean(e && e.total > 0 && e.erros === 0); // 'rodando'
        })
      : chaves;

    chavesFiltradas.sort((a, b) => {
      const fa = favoritos.has(a.id) ? 0 : 1;
      const fb = favoritos.has(b.id) ? 0 : 1;
      if (fa !== fb) return fa - fb;
      if (params.ordenar === 'recentes') {
        return b.atualizadoEm.getTime() - a.atualizadoEm.getTime();
      }
      if (params.ordenar === 'execucoes') {
        const ea = execPorFluxo.get(a.id)?.total ?? 0;
        const eb = execPorFluxo.get(b.id)?.total ?? 0;
        if (ea !== eb) return eb - ea;
      }
      // Default: ordem por NOME (convenção E1 < E1-R < E2 < E2-R sai natural —
      // espaço antes do hífen). Estável: ativar/editar NÃO reordena (antes era
      // atualizadoEm desc, que pulava pro topo a cada ação); criadoEm desempata.
      const porNome = a.nome.localeCompare(b.nome, 'pt-BR');
      return porNome !== 0 ? porNome : a.criadoEm.getTime() - b.criadoEm.getTime();
    });

    const skip = (params.page - 1) * params.limit;
    const idsDaPagina = chavesFiltradas.slice(skip, skip + params.limit).map((f) => f.id);
    const rows = idsDaPagina.length
      ? await this.prisma.fluxo.findMany({
          where: { id: { in: idsDaPagina } },
          include: fluxoInclude,
        })
      : [];
    // O `in` do Postgres não preserva ordem — reordena pelo que foi calculado.
    const porId = new Map(rows.map((r) => [r.id, r]));
    const data = idsDaPagina
      .map((id) => porId.get(id))
      .filter((f): f is (typeof rows)[number] => Boolean(f))
      .map((f) => ({ ...f, favorito: favoritos.has(f.id) }));

    return buildPaginated(data, chavesFiltradas.length, params.page, params.limit);
  }

  /**
   * Marca/desmarca o fluxo como favorito DO USUÁRIO logado.
   *
   * Idempotente dos dois lados: favoritar o que já é favorito (duplo clique,
   * duas abas) não estoura P2002, e desfavoritar o que não é não dá 404.
   */
  async definirFavorito(
    user: AuthenticatedUser,
    fluxoId: string,
    favorito: boolean,
  ): Promise<{ favorito: boolean }> {
    // findOne valida o tenant: ninguém favorita fluxo de outra empresa.
    await this.findOne(user, fluxoId);
    if (favorito) {
      await this.prisma.fluxoFavorito
        .create({ data: { usuarioId: user.id, fluxoId } })
        .catch((err: unknown) => {
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return;
          throw err;
        });
    } else {
      await this.prisma.fluxoFavorito.deleteMany({ where: { usuarioId: user.id, fluxoId } });
    }
    return { favorito };
  }

  async findOne(user: AuthenticatedUser, id: string): Promise<FluxoWithRel> {
    const empresaId = this.requireEmpresa(user);
    const fluxo = await this.prisma.fluxo.findFirst({
      where: { id, empresaId },
      include: fluxoInclude,
    });
    if (!fluxo) throw new NotFoundException(`Fluxo ${id} não encontrado`);
    // Visibilidade por DONO (card 👤): gestão LÊ tudo (empresa + pessoais, é o
    // espelho); REP só o dele — inclusive fluxo da EMPRESA dá 403, é o aceite
    // do modelo ("não está autorizado a operar pelo fluxo do admin");
    // GERENTE/SAC leem os da empresa (como sempre) + os próprios.
    if (!this.ehGestao(user)) {
      const podeVer =
        user.role === 'REP'
          ? fluxo.usuarioId === user.id
          : fluxo.usuarioId === null || fluxo.usuarioId === user.id;
      if (!podeVer) {
        throw new ForbiddenException(
          fluxo.usuarioId
            ? 'Este fluxo é pessoal de outro usuário'
            : 'Fluxos da empresa são geridos pela gestão — seu acesso é aos seus fluxos pessoais',
          ErrorCode.FORBIDDEN,
        );
      }
    }
    return fluxo;
  }

  private async findOneById(id: string): Promise<FluxoWithRel> {
    const fluxo = await this.prisma.fluxo.findUniqueOrThrow({
      where: { id },
      include: fluxoInclude,
    });
    return fluxo;
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateFluxoDto): Promise<FluxoWithRel> {
    const existing = await this.findOne(user, id);
    this.assertPodeGerirFluxo(user, existing);
    // Fluxo pessoal: guarda-corpos valem também na EDIÇÃO do grafo.
    if (existing.usuarioId && dto.nos) {
      await this.validarGrafoPessoal(existing.empresaId, dto.nos);
    }

    if (existing.status === 'ARQUIVADO') {
      throw new BusinessRuleException(
        'Fluxos arquivados não podem ser editados',
        ErrorCode.BUSINESS_RULE_VIOLATION,
      );
    }

    // Full replace do grafo: remapeia as chaves pra ids novos (FluxoNo.id é PK
    // global — reusar "trigger"/"ia1" entre fluxos colidia em P2002).
    const grafo =
      dto.nos !== undefined && dto.arestas !== undefined
        ? this.remapearGrafo(dto.nos, dto.arestas)
        : null;

    let rebaixouParaRascunho = false;
    await this.prisma.$transaction(async (tx) => {
      if (grafo) {
        // Delete arestas primeiro (FK para nos)
        await tx.fluxoEdge.deleteMany({ where: { fluxoId: id } });
        await tx.fluxoNo.deleteMany({ where: { fluxoId: id } });

        if (grafo.nos.length) {
          await tx.fluxoNo.createMany({
            data: grafo.nos.map((n) => ({
              id: n.id,
              fluxoId: id,
              tipo: n.tipo,
              acaoTipo: n.acaoTipo ?? null,
              titulo: n.titulo,
              config: toJson(n.config),
              posX: n.posX,
              posY: n.posY,
            })),
          });
        }
        if (grafo.arestas.length) {
          await tx.fluxoEdge.createMany({
            data: grafo.arestas.map((e) => ({
              id: e.id,
              fluxoId: id,
              sourceNoId: e.sourceNoId,
              targetNoId: e.targetNoId,
              label: e.label ?? null,
            })),
          });
        }
      }

      // Trocar o GATILHO de um fluxo ATIVO sem mexer no grafo não rebaixava nem
      // revalidava (auditoria 20/08): virar CRON_AGENDADO sem expressão deixava
      // o fluxo VERDE na lista e mudo pra sempre. Valida o estado RESULTANTE
      // (tipo/config mesclados com o existente) antes de persistir — a troca
      // inválida é rejeitada com o mesmo erro do ativar. Não rebaixa de
      // propósito: ajustar o filtro do gatilho de um fluxo no ar é operação
      // legítima da master, e pausar junto seria surpresa pior.
      if (
        existing.status === 'ATIVO' &&
        (dto.triggerTipo !== undefined || dto.triggerConfig !== undefined)
      ) {
        this.validarAgendamentoCron({
          triggerTipo: dto.triggerTipo ?? existing.triggerTipo,
          triggerConfig:
            dto.triggerConfig !== undefined ? dto.triggerConfig : existing.triggerConfig,
        });
      }

      const updateData: Prisma.FluxoUpdateInput = { versao: { increment: 1 } };
      if (dto.nome !== undefined) updateData.nome = dto.nome;
      if (dto.descricao !== undefined) updateData.descricao = dto.descricao;
      if (dto.triggerTipo !== undefined) updateData.triggerTipo = dto.triggerTipo;
      if (dto.triggerConfig !== undefined) {
        updateData.triggerConfig = dto.triggerConfig
          ? (toJson(dto.triggerConfig) as Prisma.InputJsonValue)
          : Prisma.JsonNull;
      }
      // Se estava ATIVO e editou o grafo, volta pra RASCUNHO
      if (existing.status === 'ATIVO' && grafo) {
        updateData.status = 'RASCUNHO';
        rebaixouParaRascunho = true;
      }

      await tx.fluxo.update({ where: { id }, data: updateData });
    });

    // CAÇADA-BUG #9: rebaixar ATIVO→RASCUNHO (edição do grafo) precisa CANCELAR as execuções em voo,
    // igual pausar/arquivar. Sem isto, execuções PENDENTE/AGUARDANDO/EM_EXECUCAO continuavam rodando
    // contra o grafo substituído (e o CONVERSAR_IA seguia conversando indefinidamente — o
    // processarTimeouts filtra fluxo ATIVO, então uma execução AGUARDANDO nunca expirava). O usuário
    // acha que "desativou" editando, mas o bot continuava.
    if (rebaixouParaRascunho) {
      const cancel = await this.cancelarExecucoesEmAndamento(id);
      this.logger.log(
        `Fluxo ${id} rebaixado p/ RASCUNHO na edição (${cancel} execução(ões) em voo cancelada(s))`,
      );
    }

    // Mudou o agendamento (tipo/config do trigger) → zera o cursor do cron pra
    // não ficar preso no próximo disparo da config ANTIGA.
    if (dto.triggerTipo !== undefined || dto.triggerConfig !== undefined) {
      await this.limparCursorCron(id);
    }

    this.logger.log(`Fluxo ${id} atualizado por ${user.id}`);
    return this.findOne(user, id);
  }

  /**
   * Avisa (não recusa) quando um nó "Conversar com IA" ativa com a saída `erro`
   * SOLTA.
   *
   * Em 24/08, 6 dos 7 nós de IA em fluxo ATIVO estavam assim — inclusive o T1,
   * porta de entrada de todo inbound. Quando a IA falhava, a execução morria sem
   * tarefa, sem alerta e sem tag, e o lead ficava no silêncio.
   *
   * NÃO recusa a ativação de propósito: o motor já marca a conversa como
   * `precisaHumano` em qualquer falha de IA, então a aresta virou melhoria por
   * fluxo, não obrigação. Recusar aqui bloquearia fluxo que funciona — e o
   * remédio (rebaixar pra rascunho, editar, reativar) custaria mais que o
   * problema que sobrou.
   */
  private avisarSaidaErroSolta(fluxo: FluxoWithRel): void {
    const semErro = fluxo.nos
      .filter((n) => n.tipo === 'ACAO' && n.acaoTipo === 'CONVERSAR_IA')
      .filter((n) => !fluxo.arestas.some((e) => e.sourceNoId === n.id && e.label === 'erro'));
    if (semErro.length === 0) return;
    this.logger.warn(
      `Fluxo "${fluxo.nome}" ativado com ${semErro.length} nó(s) de IA sem a saída "erro" ligada ` +
        `(${semErro.map((n) => n.titulo).join(', ')}). A conversa ainda sobe pro humano quando a IA ` +
        `falha, mas ligar a saída dá tratamento próprio ao caso.`,
    );
  }

  async ativar(user: AuthenticatedUser, id: string): Promise<FluxoWithRel> {
    const fluxo = await this.findOne(user, id);
    this.assertPodeGerirFluxo(user, fluxo);

    if (fluxo.status === 'ATIVO') {
      throw new BusinessRuleException('Fluxo já está ativo', ErrorCode.FLUXO_JA_ATIVO);
    }
    if (fluxo.status === 'ARQUIVADO') {
      throw new BusinessRuleException(
        'Fluxos arquivados não podem ser ativados',
        ErrorCode.BUSINESS_RULE_VIOLATION,
      );
    }

    // Valida grafo antes de ativar
    this.validarGrafo(fluxo.nos, fluxo.arestas, fluxo.triggerTipo);
    this.validarAgendamentoCron(fluxo);
    this.avisarSaidaErroSolta(fluxo);

    // Começa LIMPO: cancela execuções velhas que ficaram em voo (ex: fluxo
    // pausado antes do fix de cancelamento). Sem isto, reativar ressuscitava
    // execuções antigas e elas voltavam a disparar/spammar.
    await this.cancelarExecucoesEmAndamento(id);
    // Zera o cursor do cron — reativar reprograma a partir de agora (corrige o
    // caso do cursor antigo travado no futuro, que fazia o fluxo nunca disparar).
    await this.limparCursorCron(id);
    await this.prisma.fluxo.update({ where: { id }, data: { status: 'ATIVO' } });
    this.logger.log(`Fluxo ${id} ativado por ${user.id}`);
    return this.findOneById(id);
  }

  /**
   * Define o nó de GATILHO do fluxo sem full-replace do grafo.
   *
   * O único write de grafo era o PUT (substitui TUDO) — pra consertar um fluxo
   * que nasceu sem gatilho era preciso reenviar todos os nós, incluindo corpos
   * de e-mail inteiros. Qualquer deslize no caminho reescrevia a copy de
   * produção. Esta rota mexe só no nó TRIGGER:
   *  - não existe → cria e liga na RAIZ atual (nó sem aresta de entrada);
   *  - já existe  → atualiza tipo/config, preservando as arestas.
   */
  async definirGatilho(
    user: AuthenticatedUser,
    id: string,
    dto: DefinirGatilhoDto,
  ): Promise<FluxoWithRel> {
    const fluxo = await this.findOne(user, id);
    this.assertPodeGerirFluxo(user, fluxo);
    if (fluxo.status === 'ARQUIVADO') {
      throw new BusinessRuleException(
        'Fluxo arquivado — desarquive antes de mexer no gatilho',
        ErrorCode.BUSINESS_RULE_VIOLATION,
      );
    }

    const triggerTipo = dto.triggerTipo ?? fluxo.triggerTipo ?? undefined;
    if (!triggerTipo) {
      throw new BusinessRuleException(
        'Informe o triggerTipo (o fluxo também não tem um definido)',
        ErrorCode.FLUXO_INVALIDO,
      );
    }

    const existentes = fluxo.nos.filter((n) => n.tipo === 'TRIGGER');
    if (existentes.length > 1) {
      throw new BusinessRuleException(
        `O fluxo tem ${existentes.length} nós TRIGGER — conserte pelo editor antes.`,
        ErrorCode.FLUXO_INVALIDO,
      );
    }

    const config = (dto.config ?? {}) as Prisma.InputJsonValue;
    if (existentes[0]) {
      await this.prisma.fluxoNo.update({
        where: { id: existentes[0].id },
        data: {
          config,
          ...(dto.titulo ? { titulo: dto.titulo } : {}),
        },
      });
    } else {
      // RAIZ = nó que ninguém aponta. É onde o gatilho tem que entrar; se houver
      // mais de um candidato (grafo com ramos soltos), o de menor posX vence —
      // é o começo visual do fluxo no editor.
      const alvos = new Set(fluxo.arestas.map((e) => e.targetNoId));
      const raizes = fluxo.nos
        .filter((n) => n.tipo !== 'TRIGGER' && !alvos.has(n.id))
        .sort((a, b) => (a.posX ?? 0) - (b.posX ?? 0));
      const raiz = raizes[0];
      if (!raiz) {
        throw new BusinessRuleException(
          'Não achei o nó inicial do fluxo pra ligar o gatilho (grafo vazio ou todo em ciclo).',
          ErrorCode.FLUXO_INVALIDO,
        );
      }
      const no = await this.prisma.fluxoNo.create({
        data: {
          fluxoId: fluxo.id,
          tipo: 'TRIGGER',
          titulo: dto.titulo ?? 'Gatilho',
          config,
          posX: (raiz.posX ?? 0) - 250,
          posY: raiz.posY ?? 0,
        },
      });
      await this.prisma.fluxoEdge.create({
        data: { fluxoId: fluxo.id, sourceNoId: no.id, targetNoId: raiz.id },
      });
    }

    // Espelha o AGENDAMENTO no Fluxo.triggerConfig (auditoria 20/08). O job de
    // CRON_AGENDADO lê EXCLUSIVAMENTE f.triggerConfig — gravar a config só no
    // nó TRIGGER (acima) fazia a troca de horário pelo MCP ser ignorada em
    // silêncio: a tela mostrava a agenda nova e o cursor Redis seguia a antiga.
    // O espelho vale pra QUALQUER gatilho (o filtro do bus também lê de lá como
    // fallback), então gravamos o config inteiro, como o update() faz.
    await this.prisma.fluxo.update({
      where: { id: fluxo.id },
      data: {
        triggerTipo,
        triggerConfig: dto.config ? (toJson(dto.config) as Prisma.InputJsonValue) : Prisma.JsonNull,
      },
    });
    // Mesmo motivo do update(): agendamento mudou → cursor do cron zera, senão
    // o próximo disparo ainda sai na config ANTIGA (o gotcha do cursor preso,
    // por mais uma porta).
    await this.limparCursorCron(fluxo.id);
    this.logger.log(`Gatilho definido no fluxo ${fluxo.id} (${triggerTipo}) por ${user.id}`);
    return this.findOne(user, fluxo.id);
  }

  async pausar(user: AuthenticatedUser, id: string): Promise<FluxoWithRel> {
    const fluxo = await this.findOne(user, id);
    this.assertPodeGerirFluxo(user, fluxo);

    if (fluxo.status !== 'ATIVO') {
      throw new BusinessRuleException(
        'Apenas fluxos ativos podem ser pausados',
        ErrorCode.BUSINESS_RULE_VIOLATION,
      );
    }

    await this.prisma.fluxo.update({ where: { id }, data: { status: 'PAUSADO' } });
    const cancel = await this.cancelarExecucoesEmAndamento(id);
    this.logger.log(`Fluxo ${id} pausado por ${user.id} (${cancel} execução(ões) cancelada(s))`);
    return this.findOneById(id);
  }

  async arquivar(user: AuthenticatedUser, id: string): Promise<FluxoWithRel> {
    this.assertPodeGerirFluxo(user, await this.findOne(user, id));
    await this.prisma.fluxo.update({ where: { id }, data: { status: 'ARQUIVADO' } });
    const cancel = await this.cancelarExecucoesEmAndamento(id);
    this.logger.log(`Fluxo ${id} arquivado por ${user.id} (${cancel} execução(ões) cancelada(s))`);
    return this.findOneById(id);
  }

  /**
   * Desarquiva: ARQUIVADO → RASCUNHO. NÃO pula direto pra ATIVO — reativar
   * continua exigindo o `ativar()` normal (valida grafo de novo), então quem
   * desarquiva precisa revisar antes de ligar.
   *
   * Existe pra fechar a mão-única que `arquivar` deixava: hoje é a ÚNICA rota
   * de volta pra um fluxo arquivado (incidente 2026-08-05 — a master arquivou
   * o T1 achando que estava pausando, e não tinha como desfazer nem pela API
   * nem pelo MCP; precisou recriar o fluxo do zero).
   */
  async desarquivar(user: AuthenticatedUser, id: string): Promise<FluxoWithRel> {
    const fluxo = await this.findOne(user, id);
    this.assertPodeGerirFluxo(user, fluxo);
    if (fluxo.status !== 'ARQUIVADO') {
      throw new BusinessRuleException(
        'Apenas fluxos arquivados podem ser desarquivados',
        ErrorCode.BUSINESS_RULE_VIOLATION,
      );
    }
    await this.prisma.fluxo.update({ where: { id }, data: { status: 'RASCUNHO' } });
    this.logger.log(`Fluxo ${id} desarquivado (→ RASCUNHO) por ${user.id}`);
    return this.findOneById(id);
  }

  /**
   * Congela as execuções em voo de um fluxo (ao pausar/arquivar): cancela as que
   * estão PENDENTE/AGUARDANDO/EM_EXECUCAO pra o fluxo NÃO seguir disparando
   * (timeout, follow-up, próximos passos). Sem isto, um fluxo pausado continuava
   * mandando mensagem a cada rodada do cron.
   */
  private async cancelarExecucoesEmAndamento(fluxoId: string): Promise<number> {
    const { count } = await this.prisma.fluxoExecucao.updateMany({
      where: { fluxoId, status: { in: ['PENDENTE', 'AGUARDANDO', 'EM_EXECUCAO'] } },
      data: { status: 'CANCELADO', aguardandoNoId: null, timeoutEm: null, terminouEm: new Date() },
    });
    return count;
  }

  /**
   * Exclui o fluxo PERMANENTEMENTE (não dá pra desfazer). Apaga execuções (que
   * cascateiam os logs) e o fluxo (que cascateia nós e arestas).
   */
  async excluirPermanente(user: AuthenticatedUser, id: string): Promise<{ ok: true }> {
    this.assertPodeGerirFluxo(user, await this.findOne(user, id)); // tenant + dono
    await this.prisma.$transaction([
      this.prisma.fluxoExecucao.deleteMany({ where: { fluxoId: id } }),
      this.prisma.fluxo.delete({ where: { id } }),
    ]);
    this.logger.log(`Fluxo ${id} EXCLUÍDO permanentemente por ${user.id}`);
    return { ok: true };
  }

  // ─── Import / Export (arquivo .json) ─────────────────────────────

  /**
   * Serializa o fluxo no formato de arquivo (.json) pronto pra reimportar.
   * Os ids dos nós viram CHAVES estáveis referenciadas pelas arestas.
   */
  async exportar(user: AuthenticatedUser, id: string): Promise<ExportedFluxo> {
    const f = await this.findOne(user, id);
    return {
      betinnaFluxo: 1,
      tipo: 'fluxo',
      nome: f.nome,
      descricao: f.descricao,
      triggerTipo: f.triggerTipo,
      triggerConfig: (f.triggerConfig ?? null) as Record<string, unknown> | null,
      nos: f.nos.map((n) => ({
        id: n.id,
        tipo: n.tipo,
        acaoTipo: n.acaoTipo,
        titulo: n.titulo,
        config: (n.config ?? {}) as Record<string, unknown>,
        posX: n.posX,
        posY: n.posY,
      })),
      arestas: f.arestas.map((e) => ({
        sourceNoId: e.sourceNoId,
        targetNoId: e.targetNoId,
        label: e.label,
      })),
    };
  }

  /**
   * Cria um fluxo (sempre RASCUNHO) a partir de um arquivo importado.
   * Re-mapeia as CHAVES dos nós → ids internos novos (reimport sem colisão)
   * e delega pro `create` (mesma transação/validação). Nunca ativa sozinho.
   */
  async importar(user: AuthenticatedUser, dto: ImportFluxoDto): Promise<FluxoWithRel> {
    // Papel decide o dono (mesma regra do create): gestão importa fluxo da
    // empresa; os demais importam como fluxo PESSOAL — com os guarda-corpos.
    if (!this.ehGestao(user)) {
      await this.validarGrafoPessoal(this.requireEmpresa(user), dto.nos);
    }

    // O `create` já remapeia as chaves → ids internos (helper compartilhado),
    // então o mesmo arquivo pode ser importado várias vezes sem colisão.
    const nos = dto.nos.map((n) => ({
      id: n.id,
      tipo: n.tipo,
      acaoTipo: n.acaoTipo ?? undefined,
      titulo: n.titulo,
      config: n.config,
      posX: n.posX,
      posY: n.posY,
    }));
    const arestas = dto.arestas.map((e) => ({
      id: e.sourceNoId + '->' + e.targetNoId,
      sourceNoId: e.sourceNoId,
      targetNoId: e.targetNoId,
      label: e.label ?? null,
    }));

    // Grafo SEM nó de gatilho é fluxo natimorto: o `ativar` recusa (validarGrafo)
    // e o motor não teria por onde começar. A leva de e-mail E1/E1-R/E2/E2-R foi
    // importada assim em jul/2026 e ficou um mês parecendo pronta — o erro só
    // apareceria na tentativa de ativar. Recusar AQUI é onde dói barato.
    const triggers = nos.filter((n) => n.tipo === 'TRIGGER').length;
    if (triggers !== 1) {
      throw new BusinessRuleException(
        `O fluxo importado precisa ter exatamente 1 nó TRIGGER (encontrados: ${triggers}). ` +
          'Inclua o nó de gatilho no arquivo, ou use POST /fluxos/:id/gatilho depois de importar.',
        ErrorCode.FLUXO_INVALIDO,
      );
    }

    const fluxo = await this.create(user, {
      nome: dto.nome,
      descricao: dto.descricao ?? undefined,
      triggerTipo: dto.triggerTipo ?? undefined,
      triggerConfig: dto.triggerConfig ?? undefined,
      nos,
      arestas,
    });
    this.logger.log(`Fluxo importado: ${fluxo.id} (${dto.nome}) por ${user.id}`);
    return fluxo;
  }

  // ─── Execuções ───────────────────────────────────────────────────

  async listExecucoes(
    user: AuthenticatedUser,
    fluxoId: string,
    params: ListExecucoesDto,
  ): Promise<
    Paginated<ExecucaoWithLogs & { contatoId: string | null; contatoNome: string | null }>
  > {
    const fluxo = await this.findOne(user, fluxoId);

    const where: Prisma.FluxoExecucaoWhereInput = { fluxoId: fluxo.id };
    if (params.status) where.status = params.status;
    // `teste` é coluna, não caminho no JSON: filtrar por JSON no Postgres some
    // com as linhas em que a chave não existe (NULL), que aqui seria justamente
    // a produção inteira.
    if (params.origem === 'producao') where.teste = false;
    else if (params.origem === 'teste') where.teste = true;

    const skip = (params.page - 1) * params.limit;
    const [data, total] = await Promise.all([
      this.prisma.fluxoExecucao.findMany({
        where,
        include: execucaoInclude,
        skip,
        take: params.limit,
        orderBy: { criadoEm: 'desc' },
      }),
      this.prisma.fluxoExecucao.count({ where }),
    ]);

    // Demanda MCP 5: identifica qual CONTATO disparou cada execução (auditoria de funil —
    // "esse lead passou por esse fluxo?"). contatoId = leadId (ou clienteId) do contexto;
    // resolve o nome em lote pelos leads da empresa.
    const leadIds = [
      ...new Set(
        data
          .map((e) => (e.contexto as Record<string, unknown> | null)?.leadId)
          .filter((x): x is string => typeof x === 'string'),
      ),
    ];
    const nomes = leadIds.length
      ? await this.prisma.lead.findMany({
          where: { id: { in: leadIds }, empresaId: fluxo.empresaId },
          select: { id: true, nome: true, contatoNome: true },
        })
      : [];
    const nomePorLead = new Map(nomes.map((l) => [l.id, l.contatoNome || l.nome]));
    const enriquecido = data.map((e) => {
      const ctx = (e.contexto ?? {}) as Record<string, unknown>;
      const contatoId =
        typeof ctx.leadId === 'string'
          ? ctx.leadId
          : typeof ctx.clienteId === 'string'
            ? ctx.clienteId
            : null;
      const contatoNome =
        typeof ctx.leadId === 'string' ? (nomePorLead.get(ctx.leadId) ?? null) : null;
      return { ...e, contatoId, contatoNome };
    });

    return buildPaginated(enriquecido, total, params.page, params.limit);
  }

  async cancelarExecucao(user: AuthenticatedUser, execucaoId: string): Promise<void> {
    this.requireAdminOrDirector(user);
    const empresaId = this.requireEmpresa(user);

    const execucao = await this.prisma.fluxoExecucao.findFirst({
      where: { id: execucaoId, empresaId },
    });
    if (!execucao) throw new NotFoundException(`Execução ${execucaoId} não encontrada`);
    if (['CONCLUIDO', 'CANCELADO', 'FALHOU'].includes(execucao.status)) {
      throw new BusinessRuleException(
        `Execução já está no status ${execucao.status}`,
        ErrorCode.BUSINESS_RULE_VIOLATION,
      );
    }

    // AUDITORIA (#35): o cancelamento só existia na linha de log do container.
    // Na tela de execuções a execução aparecia CANCELADA sem dizer por quem nem
    // por quê — e quando o lead reclamava que o fluxo parou no meio, ninguém
    // conseguia reconstruir se foi cancelamento manual, erro ou expiração.
    // Agora carimba o motivo na execução e grava a entrada na timeline.
    const carimbo = `Cancelado manualmente por ${user.nome || user.email} (${user.role})`;
    await this.prisma.fluxoExecucao.update({
      where: { id: execucaoId },
      data: { status: 'CANCELADO', terminouEm: new Date(), erroMsg: carimbo },
    });
    await this.prisma.fluxoExecucaoLog
      .create({
        data: {
          execucaoId,
          noId: execucao.aguardandoNoId ?? null,
          noTitulo: 'Cancelamento manual',
          status: 'CANCELADO',
          erroMsg: carimbo,
          terminadoEm: new Date(),
        },
      })
      .catch(() => undefined); // timeline é best-effort: não desfaz o cancelamento
    this.logger.log(`Execução ${execucaoId} cancelada por ${user.id}`);
  }

  // ─── Teste manual ────────────────────────────────────────────────

  async testar(user: AuthenticatedUser, dto: TestarFluxoDto): Promise<{ execucaoId: string }> {
    const fluxo = await this.findOne(user, dto.fluxoId);
    // Testar é MUTAÇÃO na prática (dispara efeitos): dono do pessoal, gestão
    // do da empresa. Gestão NÃO testa fluxo pessoal alheio — a separação que o
    // modelo cria não tem exceção; quem opera o mundo do rep é o token do rep.
    this.assertPodeGerirFluxo(user, fluxo);

    if (fluxo.status === 'ARQUIVADO') {
      throw new BusinessRuleException(
        'Fluxo arquivado não pode ser testado',
        ErrorCode.BUSINESS_RULE_VIOLATION,
      );
    }

    // Basta ter um nó TRIGGER (de onde a execução começa). Fluxos MANUAIS têm nó
    // de gatilho mas `triggerTipo` nulo — e devem poder ser disparados na mão.
    const triggerNo = fluxo.nos.find((n) => n.tipo === 'TRIGGER');
    if (!triggerNo) {
      throw new BusinessRuleException(
        'Fluxo sem nó TRIGGER — adicione um nó de gatilho antes de testar',
        ErrorCode.FLUXO_INVALIDO,
      );
    }

    // Contexto semeado a partir de uma CONVERSA REAL, quando informada.
    // Sem isto, fluxo de WhatsApp com CRIAR_LEAD/TRANSFERIR_ATENDIMENTO morria
    // sempre no primeiro nó — o T1, porta de entrada de todo o inbound, era
    // justamente o fluxo que a ferramenta de teste não conseguia testar.
    let contexto: Record<string, unknown> = { ...dto.contexto };
    if (dto.conversationId) {
      const conversa = await this.prisma.conversation.findFirst({
        where: { id: dto.conversationId, empresaId: fluxo.empresaId },
        select: {
          id: true,
          canal: true,
          leadId: true,
          proprietarioId: true,
          mensagens: {
            where: { direction: 'INBOUND' },
            orderBy: { criadoEm: 'desc' },
            take: 1,
            select: { conteudo: true },
          },
        },
      });
      if (!conversa) {
        throw new BusinessRuleException(
          'Conversa não encontrada nesta empresa — escolha uma conversa do Inbox',
          ErrorCode.BUSINESS_RULE_VIOLATION,
        );
      }
      // MESMO formato do evento MENSAGEM_CANAL real (canal/conversationId/texto/
      // leadId/proprietarioId). Copiar o formato importa: teste que roda com um
      // contexto diferente do de produção valida o fluxo errado.
      contexto = {
        canal: conversa.canal,
        conversationId: conversa.id,
        texto: (contexto.texto as string | undefined) ?? conversa.mensagens[0]?.conteudo ?? '',
        leadId: conversa.leadId ?? null,
        proprietarioId: conversa.proprietarioId ?? null,
        ...contexto,
      };
    } else {
      this.assertTesteNaoPrecisaDeConversa(fluxo.nos, contexto);
    }

    const execucao = await this.prisma.fluxoExecucao.create({
      data: {
        fluxoId: fluxo.id,
        empresaId: fluxo.empresaId,
        status: 'PENDENTE',
        // Coluna, além da marca antiga no contexto (que fica por compat com o
        // que já está gravado). É ela que tira o teste das métricas do painel.
        teste: true,
        contexto: toJson({
          ...contexto,
          _teste: true,
          // Sem isto, o motor manda de verdade. A marca viaja no contexto porque
          // é ela que os nós de envio consultam na hora de decidir.
          _testeEnviaDeVerdade: dto.enviarDeVerdade === true,
        }),
      },
    });

    // Acessa a fila via o bus (que é @InjectQueue internamente)
    // Passamos o trabalho pro bus via disparar (re-usa a mesma fila)
    await this.bus.dispararDireto(execucao.id, triggerNo.id, { tentativas: 1 });

    this.logger.log(
      `Fluxo ${fluxo.id} (${fluxo.nome}) testado manualmente por ${user.id}: exec ${execucao.id}`,
    );
    return { execucaoId: execucao.id };
  }

  /**
   * Ações que só funcionam dentro de uma conversa. Testar um fluxo que as tem
   * sem informar conversa produz execução que falha SEMPRE no primeiro nó — e
   * antes essa execução ainda ia sujar o painel.
   */
  private static readonly ACOES_EXIGEM_CONVERSA = new Set([
    'CRIAR_LEAD',
    'TRANSFERIR_ATENDIMENTO',
    'PAUSAR_IA',
  ]);

  /**
   * Recusa ANTES de criar a execução, em vez de deixar falhar no meio.
   *
   * Recusar é melhor que gerar execução falha por dois motivos: quem testou
   * recebe a instrução certa na hora, e o histórico não ganha um FALHOU que não
   * diz nada sobre o fluxo.
   */
  private assertTesteNaoPrecisaDeConversa(
    nos: Array<{ tipo: string; acaoTipo: string | null; titulo: string }>,
    contexto: Record<string, unknown>,
  ): void {
    if (typeof contexto.conversationId === 'string' && contexto.conversationId) return;
    const bloqueante = nos.find(
      (n) => n.tipo === 'ACAO' && n.acaoTipo && FluxosService.ACOES_EXIGEM_CONVERSA.has(n.acaoTipo),
    );
    if (!bloqueante) return;
    throw new BusinessRuleException(
      `Este fluxo precisa de uma CONVERSA pra ser testado: o nó "${bloqueante.titulo}" ` +
        `(${bloqueante.acaoTipo}) age sobre uma conversa de WhatsApp, que o teste não inventa. ` +
        'Escolha uma conversa existente no teste (campo "conversa") — ou teste mandando ' +
        'mensagem real pro número. Nenhuma execução foi criada.',
      ErrorCode.BUSINESS_RULE_VIOLATION,
    );
  }

  // ─── Métricas ────────────────────────────────────────────────────

  async metricas(
    user: AuthenticatedUser,
    id: string,
  ): Promise<{
    total: number;
    concluidos: number;
    falhos: number;
    emExecucao: number;
    taxaSucesso: number;
    /** Execuções de teste (NÃO entram em nenhum dos números acima). */
    testes: number;
  }> {
    await this.findOne(user, id);

    // PRODUÇÃO apenas. Execução de teste não é resultado do fluxo: as duas do
    // T1 (um fluxo PAUSADO, que nunca viu mensagem real) faziam o painel anunciar
    // "0% de sucesso" e mandaram alguém investigar um bug que não existia.
    const producao = { fluxoId: id, teste: false } as const;
    const [total, concluidos, falhos, emExecucao, testes] = await Promise.all([
      this.prisma.fluxoExecucao.count({ where: producao }),
      this.prisma.fluxoExecucao.count({ where: { ...producao, status: 'CONCLUIDO' } }),
      this.prisma.fluxoExecucao.count({ where: { ...producao, status: 'FALHOU' } }),
      this.prisma.fluxoExecucao.count({
        where: { ...producao, status: { in: ['PENDENTE', 'EM_EXECUCAO'] } },
      }),
      this.prisma.fluxoExecucao.count({ where: { fluxoId: id, teste: true } }),
    ]);

    // Denominador = o que TERMINOU (concluído + falhou). Fora ficam as
    // CANCELADAS — mensagem nova do mesmo lead cancela a execução anterior, é o
    // desenho do fluxo, não erro — e as ainda em voo. Com o total cru, o C1/C2
    // do bot marcava 11% de sucesso sem um único erro (14 canceladas × 2 ok).
    const terminadas = concluidos + falhos;
    const taxaSucesso = terminadas > 0 ? Math.round((concluidos / terminadas) * 100) : 0;
    // `testes` vai junto pra tela poder dizer "nunca rodou em produção (N testes)"
    // em vez de "0% de sucesso", que é a leitura que enganou.
    return { total, concluidos, falhos, emExecucao, taxaSucesso, testes };
  }
}
