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
    // REP/GERENTE veem as que abriram (criadoPorId = user.id) + as dos subordinados;
    // ADMIN/DIRECTOR/SAC veem todas. Sem o user.id, o GERENTE não via as próprias.
    const scope = await this.repScope.getRepIds(user);
    if (scope !== null) where.criadoPorId = { in: [user.id, ...scope] };

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
    const visiveis = scope === null ? null : [user.id, ...scope];
    if (visiveis && (dev.criadoPorId === null || !visiveis.includes(dev.criadoPorId))) {
      throw new ForbiddenException('Você não tem acesso a esta devolução');
    }
    return dev;
  }

  async abrir(user: AuthenticatedUser, dto: CreateDevolucaoDto): Promise<Devolucao> {
    const empresaId = this.requireEmpresa(user);
    const pedido = await this.prisma.pedido.findFirst({
      where: { id: dto.pedidoId, empresaId },
      select: { id: true, clienteId: true, representanteId: true, entregueEm: true, total: true },
    });
    if (!pedido) throw new NotFoundException('Pedido', dto.pedidoId);

    // Valor devolvido não pode passar do total do pedido (base do estorno).
    if (dto.valorDevolvido != null && dto.valorDevolvido > Number(pedido.total)) {
      throw new BusinessRuleException('Valor devolvido não pode exceder o total do pedido');
    }

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
        valorDevolvido: dto.valorDevolvido ?? null,
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
    // Estorno de comissão só quando APROVADA E a config do tenant liga (default true).
    const estornar =
      dto.status === 'APROVADA' &&
      (await this.lerConfig(existing.empresaId)).estornoComissaoProporcional;

    // CAS + estorno na MESMA transação: se a decisão perde a corrida (count 0), nada é
    // estornado (rollback). Só a 1ª decisão a partir de EM_ANALISE casa; a 2ª acha count 0.
    await this.prisma.$transaction(async (tx) => {
      const cas = await tx.devolucao.updateMany({
        where: { id, empresaId: existing.empresaId, status: existing.status },
        data: {
          status: dto.status,
          ...(decisao
            ? { aprovadorId: user.id, aprovadorNome: user.nome, decididoEm: new Date() }
            : {}),
          ...(dto.status === 'RECUSADA' ? { motivoRecusa: dto.motivoRecusa?.trim() } : {}),
        },
      });
      if (cas.count === 0) {
        throw new BusinessRuleException(
          `Devolução mudou de status — recarregue (esperado ${existing.status})`,
        );
      }
      if (estornar) await this.aplicarEstornoComissao(tx, existing);
    });
    this.logger.log(`Devolução ${existing.numero}: ${existing.status} → ${dto.status}`);
    return this.prisma.devolucao.findUniqueOrThrow({ where: { id } });
  }

  /**
   * Estorno proporcional de comissão na devolução APROVADA: acumula em
   * `Pedido.comissaoEstornada`/`valorDevolvido` — o `fecharMes` desconta destes
   * (líquido no MÊS do pedido; nunca mexe em folha já paga). Aplicado 1x: a CAS
   * da transição pra APROVADA garante que só a 1ª decisão executa.
   */
  private async aplicarEstornoComissao(
    tx: Prisma.TransactionClient,
    dev: Devolucao,
  ): Promise<void> {
    const pedido = await tx.pedido.findUnique({
      where: { id: dev.pedidoId },
      select: { total: true, comissao: true, comissaoEstornada: true, valorDevolvido: true },
    });
    if (!pedido) return;
    const total = Number(pedido.total);
    const comissao = Number(pedido.comissao);
    if (total <= 0 || comissao <= 0) return; // nada a estornar

    // Valor devolvido: informado na devolução ou devolução total; limitado ao que
    // ainda resta do pedido (devoluções parciais múltiplas não estornam além do total).
    const restante = Math.max(0, total - Number(pedido.valorDevolvido));
    const valorDev = Math.min(
      dev.valorDevolvido != null ? Number(dev.valorDevolvido) : total,
      restante,
    );
    if (valorDev <= 0) return;

    const estornoBruto = Math.round(comissao * (valorDev / total) * 100) / 100;
    // Clamp: nunca estornar mais que a comissão total do pedido (acumulado).
    const estorno = Math.min(
      estornoBruto,
      Math.max(0, comissao - Number(pedido.comissaoEstornada)),
    );

    await tx.pedido.update({
      where: { id: dev.pedidoId },
      data: {
        comissaoEstornada: { increment: estorno },
        valorDevolvido: { increment: valorDev },
      },
    });
    this.logger.log(
      `Estorno comissão dev ${dev.numero}: pedido ${dev.pedidoId} -R$${estorno.toFixed(2)} ` +
        `(devolvido R$${valorDev.toFixed(2)}/${total.toFixed(2)})`,
    );
  }
}
