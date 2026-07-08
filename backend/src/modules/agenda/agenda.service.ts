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
import { empresaFilter, getCallerEmpresaId } from '@shared/utils/auth-context';
import type { CreateAgendaItemDto, ListAgendaDto, UpdateAgendaItemDto } from './agenda.dto';

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

  async create(user: AuthenticatedUser, dto: CreateAgendaItemDto): Promise<AgendaItemWithCliente> {
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
        local: dto.local ?? null,
        alertas: dto.alertas ?? [],
        recorrencia: dto.recorrencia,
      },
      include: agendaInclude,
    });

    // v1.5.0 — Gera instâncias filhas se for série recorrente
    if (dto.recorrencia && dto.recorrencia !== 'NENHUMA') {
      await this.gerarInstanciasRecorrentes(item, dto);
    }

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
      `Agenda criada [${item.tipo}] "${item.titulo}" usuário=${user.id} data=${item.data.toISOString()} recorrencia=${dto.recorrencia}`,
    );
    return item;
  }

  /**
   * Gera N instâncias filhas a partir da regra de recorrência.
   * - DIARIA: +1 dia
   * - SEMANAL: +7 dias
   * - QUINZENAL: +14 dias
   * - MENSAL: +1 mês (mesmo dia)
   * - ANUAL: +1 ano (mesmo dia)
   *
   * Filhas herdam tudo do parent e ficam apontando via parentId.
   * Ocorrências - 1 (a primeira é o próprio parent).
   */
  private async gerarInstanciasRecorrentes(
    parent: AgendaItem,
    dto: CreateAgendaItemDto,
  ): Promise<void> {
    const ocorrencias = Math.max(1, Math.min(52, dto.recorrenciaOcorrencias ?? 12));
    const filhas: Prisma.AgendaItemCreateManyInput[] = [];
    for (let i = 1; i < ocorrencias; i++) {
      const nextDate = this.proximaOcorrencia(parent.data, dto.recorrencia, i);
      filhas.push({
        empresaId: parent.empresaId,
        usuarioId: parent.usuarioId,
        clienteId: parent.clienteId,
        titulo: parent.titulo,
        data: nextDate,
        duracao: parent.duracao,
        tipo: parent.tipo,
        observacao: parent.observacao,
        local: parent.local,
        alertas: parent.alertas,
        recorrencia: parent.recorrencia,
        parentId: parent.id,
      });
    }
    if (filhas.length > 0) {
      await this.prisma.agendaItem.createMany({ data: filhas });
      this.logger.log(`Criadas ${filhas.length} instâncias recorrentes (parent=${parent.id})`);
    }
  }

  private proximaOcorrencia(base: Date, recorrencia: string, offset: number): Date {
    const d = new Date(base);
    switch (recorrencia) {
      case 'DIARIA':
        d.setDate(d.getDate() + offset);
        return d;
      case 'SEMANAL':
        d.setDate(d.getDate() + offset * 7);
        return d;
      case 'QUINZENAL':
        d.setDate(d.getDate() + offset * 14);
        return d;
      case 'MENSAL':
        d.setMonth(d.getMonth() + offset);
        return d;
      case 'ANUAL':
        d.setFullYear(d.getFullYear() + offset);
        return d;
      default:
        return d;
    }
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

    await this.prisma.agendaItem.updateMany({
      where: { id, empresaId: existing.empresaId },
      data: {
        titulo: dto.titulo ?? existing.titulo,
        data: dto.data ?? existing.data,
        duracao: dto.duracao ?? existing.duracao,
        tipo: dto.tipo ?? existing.tipo,
        observacao: dto.observacao === undefined ? existing.observacao : dto.observacao,
        local: dto.local === undefined ? existing.local : dto.local,
        alertas: dto.alertas === undefined ? existing.alertas : dto.alertas,
        clienteId: dto.clienteId === undefined ? existing.clienteId : dto.clienteId,
      },
    });
    const updated = await this.prisma.agendaItem.findUniqueOrThrow({
      where: { id },
      include: agendaInclude,
    });

    if (existing.googleEventId) {
      try {
        await this.googleCalendar.atualizarEvento(user.id, existing.googleEventId, {
          titulo: updated.titulo,
          inicio: updated.data,
          fim: this.calcFim(updated.data, updated.duracao),
          descricao: updated.observacao ?? undefined,
          local: updated.local ?? '',
          alertas: updated.alertas,
          participantes: dto.participantes,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Falha ao atualizar evento Google ${existing.googleEventId}: ${msg}`);
      }
    } else {
      // Item ainda NÃO espelhado (ex.: criado antes de conectar o Google). Ao
      // editar, cria o evento no Google agora (se o usuário estiver conectado) —
      // senão editar um compromisso antigo nunca o levava pra agenda do Google.
      const gid = await this.tentarEspelharGoogle(user.id, updated, dto.participantes);
      if (gid) {
        await this.prisma.agendaItem.updateMany({
          where: { id, empresaId: existing.empresaId },
          data: { googleEventId: gid },
        });
        updated.googleEventId = gid;
      }
    }
    return updated;
  }

  async delete(
    user: AuthenticatedUser,
    id: string,
    scope: 'this' | 'this_and_future' | 'series' = 'this',
  ): Promise<{ ok: true; deleted: number }> {
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
    // v1.5.0 — Suporte a delete em série. Monta o filtro do que será apagado ANTES de mexer no
    // Google (precisamos saber todas as linhas atingidas pra apagar os eventos correspondentes).
    const parentId = existing.parentId ?? existing.id;
    let where: Prisma.AgendaItemWhereInput = { id, empresaId: existing.empresaId };

    if (scope === 'series') {
      // Apaga TUDO da série (parent + filhas)
      where = {
        empresaId: existing.empresaId,
        OR: [{ id: parentId }, { parentId }],
      };
    } else if (scope === 'this_and_future') {
      // Apaga este e tudo depois dele (na mesma série)
      where = {
        empresaId: existing.empresaId,
        data: { gte: existing.data },
        OR: [{ id: parentId }, { parentId }],
      };
    }

    // CAÇADA-BUG #12: apagar a SÉRIE removia várias linhas locais, mas só 1 evento no Google (o do
    // item clicado) — as filhas (cada uma com seu googleEventId) ficavam ÓRFÃS no Google e a série
    // RESSUSCITAVA no próximo sync (re-import). Coletamos os googleEventId de TODAS as linhas atingidas
    // e apagamos cada uma no Google (best-effort). `gtask:` são tarefas (não eventos de calendário) →
    // não passam pelo deletarEvento (daria 404).
    const afetados = await this.prisma.agendaItem.findMany({
      where,
      select: { googleEventId: true },
    });
    for (const a of afetados) {
      if (!a.googleEventId || a.googleEventId.startsWith('gtask:')) continue;
      try {
        await this.googleCalendar.deletarEvento(user.id, a.googleEventId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Falha ao deletar evento Google ${a.googleEventId}: ${msg}`);
      }
    }

    const result = await this.prisma.agendaItem.deleteMany({ where });
    return { ok: true, deleted: result.count };
  }

  /**
   * Backfill: empurra pro Google Calendar todos os compromissos FUTUROS do
   * usuário que ainda não foram espelhados (googleEventId nulo) — ex.: os que
   * ele criou ANTES de conectar o Google. É idempotente (só pega os sem id) e
   * best-effort por item (falha em um não derruba os demais).
   */
  async sincronizarGoogle(
    user: AuthenticatedUser,
  ): Promise<{ sincronizados: number; importados: number; removidos: number; total: number }> {
    const conn = await this.userIntegracoes
      .findByServico(user, 'google_calendar')
      .catch(() => null);
    if (!conn || !conn.ativo) {
      throw new BusinessRuleException(
        'Conecte seu Google Calendar antes de sincronizar.',
        ErrorCode.BUSINESS_RULE_VIOLATION,
      );
    }
    const inicioHoje = new Date();
    inicioHoje.setHours(0, 0, 0, 0);
    const pendentes = await this.prisma.agendaItem.findMany({
      where: { usuarioId: user.id, googleEventId: null, data: { gte: inicioHoje } },
      orderBy: { data: 'asc' },
      take: 200,
    });

    let sincronizados = 0;
    for (const item of pendentes) {
      try {
        const ev = await this.googleCalendar.criarEvento(user.id, {
          titulo: item.titulo,
          inicio: item.data,
          fim: this.calcFim(item.data, item.duracao),
          descricao: item.observacao ?? undefined,
          local: item.local ?? undefined,
          alertas: item.alertas,
        });
        if (ev.id) {
          await this.prisma.agendaItem.updateMany({
            where: { id: item.id, empresaId: item.empresaId },
            data: { googleEventId: ev.id },
          });
          sincronizados++;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Sync Google: falha no item ${item.id}: ${msg}`);
      }
    }

    // Reconciliação MÃO-DUPLA (Google → Betinna): compromissos FUTUROS já
    // espelhados (googleEventId) que foram APAGADOS/CANCELADOS no Google somem
    // da Betinna também. Best-effort por item (falha em um não derruba os demais).
    const espelhados = await this.prisma.agendaItem.findMany({
      where: { usuarioId: user.id, googleEventId: { not: null }, data: { gte: inicioHoje } },
      select: { id: true, empresaId: true, googleEventId: true, data: true },
      take: 500,
    });
    let removidos = 0;
    for (const item of espelhados) {
      if (!item.googleEventId) continue;
      // Tarefas (gtask:) NÃO são eventos — obterEvento daria 404 e apagaria por
      // engano. Reconciliação de tarefas é feita separado (abaixo, no import).
      if (item.googleEventId.startsWith('gtask:')) continue;
      try {
        const ev = await this.googleCalendar.obterEvento(user.id, item.googleEventId);
        if (ev === null) {
          await this.prisma.agendaItem.deleteMany({
            where: { id: item.id, empresaId: item.empresaId },
          });
          removidos++;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Reconciliação Google: falha no item ${item.id}: ${msg}`);
      }
    }

    // IMPORT Google → Betinna: eventos que nasceram NO Google (e ainda não
    // existem aqui) viram compromissos da Betinna — com googleEventId, pra
    // reconciliar/editar depois. Só eventos COM HORA (all-day fica no overlay
    // read-only). Janela hoje..+180d, bounded por maxResults + cap de segurança.
    const idsExistentes = new Set<string>();
    for (const e of espelhados) if (e.googleEventId) idsExistentes.add(e.googleEventId);
    const fimJanela = new Date(inicioHoje);
    fimJanela.setDate(fimJanela.getDate() + 180);
    const googleEvents = await this.googleCalendar
      .listarEventos(user.id, inicioHoje, fimJanela, 250)
      .catch((err) => {
        // NÃO engolir calado: falha aqui (token expirado/revogado, conta errada)
        // é a causa de "0 importado" com o calendário cheio. Logar pra diagnóstico.
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Import Google: listarEventos falhou (usuário ${user.id}): ${msg}`);
        return [] as Awaited<ReturnType<typeof this.googleCalendar.listarEventos>>;
      });
    const empresaIdImport = getCallerEmpresaId(user);
    let importados = 0;
    for (const ev of googleEvents) {
      if (importados >= 100) break; // guarda contra recorrência gigante
      if (!ev.id || ev.status === 'cancelled' || idsExistentes.has(ev.id)) continue;
      let inicio: Date;
      let duracao: number;
      if (ev.start?.dateTime) {
        // Evento COM HORA.
        inicio = new Date(ev.start.dateTime);
        const fim = ev.end?.dateTime ? new Date(ev.end.dateTime) : null;
        duracao = fim ? Math.max(15, Math.round((fim.getTime() - inicio.getTime()) / 60000)) : 60;
      } else if (ev.start?.date) {
        // Dia inteiro: ancora ao MEIO-DIA (12:00) do dia, não à meia-noite.
        // O servidor roda em UTC — `${date}T00:00:00` viraria 00:00Z e no fuso do
        // Brasil (UTC-3) cairia no DIA ANTERIOR (21:00 da véspera), sumindo do dia
        // certo. Meio-dia dá folga de ±12h contra qualquer fuso do usuário.
        inicio = new Date(`${ev.start.date}T12:00:00`);
        // CAÇADA-BUG #13: evento all-day MULTI-DIA. Google usa `end.date` EXCLUSIVO (o dia seguinte
        // ao último). Antes fixávamos 1440 (1 dia) → depois do sync o evento sumia dos dias 2..N.
        // duração = (end − start) em dias × 1440.
        const fimAllDay = ev.end?.date ? new Date(`${ev.end.date}T12:00:00`) : null;
        const dias =
          fimAllDay && !isNaN(fimAllDay.getTime())
            ? Math.max(1, Math.round((fimAllDay.getTime() - inicio.getTime()) / 86_400_000))
            : 1;
        duracao = dias * 1440;
      } else {
        continue; // sem início utilizável
      }
      const alertas = (ev.reminders?.overrides ?? [])
        .map((o) => o.minutes)
        .filter((m) => Number.isFinite(m) && m >= 0)
        .slice(0, 5);
      try {
        await this.prisma.agendaItem.create({
          data: {
            empresaId: empresaIdImport,
            usuarioId: user.id,
            titulo: ev.summary?.trim() || '(sem título)',
            data: inicio,
            duracao,
            tipo: 'REUNIAO',
            observacao: ev.description ?? null,
            local: ev.location ?? null,
            alertas,
            googleEventId: ev.id,
          },
        });
        idsExistentes.add(ev.id);
        importados++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Import Google: falha ao importar ${ev.id}: ${msg}`);
      }
    }

    // IMPORT de TAREFAS (Google Tasks — API separada). Tarefa criada no Google
    // NÃO aparece no Events API; vem daqui. Vira AgendaItem tipo TAREFA, id
    // prefixado 'gtask:' (pra reconciliação não tratar como evento). Só as com
    // data (due). Precisa do escopo tasks.readonly (reconectar) — se faltar, 403.
    // #R3 — flag de sucesso da listagem. Se a Tasks API falha (5xx transiente, escopo perdido), NÃO
    // podemos reconciliar: um `[]` do catch faria a reconciliação abaixo APAGAR todas as tarefas
    // gtask: locais da janela (perda de dados). Falhou → importa nada E pula a reconciliação.
    let tarefasListadasOk = true;
    const tarefas = await this.googleCalendar
      .listarTarefas(user.id, inicioHoje, fimJanela)
      .catch((err) => {
        tarefasListadasOk = false;
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `Import Google: listarTarefas falhou (usuário ${user.id}): ${msg} ` +
            `— provável falta do escopo tasks.readonly (reconectar) ou Tasks API desabilitada. ` +
            `Reconciliação de tarefas PULADA (não apaga nada).`,
        );
        return [] as Awaited<ReturnType<typeof this.googleCalendar.listarTarefas>>;
      });
    for (const t of tarefas) {
      if (importados >= 100 || !t.id || !t.due) continue;
      const gid = `gtask:${t.id}`;
      if (idsExistentes.has(gid)) continue;
      // `due` é uma DATA (Google ignora a hora): ancora ao meio-dia local.
      const inicio = new Date(`${t.due.slice(0, 10)}T12:00:00`);
      if (isNaN(inicio.getTime())) continue;
      try {
        await this.prisma.agendaItem.create({
          data: {
            empresaId: empresaIdImport,
            usuarioId: user.id,
            titulo: t.title?.trim() || '(tarefa sem título)',
            data: inicio,
            duracao: 30,
            tipo: 'TAREFA',
            observacao: t.notes ?? null,
            googleEventId: gid,
          },
        });
        idsExistentes.add(gid);
        importados++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Import Google: falha ao importar tarefa ${t.id}: ${msg}`);
      }
    }

    // CAÇADA-BUG #11: reconciliação Google → Betinna das TAREFAS (a de eventos pula gtask: pra não
    // dar 404). `listarTarefas` devolve só as NÃO concluídas com due na janela; uma tarefa concluída
    // ou apagada no Google não vem → some daqui também. Apaga os AgendaItem gtask: FUTUROS dentro da
    // janela cujo id não veio na listagem atual (fora da janela não dá pra afirmar que sumiu).
    if (tarefasListadasOk) {
      const gidsAtuaisTarefas = new Set(
        tarefas.filter((t) => t.id && t.due).map((t) => `gtask:${t.id}`),
      );
      const tarefasLocais = espelhados.filter(
        (e) => e.googleEventId?.startsWith('gtask:') && e.data >= inicioHoje && e.data <= fimJanela,
      );
      for (const item of tarefasLocais) {
        if (item.googleEventId && !gidsAtuaisTarefas.has(item.googleEventId)) {
          await this.prisma.agendaItem.deleteMany({
            where: { id: item.id, empresaId: item.empresaId },
          });
          removidos++;
        }
      }
    }

    this.logger.log(
      `Sync Google: ${sincronizados} enviados, ${importados} importados, ${removidos} removidos ` +
        `(Google devolveu ${googleEvents.length} eventos + ${tarefas.length} tarefas) — usuário ${user.id}`,
    );
    return { sincronizados, importados, removidos, total: pendentes.length };
  }

  /**
   * Overlay READ-ONLY: lista os eventos do Google Calendar do usuário numa
   * faixa de datas, pra mostrar dentro da Agenda do Betinna (o que ele já tem
   * no Google aparece aqui, sempre ao vivo). Não persiste nada — só lê.
   * Best-effort: falha no Google devolve lista vazia, não derruba a tela.
   */
  async listarGoogleEventos(
    user: AuthenticatedUser,
    inicio: Date,
    fim: Date,
  ): Promise<{
    conectado: boolean;
    eventos: Array<{
      id: string;
      titulo: string;
      inicio: string;
      fim: string;
      allDay: boolean;
      htmlLink: string | null;
    }>;
  }> {
    const conn = await this.userIntegracoes
      .findByServico(user, 'google_calendar')
      .catch(() => null);
    if (!conn || !conn.ativo) return { conectado: false, eventos: [] };

    const raw = await this.googleCalendar.listarEventos(user.id, inicio, fim, 250).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`listarGoogleEventos falhou (usuário ${user.id}): ${msg}`);
      return [];
    });

    const eventos = raw
      .filter((e) => e.status !== 'cancelled' && e.id)
      .map((e) => {
        // dateTime = evento com hora; date = dia inteiro (all-day).
        const allDay = !e.start.dateTime;
        return {
          id: e.id as string,
          titulo: e.summary?.trim() || '(sem título)',
          inicio: e.start.dateTime ?? `${e.start.date}T00:00:00`,
          fim: e.end.dateTime ?? `${e.end.date ?? e.start.date}T00:00:00`,
          allDay,
          htmlLink: e.htmlLink ?? null,
        };
      });
    return { conectado: true, eventos };
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
        local: item.local ?? undefined,
        alertas: item.alertas,
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
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    const c = await this.prisma.cliente.findFirst({
      where: { id: clienteId, empresaId: user.empresaIdAtiva },
      select: { id: true, representanteId: true },
    });
    if (!c) throw new NotFoundException('Cliente', clienteId);
    const scope = await this.repScope.getRepIds(user);
    if (scope !== null && (c.representanteId === null || !scope.includes(c.representanteId))) {
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
