import { Injectable, Logger } from '@nestjs/common';
import type { Devolucao, Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import {
  BusinessRuleException,
  ForbiddenException,
  NotFoundException,
} from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { RepScopeService } from '@shared/scope/rep-scope.service';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { type Paginated, buildPaginated } from '@shared/types/pagination';
import { SequenceService } from '@shared/utils/sequence.service';
import { DEVOLUCAO_TRANSICOES, addDiasUteis, resolveDevolucaoConfig } from './devolucao.util';
import type {
  CreateDevolucaoDto,
  ListDevolucoesDto,
  MudarStatusDevolucaoDto,
} from './devolucoes.dto';

@Injectable()
export class DevolucoesService {
  private readonly logger = new Logger(DevolucoesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repScope: RepScopeService,
    private readonly sequence: SequenceService,
  ) {}

  private requireEmpresa(user: AuthenticatedUser): string {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    return user.empresaIdAtiva;
  }

  private async lerConfig(empresaId: string) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { config: true },
    });
    return resolveDevolucaoConfig(
      (empresa?.config as { devolucaoInterna?: unknown } | null)?.devolucaoInterna,
    );
  }

  async list(user: AuthenticatedUser, params: ListDevolucoesDto): Promise<Paginated<Devolucao>> {
    const empresaId = this.requireEmpresa(user);
    const where: Prisma.DevolucaoWhereInput = { empresaId };
    if (params.status) where.status = params.status;
    if (params.pedidoId) where.pedidoId = params.pedidoId;
    // REP vê só as que abriu; ADMIN/DIRECTOR/GERENTE veem todas da empresa.
    const scope = await this.repScope.getRepIds(user);
    if (scope !== null) where.criadoPorId = { in: scope };

    const [total, data] = await Promise.all([
      this.prisma.devolucao.count({ where }),
      this.prisma.devolucao.findMany({
        where,
        skip: (params.page - 1) * params.limit,
        take: params.limit,
        orderBy: { criadoEm: 'desc' },
      }),
    ]);
    return buildPaginated(data, total, params.page, params.limit);
  }

  async findById(user: AuthenticatedUser, id: string): Promise<Devolucao> {
    const dev = await this.prisma.devolucao.findFirst({
      where: { id, empresaId: this.requireEmpresa(user) },
    });
    if (!dev) throw new NotFoundException('Devolução', id);
    const scope = await this.repScope.getRepIds(user);
    if (scope !== null && (dev.criadoPorId === null || !scope.includes(dev.criadoPorId))) {
      throw new ForbiddenException('Você não tem acesso a esta devolução');
    }
    return dev;
  }

  async abrir(user: AuthenticatedUser, dto: CreateDevolucaoDto): Promise<Devolucao> {
    const empresaId = this.requireEmpresa(user);
    const pedido = await this.prisma.pedido.findFirst({
      where: { id: dto.pedidoId, empresaId },
      select: { id: true, clienteId: true, representanteId: true, entregueEm: true },
    });
    if (!pedido) throw new NotFoundException('Pedido', dto.pedidoId);

    const scope = await this.repScope.getRepIds(user);
    if (
      scope !== null &&
      (pedido.representanteId === null || !scope.includes(pedido.representanteId))
    ) {
      throw new ForbiddenException('Pedido não pertence à sua carteira');
    }

    const cfg = await this.lerConfig(empresaId);
    const motivo = cfg.motivos.find((m) => m.key === dto.motivo);
    if (!motivo) {
      throw new BusinessRuleException(`Motivo de devolução "${dto.motivo}" inválido`);
    }
    if (motivo.fotosObrigatorias && (!dto.fotos || dto.fotos.length === 0)) {
      throw new BusinessRuleException(`O motivo "${motivo.label}" exige ao menos uma foto`);
    }

    // Janela pós-entrega (se o pedido já foi entregue).
    if (pedido.entregueEm) {
      const limite = new Date(
        pedido.entregueEm.getTime() + cfg.janelaPosEntregaDias * 24 * 60 * 60 * 1000,
      );
      if (new Date() > limite) {
        throw new BusinessRuleException(
          `Fora da janela de devolução (${cfg.janelaPosEntregaDias} dias após a entrega)`,
        );
      }
    }

    const seq = await this.sequence.next(empresaId, 'devolucao');
    const numero = `DEV-${seq.toString().padStart(4, '0')}`;
    const slaAnaliseEm = addDiasUteis(new Date(), cfg.slaAnaliseDiasUteis);

    return this.prisma.devolucao.create({
      data: {
        empresaId,
        numero,
        pedidoId: pedido.id,
        clienteId: pedido.clienteId,
        motivo: dto.motivo,
        status: 'ABERTA',
        itensDescricao: dto.itensDescricao,
        observacao: dto.observacao,
        fotos: dto.fotos ?? [],
        slaAnaliseEm,
        criadoPorId: user.id,
        criadoPorNome: user.nome,
      },
    });
  }

  /** Move a devolução no lifecycle (DIRECTOR/ADMIN). Set genérico só nas transições válidas. */
  async mudarStatus(
    user: AuthenticatedUser,
    id: string,
    dto: MudarStatusDevolucaoDto,
  ): Promise<Devolucao> {
    const existing = await this.findById(user, id);
    const permitidos = DEVOLUCAO_TRANSICOES[existing.status] ?? [];
    if (!permitidos.includes(dto.status)) {
      throw new BusinessRuleException(`Transição inválida: ${existing.status} → ${dto.status}`);
    }
    if (dto.status === 'RECUSADA' && !dto.motivoRecusa?.trim()) {
      throw new BusinessRuleException('Informe o motivo da recusa');
    }

    const decisao = dto.status === 'APROVADA' || dto.status === 'RECUSADA';
    await this.prisma.devolucao.updateMany({
      where: { id, empresaId: existing.empresaId },
      data: {
        status: dto.status,
        ...(decisao
          ? { aprovadorId: user.id, aprovadorNome: user.nome, decididoEm: new Date() }
          : {}),
        ...(dto.status === 'RECUSADA' ? { motivoRecusa: dto.motivoRecusa?.trim() } : {}),
      },
    });
    this.logger.log(`Devolução ${existing.numero}: ${existing.status} → ${dto.status}`);
    return this.prisma.devolucao.findUniqueOrThrow({ where: { id } });
  }
}
