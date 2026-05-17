import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import {
  BusinessRuleException,
  ForbiddenException,
  NotFoundException,
} from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { FluxoEventBusService } from '@modules/fluxos/fluxo-event-bus.service';
import { NotificacoesService } from '@modules/notificacoes/notificacoes.service';
import { TransactionalEmailService } from '@integrations/sendgrid/transactional-email.service';
import { RepScopeService } from '@shared/scope/rep-scope.service';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { type Paginated, buildPaginated } from '@shared/types/pagination';
import { SequenceService } from '@shared/utils/sequence.service';
import {
  type AdicionarComentarioDto,
  type ChangeStatusOcorrenciaDto,
  type CreateOcorrenciaDto,
  type ListOcorrenciasDto,
  type ResolverDto,
  type UpdateOcorrenciaDto,
  slaHorasParaSeveridade,
} from './ocorrencias.dto';

const ocorrenciaInclude = {
  cliente: { select: { id: true, nome: true, cnpj: true, representanteId: true } },
  responsavel: { select: { id: true, nome: true, email: true } },
  criadoPor: { select: { id: true, nome: true } },
  _count: { select: { comentarios: true } },
} satisfies Prisma.OcorrenciaInclude;

const ocorrenciaIncludeDetalhe = {
  ...ocorrenciaInclude,
  comentarios: {
    include: { autor: { select: { id: true, nome: true } } },
    orderBy: { criadoEm: Prisma.SortOrder.asc },
  },
} satisfies Prisma.OcorrenciaInclude;

type OcorrenciaList = Prisma.OcorrenciaGetPayload<{ include: typeof ocorrenciaInclude }>;
type OcorrenciaDetalhe = Prisma.OcorrenciaGetPayload<{ include: typeof ocorrenciaIncludeDetalhe }>;

@Injectable()
export class OcorrenciasService {
  private readonly logger = new Logger(OcorrenciasService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repScope: RepScopeService,
    private readonly bus: FluxoEventBusService,
    private readonly sequence: SequenceService,
    private readonly notificacoes: NotificacoesService,
    private readonly email: TransactionalEmailService,
  ) {}

  private requireEmpresa(user: AuthenticatedUser): string {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    return user.empresaIdAtiva;
  }

  /**
   * REP só vê ocorrências dos clientes da própria carteira.
   * SAC vê todas da empresa.
   */
  private async baseWhere(user: AuthenticatedUser): Promise<Prisma.OcorrenciaWhereInput> {
    const where: Prisma.OcorrenciaWhereInput = { empresaId: this.requireEmpresa(user) };
    const scope = await this.repScope.getRepIds(user);
    if (scope !== null) {
      where.cliente = { representanteId: { in: scope } };
    }
    return where;
  }

  async list(
    user: AuthenticatedUser,
    params: ListOcorrenciasDto,
  ): Promise<Paginated<OcorrenciaList>> {
    const where: Prisma.OcorrenciaWhereInput = { ...(await this.baseWhere(user)) };
    const conds: Prisma.OcorrenciaWhereInput[] = [];
    if (params.search) {
      conds.push({
        OR: [
          { numero: { contains: params.search, mode: 'insensitive' } },
          { titulo: { contains: params.search, mode: 'insensitive' } },
          { descricao: { contains: params.search, mode: 'insensitive' } },
          { cliente: { nome: { contains: params.search, mode: 'insensitive' } } },
        ],
      });
    }
    if (params.status) conds.push({ status: params.status });
    if (params.tipo) conds.push({ tipo: params.tipo });
    if (params.severidade) conds.push({ severidade: params.severidade });
    if (params.clienteId) conds.push({ clienteId: params.clienteId });
    if (params.responsavelId) conds.push({ responsavelId: params.responsavelId });
    if (params.slaEstourado) {
      conds.push({
        slaVenceEm: { lt: new Date() },
        status: { in: ['ABERTA', 'EM_ANDAMENTO'] },
      });
    }
    if (conds.length > 0) where.AND = conds;

    const [total, data] = await Promise.all([
      this.prisma.ocorrencia.count({ where }),
      this.prisma.ocorrencia.findMany({
        where,
        skip: (params.page - 1) * params.limit,
        take: params.limit,
        orderBy: { [params.sortBy]: params.sortOrder },
        include: ocorrenciaInclude,
      }),
    ]);
    return buildPaginated(data, total, params.page, params.limit);
  }

  async findById(user: AuthenticatedUser, id: string): Promise<OcorrenciaDetalhe> {
    const oco = await this.prisma.ocorrencia.findFirst({
      where: { id, ...(await this.baseWhere(user)) },
      include: ocorrenciaIncludeDetalhe,
    });
    if (!oco) throw new NotFoundException('Ocorrência', id);
    return oco;
  }

  async create(user: AuthenticatedUser, dto: CreateOcorrenciaDto): Promise<OcorrenciaDetalhe> {
    const empresaId = this.requireEmpresa(user);
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
      throw new ForbiddenException(
        'Cliente não pertence à sua carteira',
        ErrorCode.TENANT_ACCESS_DENIED,
      );
    }

    if (dto.pedidoId) {
      const pedido = await this.prisma.pedido.findFirst({
        where: { id: dto.pedidoId, empresaId, clienteId: dto.clienteId },
        select: { id: true },
      });
      if (!pedido) {
        throw new BusinessRuleException('Pedido informado não pertence à mesma empresa/cliente');
      }
    }

    if (dto.responsavelId) {
      const resp = await this.prisma.usuario.findFirst({
        where: {
          id: dto.responsavelId,
          empresas: { some: { empresaId } },
        },
        select: { id: true },
      });
      if (!resp) {
        throw new BusinessRuleException('Responsável não vinculado à empresa');
      }
    }

    const slaHoras = dto.slaHoras ?? slaHorasParaSeveridade(dto.severidade);
    const now = new Date();
    const slaVenceEm = new Date(now.getTime() + slaHoras * 60 * 60 * 1000);

    const numero = await this.gerarNumero(empresaId);

    const created = await this.prisma.$transaction(async (tx) => {
      const oco = await tx.ocorrencia.create({
        data: {
          empresaId,
          numero,
          clienteId: dto.clienteId,
          pedidoId: dto.pedidoId,
          responsavelId: dto.responsavelId,
          criadoPorId: user.id,
          tipo: dto.tipo,
          severidade: dto.severidade,
          titulo: dto.titulo,
          descricao: dto.descricao,
          slaHoras,
          slaVenceEm,
          status: 'ABERTA',
        },
        select: { id: true },
      });
      await tx.ocorrenciaComentario.create({
        data: {
          ocorrenciaId: oco.id,
          autorId: user.id,
          autorNome: user.nome,
          texto: `Ocorrência aberta · severidade ${dto.severidade} · SLA ${slaHoras}h`,
          isSistema: true,
        },
      });
      return oco;
    });
    this.logger.log(
      `Ocorrência ${numero} aberta · severidade ${dto.severidade} · SLA vence ${slaVenceEm.toISOString()}`,
    );

    const ocorrencia = await this.findById(user, created.id);

    // Notifica gerentes + SAC quando severidade alta/crítica
    if (['CRITICA', 'ALTA'].includes(ocorrencia.severidade)) {
      void this.notificacoes.criarParaRole({
        empresaId,
        roles: ['GERENTE', 'DIRECTOR', 'SAC'],
        tipo: 'OCORRENCIA_ABERTA',
        prioridade: ocorrencia.severidade === 'CRITICA' ? 'URGENTE' : 'ALTA',
        titulo: `Ocorrência ${ocorrencia.severidade} aberta`,
        mensagem: `${ocorrencia.numero} · ${ocorrencia.titulo}`,
        link: `/ocorrencias/${ocorrencia.id}`,
        metadata: { ocorrenciaId: ocorrencia.id, severidade: ocorrencia.severidade },
      });
      // E-mail transacional pra cada GERENTE+DIRECTOR+SAC ativo da empresa
      void this.notificarEmailOcorrenciaCritica(empresaId, ocorrencia, slaHoras);
    }

    // Trigger: OCORRENCIA_ABERTA
    void this.bus.disparar(empresaId, 'OCORRENCIA_ABERTA', {
      ocorrenciaId: ocorrencia.id,
      ocorrencia: {
        id: ocorrencia.id,
        numero: ocorrencia.numero,
        titulo: ocorrencia.titulo,
        severidade: ocorrencia.severidade,
        tipo: ocorrencia.tipo,
      },
      clienteId: ocorrencia.clienteId,
      cliente: { id: ocorrencia.cliente.id, nome: ocorrencia.cliente.nome },
      representanteId: ocorrencia.cliente.representanteId ?? null,
      slaVenceEm: slaVenceEm.toISOString(),
    });

    return ocorrencia;
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateOcorrenciaDto,
  ): Promise<OcorrenciaDetalhe> {
    const existing = await this.findById(user, id);
    if (existing.status === 'RESOLVIDA' || existing.status === 'CANCELADA') {
      throw new BusinessRuleException(
        `Ocorrência em status ${existing.status} não pode ser editada`,
      );
    }

    const data: Prisma.OcorrenciaUpdateInput = { ...dto };
    // Recalcula SLA se severidade mudou
    if (dto.severidade && dto.severidade !== existing.severidade) {
      const slaHoras = slaHorasParaSeveridade(dto.severidade);
      data.slaHoras = slaHoras;
      data.slaVenceEm = new Date(existing.criadoEm.getTime() + slaHoras * 60 * 60 * 1000);
    }

    await this.prisma.ocorrencia.updateMany({
      where: { id, empresaId: existing.empresaId },
      data,
    });
    return this.prisma.ocorrencia.findUniqueOrThrow({
      where: { id },
      include: ocorrenciaIncludeDetalhe,
    });
  }

  async changeStatus(
    user: AuthenticatedUser,
    id: string,
    dto: ChangeStatusOcorrenciaDto,
  ): Promise<OcorrenciaDetalhe> {
    const existing = await this.findById(user, id);
    if (existing.status === dto.status) {
      throw new BusinessRuleException(`Ocorrência já está em status ${dto.status}`);
    }
    if (existing.status === 'RESOLVIDA' && dto.status === 'CANCELADA') {
      throw new BusinessRuleException('Ocorrência resolvida não pode ser cancelada');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.ocorrencia.updateMany({
        where: { id, empresaId: existing.empresaId },
        data: { status: dto.status },
      });
      await tx.ocorrenciaComentario.create({
        data: {
          ocorrenciaId: id,
          autorId: user.id,
          autorNome: user.nome,
          texto: dto.motivo
            ? `Status alterado para ${dto.status} — ${dto.motivo}`
            : `Status alterado para ${dto.status}`,
          isSistema: true,
        },
      });
    });
    return this.findById(user, id);
  }

  async resolver(
    user: AuthenticatedUser,
    id: string,
    dto: ResolverDto,
  ): Promise<OcorrenciaDetalhe> {
    const existing = await this.findById(user, id);
    if (existing.status === 'RESOLVIDA') {
      throw new BusinessRuleException('Ocorrência já está resolvida');
    }
    if (existing.status === 'CANCELADA') {
      throw new BusinessRuleException('Ocorrência cancelada não pode ser resolvida');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.ocorrencia.updateMany({
        where: { id, empresaId: existing.empresaId },
        data: {
          status: 'RESOLVIDA',
          resolucao: dto.resolucao,
          resolvidoEm: new Date(),
        },
      });
      await tx.ocorrenciaComentario.create({
        data: {
          ocorrenciaId: id,
          autorId: user.id,
          autorNome: user.nome,
          texto: `Resolvida · ${dto.resolucao}`,
          isSistema: true,
        },
      });
    });

    // Notifica o criador que sua ocorrência foi resolvida
    if (existing.criadoPorId && existing.criadoPorId !== user.id) {
      void this.notificacoes.criarParaUsuario({
        empresaId: existing.empresaId,
        usuarioId: existing.criadoPorId,
        tipo: 'OCORRENCIA_RESOLVIDA',
        prioridade: 'NORMAL',
        titulo: 'Ocorrência resolvida',
        mensagem: `${existing.numero} foi marcada como resolvida.`,
        link: `/ocorrencias/${existing.id}`,
        metadata: { ocorrenciaId: existing.id },
      });
    }

    return this.findById(user, id);
  }

  async adicionarComentario(
    user: AuthenticatedUser,
    id: string,
    dto: AdicionarComentarioDto,
  ): Promise<OcorrenciaDetalhe> {
    await this.findById(user, id); // valida acesso
    await this.prisma.ocorrenciaComentario.create({
      data: {
        ocorrenciaId: id,
        autorId: user.id,
        autorNome: user.nome,
        texto: dto.texto,
        isSistema: false,
      },
    });
    return this.findById(user, id);
  }

  async remove(user: AuthenticatedUser, id: string): Promise<void> {
    const existing = await this.findById(user, id);
    if (existing.status !== 'ABERTA') {
      throw new BusinessRuleException(
        'Apenas ocorrências em status ABERTA podem ser excluídas. Use CANCELAR para outros casos.',
      );
    }
    await this.prisma.ocorrencia.delete({ where: { id } });
  }

  /**
   * Resumo para dashboard de SAC.
   */
  async resumo(user: AuthenticatedUser): Promise<{
    abertas: number;
    emAndamento: number;
    resolvidasUltimos30d: number;
    slaEstourado: number;
    porSeveridade: Record<string, number>;
  }> {
    const where = await this.baseWhere(user);
    const trintaDiasAtras = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [abertas, emAndamento, resolvidas30d, slaEstourado, severidades] = await Promise.all([
      this.prisma.ocorrencia.count({ where: { ...where, status: 'ABERTA' } }),
      this.prisma.ocorrencia.count({ where: { ...where, status: 'EM_ANDAMENTO' } }),
      this.prisma.ocorrencia.count({
        where: { ...where, status: 'RESOLVIDA', resolvidoEm: { gte: trintaDiasAtras } },
      }),
      this.prisma.ocorrencia.count({
        where: {
          ...where,
          slaVenceEm: { lt: new Date() },
          status: { in: ['ABERTA', 'EM_ANDAMENTO'] },
        },
      }),
      this.prisma.ocorrencia.groupBy({
        by: ['severidade'],
        where: { ...where, status: { in: ['ABERTA', 'EM_ANDAMENTO'] } },
        _count: { _all: true },
      }),
    ]);
    const porSeveridade: Record<string, number> = {};
    for (const s of severidades) porSeveridade[s.severidade] = s._count._all;

    return {
      abertas,
      emAndamento,
      resolvidasUltimos30d: resolvidas30d,
      slaEstourado,
      porSeveridade,
    };
  }

  /**
   * Gera próximo número OCO-XXXX por empresa via SequenceService atomic.
   * Auditoria 2026-05-15 P0-4: substitui `count + 1` que tinha race condition.
   */
  private async gerarNumero(empresaId: string): Promise<string> {
    const seq = await this.sequence.next(empresaId, 'ocorrencia');
    return `OCO-${seq.toString().padStart(4, '0')}`;
  }

  /**
   * Best-effort: envia e-mail pros usuários ativos com papéis gerenciais
   * notificando da ocorrência crítica/alta. Falha não interrompe nada.
   */
  private async notificarEmailOcorrenciaCritica(
    empresaId: string,
    ocorrencia: { id: string; numero: string; titulo: string; severidade: string },
    slaHoras: number,
  ): Promise<void> {
    try {
      const destinatarios = await this.prisma.usuario.findMany({
        where: {
          status: 'ATIVO',
          role: { in: ['GERENTE', 'DIRECTOR', 'SAC'] },
          empresas: { some: { empresaId } },
        },
        select: { email: true, nome: true },
      });
      for (const d of destinatarios) {
        if (!d.email) continue;
        void this.email.enviarOcorrenciaCritica({
          para: d.email,
          destinatarioNome: d.nome,
          ocorrenciaId: ocorrencia.id,
          numero: ocorrencia.numero,
          titulo: ocorrencia.titulo,
          severidade: ocorrencia.severidade as 'CRITICA' | 'ALTA',
          slaHoras,
        });
      }
    } catch (err) {
      this.logger.warn(
        `Falha enviando e-mails de ocorrência crítica: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
