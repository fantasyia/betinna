import { Injectable, Logger } from '@nestjs/common';
import type { AgendaItem, Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { GoogleCalendarService } from '@integrations/google/google-calendar.service';
import { UsuarioIntegracoesService } from '@modules/integracoes/usuario-integracoes.service';
import {
  BusinessRuleException,
  ForbiddenException,
  NotFoundException,
} from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { RepScopeService } from '@shared/scope/rep-scope.service';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import {
  empresaFilter,
  getCallerEmpresaId,
  isGlobalAdmin,
} from '@shared/utils/auth-context';
import type {
  CreateAgendaItemDto,
  ListAgendaDto,
  UpdateAgendaItemDto,
} from './agenda.dto';

const agendaInclude = {
  cliente: { select: { id: true, nome: true, cidade: true } },
} satisfies Prisma.AgendaItemInclude;

type AgendaItemWithCliente = Prisma.AgendaItemGetPayload<{ include: typeof agendaInclude }>;

/**
 * Agenda do rep — visitas, ligações, reuniões.
 *
 * Política: cada usuário gerencia a própria agenda. ADMIN/DIRECTOR/GERENTE podem
 * listar agenda de qualquer rep (visibilidade), mas só o dono pode criar/editar.
 *
 * Espelhamento no Google Calendar é best-effort: se o user tem `google_calendar`
 * conectado, criamos um evento e salvamos o `googleEventId`. Falha no Google NÃO
 * derruba a operação local — só loga warning. Delete local apaga no Google.
 */
@Injectable()
export class AgendaService {
  private readonly logger = new Logger(AgendaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly userIntegracoes: UsuarioIntegracoesService,
    private readonly googleCalendar: GoogleCalendarService,
    private readonly repScope: RepScopeService,
  ) {}

  async create(
    user: AuthenticatedUser,
    dto: CreateAgendaItemDto,
  ): Promise<AgendaItemWithCliente> {
    // AUDITORIA 2026-05-15: AgendaItem agora tem empresaId obrigatório.
    // Vem da empresa ativa do JWT — NUNCA do body.
    const empresaId = getCallerEmpresaId(user);
    if (dto.clienteId) {
      await this.assertClienteVisivel(user, dto.clienteId);
    }

    const item = await this.prisma.agendaItem.create({
      data: {
        empresaId,
        usuarioId: user.id,
        clienteId: dto.clienteId ?? null,
        titulo: dto.titulo,
        data: dto.data,
        duracao: dto.duracao,
        tipo: dto.tipo,
        observacao: dto.observacao ?? null,
      },
      include: agendaInclude,
    });

    if (dto.espelharGoogle) {
      const googleEventId = await this.tentarEspelharGoogle(user.id, item, dto.participantes);
      if (googleEventId) {
        await this.prisma.agendaItem.update({
          where: { id: item.id },
          data: { googleEventId },
        });
        item.googleEventId = googleEventId;
      }
    }

    this.logger.log(
      `Agenda criada [${item.tipo}] "${item.titulo}" usuário=${user.id} data=${item.data.toISOString()}`,
    );
    return item;
  }

  async list(user: AuthenticatedUser, params: ListAgendaDto): Promise<AgendaItemWithCliente[]> {
    const usuarioAlvo = await this.resolverUsuarioAlvo(user, params.usuarioId);
    // AUDITORIA: filtra por empresa ativa (ADMIN bypass)
    const where: Prisma.AgendaItemWhereInput = {
      usuarioId: usuarioAlvo,
      ...empresaFilter(user),
    };
    if (params.clienteId) where.clienteId = params.clienteId;
    if (params.tipo) where.tipo = params.tipo;
    if (params.inicio || params.fim) {
      where.data = {};
      if (params.inicio) where.data.gte = params.inicio;
      if (params.fim) where.data.lte = params.fim;
    }
    return this.prisma.agendaItem.findMany({
      where,
      include: agendaInclude,
      orderBy: { data: 'asc' },
    });
  }

  async findById(user: AuthenticatedUser, id: string): Promise<AgendaItemWithCliente> {
    // AUDITORIA: usa findFirst com empresaId filter direto (defesa em profundidade)
    const item = await this.prisma.agendaItem.findFirst({
      where: { id, ...empresaFilter(user) },
      include: agendaInclude,
    });
    if (!item) throw new NotFoundException('AgendaItem', id);
    if (item.usuarioId !== user.id && !this.podeVisualizarOutros(user)) {
      throw new ForbiddenException(
        'Este item não pertence à sua agenda',
        ErrorCode.TENANT_ACCESS_DENIED,
      );
    }
    return item;
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateAgendaItemDto,
  ): Promise<AgendaItemWithCliente> {
    // AUDITORIA: findFirst com empresaId filter (ADMIN bypass)
    const existing = await this.prisma.agendaItem.findFirst({
      where: { id, ...empresaFilter(user) },
    });
    if (!existing) throw new NotFoundException('AgendaItem', id);
    if (existing.usuarioId !== user.id) {
      throw new ForbiddenException(
        'Apenas o dono pode editar este item',
        ErrorCode.TENANT_ACCESS_DENIED,
      );
    }
    if (dto.clienteId) {
      await this.assertClienteVisivel(user, dto.clienteId);
    }

    const updated = await this.prisma.agendaItem.update({
      where: { id },
      data: {
        titulo: dto.titulo ?? existing.titulo,
        data: dto.data ?? existing.data,
        duracao: dto.duracao ?? existing.duracao,
        tipo: dto.tipo ?? existing.tipo,
        observacao: dto.observacao === undefined ? existing.observacao : dto.observacao,
        clienteId: dto.clienteId === undefined ? existing.clienteId : dto.clienteId,
      },
      include: agendaInclude,
    });

    if (existing.googleEventId) {
      try {
        await this.googleCalendar.atualizarEvento(user.id, existing.googleEventId, {
          titulo: updated.titulo,
          inicio: updated.data,
          fim: this.calcFim(updated.data, updated.duracao),
          descricao: updated.observacao ?? undefined,
          participantes: dto.participantes,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Falha ao atualizar evento Google ${existing.googleEventId}: ${msg}`);
      }
    }
    return updated;
  }

  async delete(user: AuthenticatedUser, id: string): Promise<{ ok: true }> {
    // AUDITORIA: findFirst com empresaId filter
    const existing = await this.prisma.agendaItem.findFirst({
      where: { id, ...empresaFilter(user) },
    });
    if (!existing) throw new NotFoundException('AgendaItem', id);
    if (existing.usuarioId !== user.id) {
      throw new ForbiddenException(
        'Apenas o dono pode remover este item',
        ErrorCode.TENANT_ACCESS_DENIED,
      );
    }
    if (existing.googleEventId) {
      try {
        await this.googleCalendar.deletarEvento(user.id, existing.googleEventId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Falha ao deletar evento Google ${existing.googleEventId}: ${msg}`);
      }
    }
    await this.prisma.agendaItem.delete({ where: { id } });
    return { ok: true };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────

  private async tentarEspelharGoogle(
    usuarioId: string,
    item: AgendaItem,
    participantes: CreateAgendaItemDto['participantes'],
  ): Promise<string | null> {
    const conn = await this.userIntegracoes
      .findByServico({ id: usuarioId } as AuthenticatedUser, 'google_calendar')
      .catch(() => null);
    if (!conn || !conn.ativo) {
      return null;
    }
    try {
      const ev = await this.googleCalendar.criarEvento(usuarioId, {
        titulo: item.titulo,
        inicio: item.data,
        fim: this.calcFim(item.data, item.duracao),
        descricao: item.observacao ?? undefined,
        participantes,
      });
      return ev.id ?? null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Falha ao criar evento Google (usuário=${usuarioId}): ${msg}`);
      return null;
    }
  }

  private calcFim(inicio: Date, duracaoMin: number): Date {
    return new Date(inicio.getTime() + duracaoMin * 60_000);
  }

  private async assertClienteVisivel(user: AuthenticatedUser, clienteId: string): Promise<void> {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException(
        'Empresa não definida',
        ErrorCode.TENANT_ACCESS_DENIED,
      );
    }
    const c = await this.prisma.cliente.findFirst({
      where: { id: clienteId, empresaId: user.empresaIdAtiva },
      select: { id: true, representanteId: true },
    });
    if (!c) throw new NotFoundException('Cliente', clienteId);
    const scope = await this.repScope.getRepIds(user);
    if (
      scope !== null &&
      (c.representanteId === null || !scope.includes(c.representanteId))
    ) {
      throw new BusinessRuleException('Cliente fora da sua carteira');
    }
  }

  private async resolverUsuarioAlvo(
    user: AuthenticatedUser,
    pedido: string | undefined,
  ): Promise<string> {
    if (!pedido || pedido === user.id) return user.id;
    if (!this.podeVisualizarOutros(user)) {
      throw new ForbiddenException(
        'Sem permissão para ver agenda de outros usuários',
        ErrorCode.TENANT_ACCESS_DENIED,
      );
    }
    // GERENTE: só pode ver agenda dos reps sob sua gerência (auditoria P1-1)
    // ADMIN/DIRECTOR podem ver de qualquer usuário (na empresa ativa).
    if (user.role === 'GERENTE') {
      const scope = await this.repScope.getRepIds(user);
      if (scope !== null && !scope.includes(pedido)) {
        throw new ForbiddenException(
          'Usuário alvo não está sob sua gerência',
          ErrorCode.TENANT_ACCESS_DENIED,
        );
      }
    }
    // ADMIN cross-tenant não precisa validar; demais já estão restritos pelo
    // empresaFilter() aplicado na query (item de outro tenant retorna vazio).
    return pedido;
  }

  private podeVisualizarOutros(user: AuthenticatedUser): boolean {
    return user.role === 'ADMIN' || user.role === 'DIRECTOR' || user.role === 'GERENTE';
  }
}
