import { Injectable, Logger } from '@nestjs/common';
import { type AmostraStatus, Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import {
  OmieAmostrasService,
  type OmieAmostraEnvioResult,
} from '@integrations/omie/omie-amostras.service';
import {
  BusinessRuleException,
  ForbiddenException,
  NotFoundException,
} from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { RepScopeService } from '@shared/scope/rep-scope.service';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { type Paginated, buildPaginated } from '@shared/types/pagination';
import {
  type AmostraModo,
  avaliarSubsidiada,
  primeiroModoAtivo,
  resolveAmostraModos,
} from './amostra-modos.util';
import type {
  ChangeAmostraStatusDto,
  CreateAmostraDto,
  ListAmostrasDto,
  RejeitarAmostraDto,
  UpdateAmostraDto,
} from './amostras.dto';

/** Status de pedido que contam como "faturados" pra média kg/mês do cliente. */
const PEDIDO_STATUS_FATURADOS = [
  'ENVIADO_OMIE',
  'PAGO',
  'EM_SEPARACAO',
  'ENVIADO',
  'ENTREGUE',
] as const;

const amostraInclude = {
  cliente: { select: { id: true, nome: true, cnpj: true } },
  produto: { select: { id: true, nome: true, codigoOmie: true, sku: true, unidade: true } },
} satisfies Prisma.AmostraInclude;

type AmostraWithRel = Prisma.AmostraGetPayload<{ include: typeof amostraInclude }>;

/**
 * Amostras enviadas a prospects/clientes.
 *
 * Fluxo:
 *  1. Rep solicita amostra → ENVIADA
 *  2. Após X dias → AGUARDANDO_FOLLOWUP
 *  3. Rep marca como CONVERTIDA (virou pedido) ou NAO_CONVERTEU
 *  4. Se passar 30d sem decisão → VENCIDA (job futuro pode automatizar)
 */
@Injectable()
export class AmostrasService {
  private readonly logger = new Logger(AmostrasService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repScope: RepScopeService,
    private readonly omieAmostras: OmieAmostrasService,
  ) {}

  private requireEmpresa(user: AuthenticatedUser): string {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    return user.empresaIdAtiva;
  }

  private async baseWhere(user: AuthenticatedUser): Promise<Prisma.AmostraWhereInput> {
    const where: Prisma.AmostraWhereInput = { empresaId: this.requireEmpresa(user) };
    const scope = await this.repScope.getRepIds(user);
    if (scope !== null) {
      where.cliente = { representanteId: { in: scope } };
    }
    return where;
  }

  async list(user: AuthenticatedUser, params: ListAmostrasDto): Promise<Paginated<AmostraWithRel>> {
    const where: Prisma.AmostraWhereInput = { ...(await this.baseWhere(user)) };
    const conds: Prisma.AmostraWhereInput[] = [];
    if (params.status) conds.push({ status: params.status });
    if (params.clienteId) conds.push({ clienteId: params.clienteId });
    if (params.vencidas) {
      conds.push({
        followUpEm: { lte: new Date() },
        status: { in: ['ENVIADA', 'AGUARDANDO_FOLLOWUP'] },
      });
    }
    if (conds.length > 0) where.AND = conds;

    const [total, data] = await Promise.all([
      this.prisma.amostra.count({ where }),
      this.prisma.amostra.findMany({
        where,
        skip: (params.page - 1) * params.limit,
        take: params.limit,
        orderBy: { [params.sortBy]: params.sortOrder },
        include: amostraInclude,
      }),
    ]);
    return buildPaginated(data, total, params.page, params.limit);
  }

  async findById(user: AuthenticatedUser, id: string): Promise<AmostraWithRel> {
    const amostra = await this.prisma.amostra.findFirst({
      where: { id, ...(await this.baseWhere(user)) },
      include: amostraInclude,
    });
    if (!amostra) throw new NotFoundException('Amostra', id);
    return amostra;
  }

  async create(user: AuthenticatedUser, dto: CreateAmostraDto): Promise<AmostraWithRel> {
    const empresaId = this.requireEmpresa(user);
    // valida que o cliente pertence à empresa e (se rep) à carteira
    const cliente = await this.prisma.cliente.findFirst({
      where: { id: dto.clienteId, empresaId },
      select: { id: true, representanteId: true },
    });
    if (!cliente) throw new NotFoundException('Cliente', dto.clienteId);
    const scope = await this.repScope.getRepIds(user);
    if (
      scope !== null &&
      (cliente.representanteId === null || !scope.includes(cliente.representanteId))
    ) {
      throw new ForbiddenException('Cliente não pertence à sua carteira');
    }

    // P7 — se vincular produto do catálogo, valida que pertence à empresa.
    if (dto.produtoId) {
      const produto = await this.prisma.produto.findFirst({
        where: { id: dto.produtoId, empresaId },
        select: { id: true },
      });
      if (!produto) throw new NotFoundException('Produto', dto.produtoId);
    }

    // Modos + elegibilidade configuráveis por tenant (Empresa.config.amostraModos).
    const cfg = resolveAmostraModos(await this.lerConfigAmostra(empresaId));
    const modo: AmostraModo = dto.modo ?? primeiroModoAtivo(cfg) ?? 'subsidiada';
    if (!cfg.modosAtivos[modo]) {
      throw new BusinessRuleException(`Modo de amostra "${modo}" não está ativo nesta empresa`);
    }

    // Subsidiada (empresa paga) pode cair na fila de aprovação da diretoria.
    let status: AmostraStatus = 'ENVIADA';
    let mediaKgMes: number | null = null;
    if (modo === 'subsidiada') {
      if (cfg.elegibilidadeSubsidiada.tipo === 'media_kg_mes') {
        mediaKgMes = await this.calcularMediaKgMes(
          empresaId,
          dto.clienteId,
          cfg.elegibilidadeSubsidiada.mesesJanela,
        );
      }
      const { precisaAprovacao } = avaliarSubsidiada(cfg, mediaKgMes);
      if (precisaAprovacao) status = 'PENDENTE_APROVACAO';
    }

    const enviadoEm = dto.enviadoEm ?? new Date();
    const followUpEm =
      status === 'ENVIADA'
        ? new Date(enviadoEm.getTime() + dto.diasFollowUp * 24 * 60 * 60 * 1000)
        : null;

    return this.prisma.amostra.create({
      data: {
        empresaId,
        clienteId: dto.clienteId,
        produtoNome: dto.produtoNome,
        produtoId: dto.produtoId,
        quantidade: dto.quantidade,
        valor: dto.valor,
        notaFiscal: dto.notaFiscal,
        enviadoEm,
        followUpEm,
        status,
        modo,
        mediaKgMes,
        representanteNome: dto.representanteNome ?? (user.role === 'REP' ? user.nome : undefined),
      },
      include: amostraInclude,
    });
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateAmostraDto,
  ): Promise<AmostraWithRel> {
    const existing = await this.findById(user, id);
    // P7 — valida vínculo de produto (quando trocado) contra o tenant.
    if (dto.produtoId) {
      const produto = await this.prisma.produto.findFirst({
        where: { id: dto.produtoId, empresaId: existing.empresaId },
        select: { id: true },
      });
      if (!produto) throw new NotFoundException('Produto', dto.produtoId);
    }
    await this.prisma.amostra.updateMany({
      where: { id, empresaId: existing.empresaId },
      data: dto,
    });
    return this.prisma.amostra.findUniqueOrThrow({ where: { id }, include: amostraInclude });
  }

  async changeStatus(
    user: AuthenticatedUser,
    id: string,
    dto: ChangeAmostraStatusDto,
  ): Promise<AmostraWithRel> {
    const existing = await this.findById(user, id);
    // Os status da fila de aprovação só são movidos por aprovar/rejeitar — não pelo set genérico.
    if (dto.status === 'PENDENTE_APROVACAO' || dto.status === 'REJEITADA') {
      throw new BusinessRuleException(
        'Use aprovar/rejeitar para mover amostras na fila de aprovação',
      );
    }
    if (existing.status === 'PENDENTE_APROVACAO') {
      throw new BusinessRuleException(
        'Amostra pendente de aprovação: use aprovar ou rejeitar primeiro',
      );
    }
    // Whitelist de transições do lifecycle: estados terminais (CONVERTIDA/NAO_CONVERTEU/
    // VENCIDA) NÃO voltam — sem isto, dava pra "des-converter" uma amostra CONVERTIDA.
    const AMOSTRA_TRANSICOES: Record<string, string[]> = {
      ENVIADA: ['AGUARDANDO_FOLLOWUP', 'CONVERTIDA', 'NAO_CONVERTEU', 'VENCIDA'],
      AGUARDANDO_FOLLOWUP: ['ENVIADA', 'CONVERTIDA', 'NAO_CONVERTEU', 'VENCIDA'],
      CONVERTIDA: [],
      NAO_CONVERTEU: [],
      VENCIDA: [],
    };
    const permitidos = AMOSTRA_TRANSICOES[existing.status] ?? [];
    if (!permitidos.includes(dto.status)) {
      throw new BusinessRuleException(`Transição inválida: ${existing.status} → ${dto.status}`);
    }
    // CAS: status de origem no where evita dupla-transição concorrente (last-write-wins).
    const cas = await this.prisma.amostra.updateMany({
      where: { id, empresaId: existing.empresaId, status: existing.status },
      data: { status: dto.status },
    });
    if (cas.count === 0) {
      throw new BusinessRuleException('Amostra mudou de status — recarregue e tente novamente');
    }
    return this.prisma.amostra.findUniqueOrThrow({ where: { id }, include: amostraInclude });
  }

  /** Aprova uma amostra subsidiada pendente → ENVIADA (DIRECTOR/ADMIN). */
  async aprovar(user: AuthenticatedUser, id: string): Promise<AmostraWithRel> {
    const existing = await this.findById(user, id);
    if (existing.status !== 'PENDENTE_APROVACAO') {
      throw new BusinessRuleException('Amostra não está pendente de aprovação');
    }
    const enviadoEm = existing.enviadoEm ?? new Date();
    // CAS: só aprova se ainda PENDENTE_APROVACAO (corrida aprovar×rejeitar / duplo-clique).
    const cas = await this.prisma.amostra.updateMany({
      where: { id, empresaId: existing.empresaId, status: 'PENDENTE_APROVACAO' },
      data: {
        status: 'ENVIADA',
        aprovadorId: user.id,
        aprovadorNome: user.nome,
        aprovadoEm: new Date(),
        // follow-up passa a contar a partir da aprovação (5 dias padrão).
        followUpEm: new Date(enviadoEm.getTime() + 5 * 24 * 60 * 60 * 1000),
      },
    });
    if (cas.count === 0) {
      throw new BusinessRuleException('Amostra já foi decidida — recarregue');
    }
    return this.prisma.amostra.findUniqueOrThrow({ where: { id }, include: amostraInclude });
  }

  /** Rejeita uma amostra subsidiada pendente → REJEITADA (DIRECTOR/ADMIN). */
  async rejeitar(
    user: AuthenticatedUser,
    id: string,
    dto: RejeitarAmostraDto,
  ): Promise<AmostraWithRel> {
    const existing = await this.findById(user, id);
    if (existing.status !== 'PENDENTE_APROVACAO') {
      throw new BusinessRuleException('Amostra não está pendente de aprovação');
    }
    // CAS: só rejeita se ainda PENDENTE_APROVACAO (corrida aprovar×rejeitar / duplo-clique).
    const cas = await this.prisma.amostra.updateMany({
      where: { id, empresaId: existing.empresaId, status: 'PENDENTE_APROVACAO' },
      data: {
        status: 'REJEITADA',
        aprovadorId: user.id,
        aprovadorNome: user.nome,
        aprovadoEm: new Date(),
        motivoDecisao: dto.motivo,
      },
    });
    if (cas.count === 0) {
      throw new BusinessRuleException('Amostra já foi decidida — recarregue');
    }
    return this.prisma.amostra.findUniqueOrThrow({ where: { id }, include: amostraInclude });
  }

  /** Lê Empresa.config.amostraModos (cru). */
  private async lerConfigAmostra(empresaId: string): Promise<unknown> {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { config: true },
    });
    return (empresa?.config as { amostraModos?: unknown } | null)?.amostraModos;
  }

  /**
   * Média de kg/mês faturados do cliente na janela (meses). Peso = Σ qtd ×
   * Produto.pesoPorUnidade dos pedidos faturados; denominador = nº de meses.
   */
  private async calcularMediaKgMes(
    empresaId: string,
    clienteId: string,
    meses: number,
  ): Promise<number> {
    const desde = new Date(Date.now() - meses * 30 * 24 * 60 * 60 * 1000);
    const pedidos = await this.prisma.pedido.findMany({
      where: {
        empresaId,
        clienteId,
        status: { in: [...PEDIDO_STATUS_FATURADOS] },
        criadoEm: { gte: desde },
      },
      select: {
        itens: { select: { quantidade: true, produto: { select: { pesoPorUnidade: true } } } },
      },
    });
    let kg = 0;
    for (const p of pedidos) {
      for (const it of p.itens) {
        const peso = it.produto?.pesoPorUnidade;
        kg += it.quantidade * (peso != null ? Number(peso) : 0);
      }
    }
    return meses > 0 ? kg / meses : kg;
  }

  async remove(user: AuthenticatedUser, id: string): Promise<void> {
    const existing = await this.findById(user, id);
    await this.prisma.amostra.deleteMany({ where: { id, empresaId: existing.empresaId } });
  }

  /**
   * P7 — Envia a amostra como remessa de amostra grátis pro OMIE.
   *
   * findById valida tenant + carteira do rep. As pré-condições fiscais
   * (produto vinculado com codigoOmie, cliente ATIVO com codigoOmie, etc.)
   * ficam no OmieAmostrasService, que também persiste numeroOmie/enviadoOmieEm/cfop.
   */
  async enviarParaOmie(
    user: AuthenticatedUser,
    id: string,
  ): Promise<{ amostra: AmostraWithRel; omie: OmieAmostraEnvioResult }> {
    const amostra = await this.findById(user, id);
    const omie = await this.omieAmostras.enviarAmostra(id, amostra.empresaId);
    const atualizada = await this.findById(user, id);
    return { amostra: atualizada, omie };
  }
}
