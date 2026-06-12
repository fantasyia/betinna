import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import {
  BusinessRuleException,
  ForbiddenException,
  NotFoundException,
} from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { type Paginated, buildPaginated } from '@shared/types/pagination';
import { FluxoEventBusService } from './fluxo-event-bus.service';
import type {
  CreateFluxoDto,
  UpdateFluxoDto,
  ListFluxosDto,
  ListExecucoesDto,
  TestarFluxoDto,
  ImportFluxoDto,
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

const fluxoInclude = {
  nos: { orderBy: { posY: 'asc' as const } },
  arestas: true,
  _count: { select: { execucoes: true } },
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
  ) {}

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

  // ─── Validação do grafo ──────────────────────────────────────────

  /**
   * Valida estrutura mínima do grafo antes de ativar.
   * - Precisa ter exatamente 1 nó TRIGGER.
   * - Todo nó ACAO precisa de acaoTipo.
   * - Nenhuma aresta pode referenciar nó inexistente.
   */
  private validarGrafo(
    nos: { id: string; tipo: string; acaoTipo?: string | null }[],
    arestas: { sourceNoId: string; targetNoId: string }[],
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
    }
  }

  // ─── CRUD ───────────────────────────────────────────────────────

  async create(user: AuthenticatedUser, dto: CreateFluxoDto): Promise<FluxoWithRel> {
    this.requireAdminOrDirector(user);
    const empresaId = this.requireEmpresa(user);

    // Cria fluxo + nós + arestas em transação
    let fluxoId!: string;
    await this.prisma.$transaction(async (tx) => {
      const created = await tx.fluxo.create({
        data: {
          empresaId,
          nome: dto.nome,
          descricao: dto.descricao ?? null,
          triggerTipo: dto.triggerTipo ?? null,
          triggerConfig: dto.triggerConfig ? toJson(dto.triggerConfig) : Prisma.JsonNull,
          status: 'RASCUNHO',
        },
      });
      fluxoId = created.id;

      if (dto.nos.length > 0) {
        await tx.fluxoNo.createMany({
          data: dto.nos.map((n) => ({
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
      if (dto.arestas.length > 0) {
        await tx.fluxoEdge.createMany({
          data: dto.arestas.map((e) => ({
            id: e.id,
            fluxoId: created.id,
            sourceNoId: e.sourceNoId,
            targetNoId: e.targetNoId,
            label: e.label ?? null,
          })),
        });
      }
    });

    this.logger.log(`Fluxo criado: ${fluxoId} (${dto.nome}) por ${user.email}`);
    return this.findOneById(fluxoId);
  }

  async list(user: AuthenticatedUser, params: ListFluxosDto): Promise<Paginated<FluxoWithRel>> {
    const empresaId = this.requireEmpresa(user);
    const where: Prisma.FluxoWhereInput = { empresaId };

    if (params.status) where.status = params.status;
    if (params.triggerTipo) where.triggerTipo = params.triggerTipo;
    if (params.search) {
      where.OR = [
        { nome: { contains: params.search, mode: 'insensitive' } },
        { descricao: { contains: params.search, mode: 'insensitive' } },
      ];
    }

    const skip = (params.page - 1) * params.limit;
    const [data, total] = await Promise.all([
      this.prisma.fluxo.findMany({
        where,
        include: fluxoInclude,
        skip,
        take: params.limit,
        orderBy: { atualizadoEm: 'desc' },
      }),
      this.prisma.fluxo.count({ where }),
    ]);

    return buildPaginated(data, total, params.page, params.limit);
  }

  async findOne(user: AuthenticatedUser, id: string): Promise<FluxoWithRel> {
    const empresaId = this.requireEmpresa(user);
    const fluxo = await this.prisma.fluxo.findFirst({
      where: { id, empresaId },
      include: fluxoInclude,
    });
    if (!fluxo) throw new NotFoundException(`Fluxo ${id} não encontrado`);
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
    this.requireAdminOrDirector(user);
    const existing = await this.findOne(user, id);

    if (existing.status === 'ARQUIVADO') {
      throw new BusinessRuleException(
        'Fluxos arquivados não podem ser editados',
        ErrorCode.BUSINESS_RULE_VIOLATION,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      // Se nos/arestas foram fornecidos, faz full replace
      if (dto.nos !== undefined || dto.arestas !== undefined) {
        // Delete arestas primeiro (FK para nos)
        await tx.fluxoEdge.deleteMany({ where: { fluxoId: id } });
        await tx.fluxoNo.deleteMany({ where: { fluxoId: id } });

        if (dto.nos?.length) {
          await tx.fluxoNo.createMany({
            data: dto.nos.map((n) => ({
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
        if (dto.arestas?.length) {
          await tx.fluxoEdge.createMany({
            data: dto.arestas.map((e) => ({
              id: e.id,
              fluxoId: id,
              sourceNoId: e.sourceNoId,
              targetNoId: e.targetNoId,
              label: e.label ?? null,
            })),
          });
        }
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
      if (existing.status === 'ATIVO' && (dto.nos !== undefined || dto.arestas !== undefined)) {
        updateData.status = 'RASCUNHO';
      }

      await tx.fluxo.update({ where: { id }, data: updateData });
    });

    this.logger.log(`Fluxo ${id} atualizado por ${user.email}`);
    return this.findOne(user, id);
  }

  async ativar(user: AuthenticatedUser, id: string): Promise<FluxoWithRel> {
    this.requireAdminOrDirector(user);
    const fluxo = await this.findOne(user, id);

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

    // Começa LIMPO: cancela execuções velhas que ficaram em voo (ex: fluxo
    // pausado antes do fix de cancelamento). Sem isto, reativar ressuscitava
    // execuções antigas e elas voltavam a disparar/spammar.
    await this.cancelarExecucoesEmAndamento(id);
    await this.prisma.fluxo.update({ where: { id }, data: { status: 'ATIVO' } });
    this.logger.log(`Fluxo ${id} ativado por ${user.email}`);
    return this.findOneById(id);
  }

  async pausar(user: AuthenticatedUser, id: string): Promise<FluxoWithRel> {
    this.requireAdminOrDirector(user);
    const fluxo = await this.findOne(user, id);

    if (fluxo.status !== 'ATIVO') {
      throw new BusinessRuleException(
        'Apenas fluxos ativos podem ser pausados',
        ErrorCode.BUSINESS_RULE_VIOLATION,
      );
    }

    await this.prisma.fluxo.update({ where: { id }, data: { status: 'PAUSADO' } });
    const cancel = await this.cancelarExecucoesEmAndamento(id);
    this.logger.log(`Fluxo ${id} pausado por ${user.email} (${cancel} execução(ões) cancelada(s))`);
    return this.findOneById(id);
  }

  async arquivar(user: AuthenticatedUser, id: string): Promise<FluxoWithRel> {
    this.requireAdminOrDirector(user);
    await this.findOne(user, id);
    await this.prisma.fluxo.update({ where: { id }, data: { status: 'ARQUIVADO' } });
    const cancel = await this.cancelarExecucoesEmAndamento(id);
    this.logger.log(
      `Fluxo ${id} arquivado por ${user.email} (${cancel} execução(ões) cancelada(s))`,
    );
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
    this.requireAdminOrDirector(user);
    await this.findOne(user, id); // valida tenant + existência
    await this.prisma.$transaction([
      this.prisma.fluxoExecucao.deleteMany({ where: { fluxoId: id } }),
      this.prisma.fluxo.delete({ where: { id } }),
    ]);
    this.logger.log(`Fluxo ${id} EXCLUÍDO permanentemente por ${user.email}`);
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
    this.requireAdminOrDirector(user);

    const idMap = new Map<string, string>();
    for (const n of dto.nos) idMap.set(n.id, randomUUID());

    const nos = dto.nos.map((n) => ({
      id: idMap.get(n.id) as string,
      tipo: n.tipo,
      acaoTipo: n.acaoTipo ?? undefined,
      titulo: n.titulo,
      config: n.config,
      posX: n.posX,
      posY: n.posY,
    }));
    const arestas = dto.arestas.map((e) => ({
      id: randomUUID(),
      sourceNoId: idMap.get(e.sourceNoId) as string,
      targetNoId: idMap.get(e.targetNoId) as string,
      label: e.label ?? null,
    }));

    const fluxo = await this.create(user, {
      nome: dto.nome,
      descricao: dto.descricao ?? undefined,
      triggerTipo: dto.triggerTipo ?? undefined,
      triggerConfig: dto.triggerConfig ?? undefined,
      nos,
      arestas,
    });
    this.logger.log(`Fluxo importado: ${fluxo.id} (${dto.nome}) por ${user.email}`);
    return fluxo;
  }

  // ─── Execuções ───────────────────────────────────────────────────

  async listExecucoes(
    user: AuthenticatedUser,
    fluxoId: string,
    params: ListExecucoesDto,
  ): Promise<Paginated<ExecucaoWithLogs>> {
    const fluxo = await this.findOne(user, fluxoId);

    const where: Prisma.FluxoExecucaoWhereInput = { fluxoId: fluxo.id };
    if (params.status) where.status = params.status;

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

    return buildPaginated(data, total, params.page, params.limit);
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

    await this.prisma.fluxoExecucao.update({
      where: { id: execucaoId },
      data: { status: 'CANCELADO', terminouEm: new Date() },
    });
    this.logger.log(`Execução ${execucaoId} cancelada por ${user.email}`);
  }

  // ─── Teste manual ────────────────────────────────────────────────

  async testar(user: AuthenticatedUser, dto: TestarFluxoDto): Promise<{ execucaoId: string }> {
    this.requireAdminOrDirector(user);
    const fluxo = await this.findOne(user, dto.fluxoId);

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

    const execucao = await this.prisma.fluxoExecucao.create({
      data: {
        fluxoId: fluxo.id,
        empresaId: fluxo.empresaId,
        status: 'PENDENTE',
        contexto: toJson({ ...dto.contexto, _teste: true }),
      },
    });

    // Acessa a fila via o bus (que é @InjectQueue internamente)
    // Passamos o trabalho pro bus via disparar (re-usa a mesma fila)
    await this.bus.dispararDireto(execucao.id, triggerNo.id, { tentativas: 1 });

    this.logger.log(
      `Fluxo ${fluxo.id} (${fluxo.nome}) testado manualmente por ${user.email}: exec ${execucao.id}`,
    );
    return { execucaoId: execucao.id };
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
  }> {
    await this.findOne(user, id);

    const [total, concluidos, falhos, emExecucao] = await Promise.all([
      this.prisma.fluxoExecucao.count({ where: { fluxoId: id } }),
      this.prisma.fluxoExecucao.count({ where: { fluxoId: id, status: 'CONCLUIDO' } }),
      this.prisma.fluxoExecucao.count({ where: { fluxoId: id, status: 'FALHOU' } }),
      this.prisma.fluxoExecucao.count({
        where: { fluxoId: id, status: { in: ['PENDENTE', 'EM_EXECUCAO'] } },
      }),
    ]);

    const taxaSucesso = total > 0 ? Math.round((concluidos / total) * 100) : 0;
    return { total, concluidos, falhos, emExecucao, taxaSucesso };
  }
}
