import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
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
import { addHorasUteis, resolveInboxConfig } from './inbox-interna.util';
import type { CriarThreadDto, ListThreadsDto, ResponderThreadDto } from './inbox-interna.dto';

const threadInclude = {
  mensagens: { orderBy: { criadoEm: 'asc' } },
} satisfies Prisma.InternalThreadInclude;

type ThreadWithMsgs = Prisma.InternalThreadGetPayload<{ include: typeof threadInclude }>;

@Injectable()
export class InboxInternaService {
  private readonly logger = new Logger(InboxInternaService.name);

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
    return resolveInboxConfig((empresa?.config as { inboxInterna?: unknown } | null)?.inboxInterna);
  }

  async list(user: AuthenticatedUser, params: ListThreadsDto): Promise<Paginated<ThreadWithMsgs>> {
    const empresaId = this.requireEmpresa(user);
    const where: Prisma.InternalThreadWhereInput = { empresaId };
    if (params.status) where.status = params.status;
    if (params.tipo) where.tipo = params.tipo;
    // REP/GERENTE veem as PRÓPRIAS threads (criadoPorId = user.id) + as dos subordinados;
    // ADMIN/DIRECTOR/SAC veem todas (scope null). Sem o user.id, o GERENTE não via as que
    // ele mesmo abriu (scope só traz ids de REPs subordinados).
    const scope = await this.repScope.getRepIds(user);
    if (scope !== null) where.criadoPorId = { in: [user.id, ...scope] };

    const [total, data] = await Promise.all([
      this.prisma.internalThread.count({ where }),
      this.prisma.internalThread.findMany({
        where,
        skip: (params.page - 1) * params.limit,
        take: params.limit,
        orderBy: { ultimaMsgEm: 'desc' },
        include: threadInclude,
      }),
    ]);
    return buildPaginated(data, total, params.page, params.limit);
  }

  async findById(user: AuthenticatedUser, id: string): Promise<ThreadWithMsgs> {
    const thread = await this.prisma.internalThread.findFirst({
      where: { id, empresaId: this.requireEmpresa(user) },
      include: threadInclude,
    });
    if (!thread) throw new NotFoundException('Thread', id);
    const scope = await this.repScope.getRepIds(user);
    const visiveis = scope === null ? null : [user.id, ...scope];
    if (visiveis && (thread.criadoPorId === null || !visiveis.includes(thread.criadoPorId))) {
      throw new ForbiddenException('Você não tem acesso a esta conversa');
    }
    return thread;
  }

  async criar(user: AuthenticatedUser, dto: CriarThreadDto): Promise<ThreadWithMsgs> {
    const empresaId = this.requireEmpresa(user);
    const cfg = await this.lerConfig(empresaId);
    const tipo = cfg.tipos.find((t) => t.key === dto.tipo);
    if (!tipo) throw new BusinessRuleException(`Tipo de conversa "${dto.tipo}" inválido`);
    if (!tipo.permiteResposta && user.role === 'REP') {
      throw new BusinessRuleException(`O canal "${tipo.nome}" é somente leitura`);
    }
    // Valida que pedido/cliente vinculados são do tenant (anti referência cruzada — o DTO
    // vem do cliente e não devia poder anexar a thread a um pedido/cliente de outra empresa).
    if (dto.pedidoId) {
      const p = await this.prisma.pedido.findFirst({
        where: { id: dto.pedidoId, empresaId },
        select: { id: true },
      });
      if (!p) throw new NotFoundException('Pedido', dto.pedidoId);
    }
    if (dto.clienteId) {
      const c = await this.prisma.cliente.findFirst({
        where: { id: dto.clienteId, empresaId },
        select: { id: true },
      });
      if (!c) throw new NotFoundException('Cliente', dto.clienteId);
    }

    const seq = await this.sequence.next(empresaId, 'internal-thread');
    const numero = `INT-${seq.toString().padStart(4, '0')}`;
    const ladoEmpresa = user.role !== 'REP';
    const slaRespostaEm =
      tipo.slaHorasUteis > 0 ? addHorasUteis(new Date(), tipo.slaHorasUteis) : null;

    const thread = await this.prisma.internalThread.create({
      data: {
        empresaId,
        numero,
        tipo: dto.tipo,
        assunto: dto.assunto,
        prioridade: tipo.prioridade,
        status: ladoEmpresa ? 'RESPONDIDA' : 'ABERTA',
        criadoPorId: user.id,
        criadoPorNome: user.nome,
        pedidoId: dto.pedidoId,
        clienteId: dto.clienteId,
        slaRespostaEm,
        mensagens: {
          create: { autorId: user.id, autorNome: user.nome, ladoEmpresa, texto: dto.mensagem },
        },
      },
      include: threadInclude,
    });
    this.logger.log(`Inbox interna ${numero} aberta (${dto.tipo}) por ${user.nome}`);
    return thread;
  }

  async responder(
    user: AuthenticatedUser,
    threadId: string,
    dto: ResponderThreadDto,
  ): Promise<ThreadWithMsgs> {
    const thread = await this.findById(user, threadId);
    const cfg = await this.lerConfig(thread.empresaId);
    const tipo = cfg.tipos.find((t) => t.key === thread.tipo);
    // Fail-closed: se o tipo sumiu da config (canal removido/renomeado), REP NÃO responde
    // — senão a trava de só-leitura era pulada quando o lookup vinha vazio.
    if (user.role === 'REP' && (!tipo || !tipo.permiteResposta)) {
      throw new BusinessRuleException(`O canal "${tipo?.nome ?? thread.tipo}" é somente leitura`);
    }
    if (thread.status === 'RESOLVIDA') {
      throw new BusinessRuleException('Conversa resolvida — abra uma nova para continuar');
    }

    const ladoEmpresa = user.role !== 'REP';
    await this.prisma.$transaction([
      this.prisma.internalMessage.create({
        data: {
          threadId,
          autorId: user.id,
          autorNome: user.nome,
          ladoEmpresa,
          texto: dto.texto,
        },
      }),
      this.prisma.internalThread.update({
        where: { id: threadId },
        data: { status: ladoEmpresa ? 'RESPONDIDA' : 'ABERTA', ultimaMsgEm: new Date() },
      }),
    ]);
    return this.prisma.internalThread.findUniqueOrThrow({
      where: { id: threadId },
      include: threadInclude,
    });
  }

  async resolver(user: AuthenticatedUser, threadId: string): Promise<ThreadWithMsgs> {
    const thread = await this.findById(user, threadId);
    await this.prisma.internalThread.update({
      where: { id: thread.id },
      data: { status: 'RESOLVIDA' },
    });
    return this.prisma.internalThread.findUniqueOrThrow({
      where: { id: thread.id },
      include: threadInclude,
    });
  }
}
