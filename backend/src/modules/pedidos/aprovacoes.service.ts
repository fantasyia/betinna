import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
import type { DecidirAprovacaoDto, ListAprovacoesDto } from './aprovacoes.dto';
import { FluxoEventBusService } from '@modules/fluxos/fluxo-event-bus.service';
import { NotificacoesService } from '@modules/notificacoes/notificacoes.service';
import { TransactionalEmailService } from '@integrations/email/transactional-email.service';

const aprovacaoInclude = {
  pedido: {
    include: {
      cliente: { select: { id: true, nome: true } },
      itens: { select: { id: true } },
    },
  },
  representante: { select: { id: true, nome: true, email: true, tetoDesconto: true } },
  gerente: { select: { id: true, nome: true } },
} satisfies Prisma.AprovacaoDescontoInclude;

type AprovacaoWithRel = Prisma.AprovacaoDescontoGetPayload<{ include: typeof aprovacaoInclude }>;

/**
 * Fluxo de aprovação de desconto.
 *
 * - Listagem visível a ADMIN, DIRECTOR, GERENTE (filtra por empresa do pedido).
 * - REP vê apenas as próprias solicitações.
 * - Aprovar/rejeitar exige role >= GERENTE.
 * - Aprovação → pedido continua para envio ao OMIE (não envia automaticamente).
 * - Rejeição → pedido vai para CANCELADO.
 */
@Injectable()
export class AprovacoesService {
  private readonly logger = new Logger(AprovacoesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repScope: RepScopeService,
    private readonly bus: FluxoEventBusService,
    private readonly notificacoes: NotificacoesService,
    private readonly email: TransactionalEmailService,
  ) {}

  async list(
    user: AuthenticatedUser,
    params: ListAprovacoesDto,
  ): Promise<Paginated<AprovacaoWithRel>> {
    const empresaId = this.requireEmpresa(user);
    const scope = await this.repScope.getRepIds(user);
    const where: Prisma.AprovacaoDescontoWhereInput = {
      pedido: { empresaId },
      ...(params.status ? { status: params.status } : {}),
      ...(params.representanteId ? { representanteId: params.representanteId } : {}),
      ...(scope !== null
        ? params.representanteId
          ? scope.includes(params.representanteId)
            ? {}
            : { representanteId: '__none__' }
          : { representanteId: { in: scope } }
        : {}),
    };

    const [total, data] = await Promise.all([
      this.prisma.aprovacaoDesconto.count({ where }),
      this.prisma.aprovacaoDesconto.findMany({
        where,
        skip: (params.page - 1) * params.limit,
        take: params.limit,
        orderBy: [{ status: 'asc' }, { criadoEm: 'desc' }],
        include: aprovacaoInclude,
      }),
    ]);
    return buildPaginated(data, total, params.page, params.limit);
  }

  async findById(user: AuthenticatedUser, id: string): Promise<AprovacaoWithRel> {
    const empresaId = this.requireEmpresa(user);
    const apr = await this.prisma.aprovacaoDesconto.findFirst({
      where: { id, pedido: { empresaId } },
      include: aprovacaoInclude,
    });
    if (!apr) throw new NotFoundException('Aprovação', id);
    const scope = await this.repScope.getRepIds(user);
    if (scope !== null && (apr.representanteId === null || !scope.includes(apr.representanteId))) {
      throw new ForbiddenException('Você não tem acesso a esta aprovação');
    }
    return apr;
  }

  async aprovar(
    user: AuthenticatedUser,
    id: string,
    dto: DecidirAprovacaoDto,
  ): Promise<AprovacaoWithRel> {
    const apr = await this.findById(user, id);
    this.assertGerenteOuAcima(user);
    if (apr.status !== 'PENDENTE') {
      throw new BusinessRuleException(
        `Aprovação já foi ${apr.status.toLowerCase()}`,
        ErrorCode.BUSINESS_RULE_VIOLATION,
      );
    }
    if (apr.representanteId === user.id) {
      throw new BusinessRuleException('Você não pode aprovar a própria solicitação');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.aprovacaoDesconto.update({
        where: { id },
        data: {
          status: 'APROVADA',
          gerenteId: user.id,
          comentarioAprovador: dto.comentario,
          resolvidoEm: new Date(),
        },
        include: aprovacaoInclude,
      });
      // Pedido volta pra RASCUNHO pra que o rep envie ao OMIE
      await tx.pedido.update({
        where: { id: apr.pedidoId },
        data: { status: 'RASCUNHO', aprovadorId: user.id },
      });
      return updated;
    });

    this.logger.log(`Aprovação ${apr.id} APROVADA por ${user.email} (pedido ${apr.pedidoId})`);

    // Notifica o REP que sua aprovação foi resolvida (APROVADA)
    if (apr.representanteId) {
      void this.notificacoes.criarParaUsuario({
        empresaId: result.pedido.empresaId,
        usuarioId: apr.representanteId,
        tipo: 'APROVACAO_RESOLVIDA',
        prioridade: 'NORMAL',
        titulo: 'Desconto aprovado',
        mensagem: `Pedido ${result.pedido.numero} foi liberado. Você pode enviar ao OMIE agora.`,
        link: `/pedidos/${result.pedido.id}`,
        metadata: { pedidoId: result.pedido.id, status: 'APROVADA' },
      });
      // E-mail transacional (best-effort)
      if (apr.representante?.email) {
        void this.email.enviarAprovacaoResolvida({
          para: apr.representante.email,
          repNome: apr.representante.nome,
          pedidoId: result.pedido.id,
          pedidoNumero: result.pedido.numero,
          status: 'APROVADA',
          comentario: dto.comentario,
        });
      }
    }

    // Trigger: PEDIDO_APROVADO
    const pedido = result.pedido;
    void this.bus.disparar(pedido.empresaId, 'PEDIDO_APROVADO', {
      pedidoId: pedido.id,
      pedido: { id: pedido.id, numero: pedido.numero, total: pedido.total },
      clienteId: pedido.clienteId,
      cliente: { id: pedido.cliente.id, nome: pedido.cliente.nome },
      representanteId: apr.representanteId,
      aprovadorId: user.id,
    });

    return result;
  }

  async rejeitar(
    user: AuthenticatedUser,
    id: string,
    dto: DecidirAprovacaoDto,
  ): Promise<AprovacaoWithRel> {
    const apr = await this.findById(user, id);
    this.assertGerenteOuAcima(user);
    if (apr.status !== 'PENDENTE') {
      throw new BusinessRuleException(`Aprovação já foi ${apr.status.toLowerCase()}`);
    }
    if (apr.representanteId === user.id) {
      throw new BusinessRuleException('Você não pode rejeitar a própria solicitação');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.aprovacaoDesconto.update({
        where: { id },
        data: {
          status: 'REJEITADA',
          gerenteId: user.id,
          comentarioAprovador: dto.comentario,
          resolvidoEm: new Date(),
        },
        include: aprovacaoInclude,
      });
      await tx.pedido.update({
        where: { id: apr.pedidoId },
        data: { status: 'CANCELADO' },
      });
      return updated;
    });

    this.logger.log(
      `Aprovação ${apr.id} REJEITADA por ${user.email} → pedido ${apr.pedidoId} cancelado`,
    );

    // Notifica o REP que sua aprovação foi rejeitada
    if (apr.representanteId) {
      void this.notificacoes.criarParaUsuario({
        empresaId: result.pedido.empresaId,
        usuarioId: apr.representanteId,
        tipo: 'APROVACAO_RESOLVIDA',
        prioridade: 'ALTA',
        titulo: 'Desconto rejeitado',
        mensagem: `Pedido ${result.pedido.numero} foi cancelado. Motivo: ${dto.comentario ?? 'sem motivo informado'}`,
        link: `/pedidos/${result.pedido.id}`,
        metadata: { pedidoId: result.pedido.id, status: 'REJEITADA' },
      });
      // E-mail transacional (best-effort)
      if (apr.representante?.email) {
        void this.email.enviarAprovacaoResolvida({
          para: apr.representante.email,
          repNome: apr.representante.nome,
          pedidoId: result.pedido.id,
          pedidoNumero: result.pedido.numero,
          status: 'REJEITADA',
          comentario: dto.comentario,
        });
      }
    }
    return result;
  }

  private assertGerenteOuAcima(user: AuthenticatedUser): void {
    if (!['ADMIN', 'DIRECTOR', 'GERENTE'].includes(user.role)) {
      throw new ForbiddenException(
        'Apenas gerentes, diretores ou admins podem decidir aprovações',
        ErrorCode.INSUFFICIENT_PERMISSIONS,
      );
    }
  }

  private requireEmpresa(user: AuthenticatedUser): string {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException(
        'Empresa não definida para esta requisição',
        ErrorCode.TENANT_ACCESS_DENIED,
      );
    }
    return user.empresaIdAtiva;
  }
}
