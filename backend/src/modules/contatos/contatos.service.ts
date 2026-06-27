import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { ForbiddenException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { RepScopeService } from '@shared/scope/rep-scope.service';
import { PermissionsService } from '@modules/permissions/permissions.service';
import { LeadsService } from '@modules/leads/leads.service';
import { createLeadSchema } from '@modules/leads/leads.dto';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { type Paginated, buildPaginated } from '@shared/types/pagination';
import type { AcaoMassaDto, CriarLeadsDto, ListContatosDto } from './contatos.dto';

export interface AcaoMassaResult {
  ok: true;
  afetados: number;
  falhas: Array<{ id: string; erro: string }>;
}

export type ContatoTipo = 'LEAD' | 'CLIENTE' | 'CONVERSA';

export interface ContatoAgregado {
  /** Chave de deduplicação (sufixo do telefone, ou email, ou origem:id). */
  chave: string;
  nome: string;
  telefone: string | null;
  email: string | null;
  cidade: string | null;
  uf: string | null;
  /** Um contato pode ser mais de um (ex.: ['LEAD','CLIENTE']). */
  tipos: ContatoTipo[];
  representante: { id: string; nome: string } | null;
  // Referências pras telas de detalhe certas:
  leadId: string | null;
  leadEtapa: string | null;
  clienteId: string | null;
  clienteStatus: string | null;
  clienteOmieStatus: string | null;
  conversaId: string | null;
  canal: string | null;
  ultimaInteracaoEm: string | null;
  criadoEm: string;
}

/** Teto por fonte — evita carregar base inteira num tenant gigante (MVP). */
const CAP = 5000;

@Injectable()
export class ContatosService {
  // PERF: o list() funde até CAP×3 (~15k) linhas Lead+Cliente+Conversa e pagina EM MEMÓRIA — TODA
  // navegação de página re-fazia o fetch+merge (custo O(base), não O(page)). Cache curto do conjunto
  // já mesclado+ordenado por (empresa+filtros+escopo): navegar entre páginas reusa o trabalho. TTL
  // baixo (alguns segundos) → staleness desprezível pra uma lista de CRM. (Reescrita em SQL = follow-up.)
  private readonly listaCache = new Map<
    string,
    { dados: ContatoAgregado[]; truncado: boolean; expiresAt: number }
  >();
  private static readonly LISTA_TTL_MS = 15_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly repScope: RepScopeService,
    private readonly leads: LeadsService,
    private readonly permissions: PermissionsService,
  ) {}

  private requireEmpresa(user: AuthenticatedUser): string {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException(
        'Empresa não definida para esta requisição',
        ErrorCode.TENANT_ACCESS_DENIED,
      );
    }
    return user.empresaIdAtiva;
  }

  /** Últimos 8 dígitos do telefone (D18). null se < 8 dígitos. */
  private sufixoTel(tel: string | null | undefined): string | null {
    const d = (tel ?? '').replace(/\D/g, '');
    return d.length >= 8 ? d.slice(-8) : null;
  }

  /** Telefone "cru" de uma conversa: cliente > metadata > peerId (sem grupo/lid). */
  private telDaConversa(c: {
    peerId: string;
    metadata: Prisma.JsonValue | null;
    cliente: { telefone: string | null } | null;
  }): string | null {
    if (c.cliente?.telefone) return c.cliente.telefone;
    const meta = (c.metadata ?? {}) as Record<string, unknown>;
    if (typeof meta.telefone === 'string' && meta.telefone) return meta.telefone;
    const grupoOuLid = c.peerId.includes('@g.us') || c.peerId.includes('@lid');
    if (grupoOuLid) return null;
    const bruto = c.peerId.split('@')[0]?.split(':')[0] ?? '';
    return /\d{8,}/.test(bruto) ? bruto : null;
  }

  async list(
    user: AuthenticatedUser,
    params: ListContatosDto,
  ): Promise<Paginated<ContatoAgregado> & { truncado: boolean }> {
    const empresaId = this.requireEmpresa(user);
    const scope = await this.repScope.getRepIds(user);
    const term = params.search?.trim();
    const repId = params.representanteId;

    const wantLead = !params.tipo || params.tipo === 'LEAD';
    const wantCliente = !params.tipo || params.tipo === 'CLIENTE';
    const wantConversa = !params.tipo || params.tipo === 'CONVERSA';

    // Validação de escopo do repId ANTES do cache — segurança não pode ser cacheada/bypassada.
    if (repId && scope !== null && !scope.includes(repId)) {
      throw new ForbiddenException(
        'Você não tem acesso à carteira deste representante',
        ErrorCode.TENANT_ACCESS_DENIED,
      );
    }
    // Cache do conjunto mesclado+ordenado: navegar entre páginas reusa o fetch+merge.
    const cacheKey = JSON.stringify({
      empresaId,
      scope,
      role: user.role,
      uid: user.id,
      term: term ?? null,
      repId: repId ?? null,
      tipo: params.tipo ?? null,
      sortBy: params.sortBy,
    });
    const hit = this.listaCache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) {
      const start = (params.page - 1) * params.limit;
      const slice = hit.dados.slice(start, start + params.limit);
      return {
        ...buildPaginated(slice, hit.dados.length, params.page, params.limit),
        truncado: hit.truncado,
      };
    }

    // ── WHERE por fonte (tenant + carteira + busca + filtro de rep) ──
    const leadWhere: Prisma.LeadWhereInput = { empresaId };
    const clienteWhere: Prisma.ClienteWhereInput = { empresaId };
    const conversaWhere: Prisma.ConversationWhereInput = { empresaId };

    if (scope !== null) {
      leadWhere.representanteId = { in: scope };
      clienteWhere.representanteId = { in: scope };
    }
    // REP só vê o próprio WhatsApp nas conversas (igual ao Inbox).
    if (user.role === 'REP') {
      conversaWhere.canal = 'WHATSAPP';
      conversaWhere.proprietarioId = user.id;
    }
    if (repId) {
      // O filtro ?representanteId NÃO pode furar o escopo de carteira: se há escopo (REP/GERENTE)
      // e o rep pedido está fora dele, nega — senão sobrescrevia o {in: scope} e vazava carteira
      // alheia (leads/clientes de qualquer rep da empresa).
      if (scope !== null && !scope.includes(repId)) {
        throw new ForbiddenException(
          'Você não tem acesso à carteira deste representante',
          ErrorCode.TENANT_ACCESS_DENIED,
        );
      }
      leadWhere.representanteId = repId;
      clienteWhere.representanteId = repId;
      conversaWhere.atribuidoId = repId;
    }
    if (term) {
      leadWhere.OR = [
        { nome: { contains: term, mode: 'insensitive' } },
        { contatoNome: { contains: term, mode: 'insensitive' } },
        { contatoTelefone: { contains: term } },
        { contatoEmail: { contains: term, mode: 'insensitive' } },
      ];
      clienteWhere.OR = [
        { nome: { contains: term, mode: 'insensitive' } },
        { telefone: { contains: term } },
        { email: { contains: term, mode: 'insensitive' } },
        { cnpj: { contains: term } },
      ];
      conversaWhere.OR = [
        { peerNome: { contains: term, mode: 'insensitive' } },
        { peerId: { contains: term } },
        { cliente: { nome: { contains: term, mode: 'insensitive' } } },
      ];
    }

    const repSel = { select: { id: true, nome: true } } as const;
    const [leads, clientes, conversas] = await Promise.all([
      wantLead
        ? this.prisma.lead.findMany({
            where: leadWhere,
            take: CAP + 1,
            orderBy: { criadoEm: 'desc' },
            select: {
              id: true,
              nome: true,
              contatoNome: true,
              contatoTelefone: true,
              contatoEmail: true,
              cidade: true,
              uf: true,
              etapa: true,
              clienteId: true,
              criadoEm: true,
              representante: repSel,
            },
          })
        : [],
      wantCliente
        ? this.prisma.cliente.findMany({
            where: clienteWhere,
            take: CAP + 1,
            orderBy: { criadoEm: 'desc' },
            select: {
              id: true,
              nome: true,
              telefone: true,
              email: true,
              cidade: true,
              uf: true,
              status: true,
              omieStatus: true,
              criadoEm: true,
              representante: repSel,
            },
          })
        : [],
      wantConversa
        ? this.prisma.conversation.findMany({
            where: conversaWhere,
            take: CAP + 1,
            orderBy: [{ ultimaMsgEm: 'desc' }, { criadoEm: 'desc' }],
            select: {
              id: true,
              peerNome: true,
              peerId: true,
              metadata: true,
              canal: true,
              clienteId: true,
              ultimaMsgEm: true,
              criadoEm: true,
              cliente: { select: { nome: true, telefone: true } },
              atribuido: repSel,
            },
          })
        : [],
    ]);

    const truncado = leads.length > CAP || clientes.length > CAP || conversas.length > CAP;

    // ── Merge por chave (telefone-sufixo > email > origem:id) ──
    const map = new Map<string, ContatoAgregado>();
    const pegar = (chave: string): ContatoAgregado => {
      const ex = map.get(chave);
      if (ex) return ex;
      const novo: ContatoAgregado = {
        chave,
        nome: '',
        telefone: null,
        email: null,
        cidade: null,
        uf: null,
        tipos: [],
        representante: null,
        leadId: null,
        leadEtapa: null,
        clienteId: null,
        clienteStatus: null,
        clienteOmieStatus: null,
        conversaId: null,
        canal: null,
        ultimaInteracaoEm: null,
        criadoEm: new Date().toISOString(),
      };
      map.set(chave, novo);
      return novo;
    };
    const maisRecente = (a: string | null, b: string): string => (!a || b > a ? b : a);

    for (const l of leads) {
      const chave =
        this.sufixoTel(l.contatoTelefone) ?? l.contatoEmail?.toLowerCase().trim() ?? `lead:${l.id}`;
      const c = pegar(chave);
      if (!c.tipos.includes('LEAD')) c.tipos.push('LEAD');
      c.leadId = l.id;
      c.leadEtapa = l.etapa;
      c.nome ||= l.contatoNome || l.nome;
      c.telefone ??= l.contatoTelefone;
      c.email ??= l.contatoEmail;
      c.cidade ??= l.cidade;
      c.uf ??= l.uf;
      c.representante ??= l.representante;
      c.clienteId ??= l.clienteId;
      c.ultimaInteracaoEm = maisRecente(c.ultimaInteracaoEm, l.criadoEm.toISOString());
    }

    for (const cl of clientes) {
      const chave =
        this.sufixoTel(cl.telefone) ?? cl.email?.toLowerCase().trim() ?? `cliente:${cl.id}`;
      const c = pegar(chave);
      if (!c.tipos.includes('CLIENTE')) c.tipos.push('CLIENTE');
      c.clienteId = cl.id;
      c.clienteStatus = cl.status;
      c.clienteOmieStatus = cl.omieStatus;
      // Cliente real tem prioridade no nome exibido.
      c.nome = cl.nome || c.nome;
      c.telefone ??= cl.telefone;
      c.email ??= cl.email;
      c.cidade ??= cl.cidade;
      c.uf ??= cl.uf;
      c.representante ??= cl.representante;
      c.ultimaInteracaoEm = maisRecente(c.ultimaInteracaoEm, cl.criadoEm.toISOString());
    }

    for (const cv of conversas) {
      const tel = this.telDaConversa(cv);
      const chave = this.sufixoTel(tel) ?? `conversa:${cv.id}`;
      const c = pegar(chave);
      if (!c.tipos.includes('CONVERSA')) c.tipos.push('CONVERSA');
      c.conversaId = cv.id;
      c.canal = cv.canal;
      c.clienteId ??= cv.clienteId;
      c.nome ||= cv.cliente?.nome || cv.peerNome || tel || 'Sem nome';
      c.telefone ??= tel;
      c.representante ??= cv.atribuido;
      const quando = (cv.ultimaMsgEm ?? cv.criadoEm).toISOString();
      c.ultimaInteracaoEm = maisRecente(c.ultimaInteracaoEm, quando);
      c.criadoEm = cv.criadoEm.toISOString();
    }

    // Nomes vazios → fallback final.
    let arr = [...map.values()].map((c) => ({
      ...c,
      nome: c.nome || c.telefone || c.email || 'Sem nome',
      criadoEm: c.ultimaInteracaoEm ?? c.criadoEm,
    }));

    // Filtro de tipo (quando pedido, garante que o contato É daquele tipo).
    if (params.tipo) arr = arr.filter((c) => c.tipos.includes(params.tipo!));

    arr.sort((a, b) => {
      if (params.sortBy === 'nome') return a.nome.localeCompare(b.nome, 'pt-BR');
      return (b.ultimaInteracaoEm ?? '').localeCompare(a.ultimaInteracaoEm ?? '');
    });

    // Cacheia o conjunto mesclado+ordenado (pré-paginação) — as próximas páginas vêm daqui.
    this.listaCache.set(cacheKey, {
      dados: arr,
      truncado,
      expiresAt: Date.now() + ContatosService.LISTA_TTL_MS,
    });

    const total = arr.length;
    const start = (params.page - 1) * params.limit;
    const slice = arr.slice(start, start + params.limit);
    return { ...buildPaginated(slice, total, params.page, params.limit), truncado };
  }

  /**
   * Ação em lote. O front manda os ids subjacentes (leadIds/clienteIds/
   * conversaIds) dos contatos selecionados; aqui resolvemos só os ACESSÍVEIS
   * (tenant + carteira) e aplicamos a ação em cada entidade.
   */
  async acaoMassa(user: AuthenticatedUser, dto: AcaoMassaDto): Promise<AcaoMassaResult> {
    const empresaId = this.requireEmpresa(user);
    const scope = await this.repScope.getRepIds(user);
    const falhas: Array<{ id: string; erro: string }> = [];

    const leadWhere: Prisma.LeadWhereInput = { empresaId, id: { in: dto.leadIds } };
    const cliWhere: Prisma.ClienteWhereInput = { empresaId, id: { in: dto.clienteIds } };
    if (scope !== null) {
      leadWhere.representanteId = { in: scope };
      cliWhere.representanteId = { in: scope };
    }
    const convWhere: Prisma.ConversationWhereInput = { empresaId, id: { in: dto.conversaIds } };
    if (user.role === 'REP') convWhere.proprietarioId = user.id;

    const [leadIds, clienteIds, conversaIds] = await Promise.all([
      dto.leadIds.length
        ? this.prisma.lead
            .findMany({ where: leadWhere, select: { id: true } })
            .then((r) => r.map((x) => x.id))
        : Promise.resolve<string[]>([]),
      dto.clienteIds.length
        ? this.prisma.cliente
            .findMany({ where: cliWhere, select: { id: true } })
            .then((r) => r.map((x) => x.id))
        : Promise.resolve<string[]>([]),
      dto.conversaIds.length
        ? this.prisma.conversation
            .findMany({ where: convWhere, select: { id: true } })
            .then((r) => r.map((x) => x.id))
        : Promise.resolve<string[]>([]),
    ]);

    // ── TAG (leads + clientes) ──
    if (dto.acao === 'tag') {
      const tags = await this.prisma.tag.findMany({
        where: { empresaId, id: { in: dto.tagIds ?? [] } },
        select: { id: true },
      });
      const tagIds = tags.map((t) => t.id);
      if (tagIds.length === 0) return { ok: true, afetados: 0, falhas };
      if (dto.modo === 'adicionar') {
        await this.prisma.leadTag.createMany({
          data: leadIds.flatMap((leadId) =>
            tagIds.map((tagId) => ({ leadId, tagId, origem: 'usuario' })),
          ),
          skipDuplicates: true,
        });
        await this.prisma.clienteTag.createMany({
          data: clienteIds.flatMap((clienteId) => tagIds.map((tagId) => ({ clienteId, tagId }))),
          skipDuplicates: true,
        });
      } else {
        await this.prisma.leadTag.deleteMany({
          where: { leadId: { in: leadIds }, tagId: { in: tagIds } },
        });
        await this.prisma.clienteTag.deleteMany({
          where: { clienteId: { in: clienteIds }, tagId: { in: tagIds } },
        });
      }
      return { ok: true, afetados: leadIds.length + clienteIds.length, falhas };
    }

    // ── MOVER ETAPA (só leads — reusa a validação/SLA do LeadsService) ──
    if (dto.acao === 'mover-etapa') {
      let movidos = 0;
      for (const id of leadIds) {
        try {
          await this.leads.moverEtapa(user, id, {
            funilEtapaId: dto.funilEtapaId,
            motivo: dto.motivo,
          });
          movidos += 1;
        } catch (err) {
          falhas.push({ id, erro: err instanceof Error ? err.message : String(err) });
        }
      }
      return { ok: true, afetados: movidos, falhas };
    }

    // ── EXCLUIR ──
    // Gate de DELETE por entidade: a ação-massa entra só com `clientes.edit`, mas excluir é
    // destrutivo e irreversível (apaga lead/cliente/conversa/mensagem). Sem isso, um papel sem
    // permissão de delete burlava DELETE /clientes (clientes.delete) e DELETE /leads (kanban.delete)
    // por aqui. ADMIN bypassa (igual ao PermissionsGuard). 'inbox' não tem delete na matriz →
    // exclusão de conversa fica ADMIN-only por ora.
    if (user.role !== 'ADMIN') {
      const gates: Array<{ aplica: boolean; module: string; action: 'delete' }> = [
        { aplica: leadIds.length > 0, module: 'kanban', action: 'delete' },
        { aplica: clienteIds.length > 0, module: 'clientes', action: 'delete' },
        { aplica: conversaIds.length > 0, module: 'inbox', action: 'delete' },
      ];
      for (const g of gates) {
        if (g.aplica && !(await this.permissions.userCan(user.role, g.module, g.action))) {
          throw new ForbiddenException(
            `Sem permissão para excluir: requer ${g.module}.${g.action}`,
            ErrorCode.INSUFFICIENT_PERMISSIONS,
          );
        }
      }
    }
    let excluidos = 0;
    if (leadIds.length) {
      const r = await this.prisma.lead.deleteMany({ where: { id: { in: leadIds }, empresaId } });
      excluidos += r.count;
    }
    if (conversaIds.length) {
      // Transação: apaga mensagens e conversas juntas (all-or-nothing). Sem isso, falha na 2ª
      // deixava conversas sem mensagens (zumbis).
      const [, r] = await this.prisma.$transaction([
        this.prisma.message.deleteMany({ where: { conversationId: { in: conversaIds } } }),
        this.prisma.conversation.deleteMany({ where: { id: { in: conversaIds }, empresaId } }),
      ]);
      excluidos += r.count;
    }
    // Clientes 1 a 1: FK de pedidos/propostas (RESTRICT) pode bloquear.
    for (const id of clienteIds) {
      try {
        await this.prisma.cliente.deleteMany({ where: { id, empresaId } });
        excluidos += 1;
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
          falhas.push({ id, erro: 'Cliente tem pedidos/propostas — inative em vez de excluir' });
        } else {
          falhas.push({ id, erro: err instanceof Error ? err.message : String(err) });
        }
      }
    }
    return { ok: true, afetados: excluidos, falhas };
  }

  /**
   * Adiciona contatos a um funil criando um Lead pra cada um. Pula contatos cujo
   * telefone já casa um lead existente (dedup D18) — reporta em `jaEramLead`.
   * Reusa LeadsService.create (resolve funil/etapa padrão, força rep p/ REP,
   * dispara LEAD_CRIADO). Falha por contato não derruba o lote.
   */
  async criarLeads(
    user: AuthenticatedUser,
    dto: CriarLeadsDto,
  ): Promise<AcaoMassaResult & { jaEramLead: number }> {
    const empresaId = this.requireEmpresa(user);
    const scope = await this.repScope.getRepIds(user);
    const falhas: Array<{ id: string; erro: string }> = [];

    // Telefones (sufixo 8 díg.) que JÁ têm lead — consultamos só os sufixos DO LOTE via match
    // por sufixo (D18), não a base inteira em memória. O(lote) em vez de O(base) — importação
    // grande não vira leitura pesada + pico de memória.
    const sufixosLote = Array.from(
      new Set(dto.contatos.map((c) => this.sufixoTel(c.telefone)).filter((s): s is string => !!s)),
    );
    const sufixosComLead = new Set<string>();
    if (sufixosLote.length > 0) {
      const scopeSql =
        scope !== null
          ? Prisma.sql`AND "representanteId" IN (${Prisma.join(scope.length ? scope : ['__none__'])})`
          : Prisma.empty;
      const rows = await this.prisma.$queryRaw<Array<{ sufixo: string }>>(Prisma.sql`
        SELECT DISTINCT RIGHT(REGEXP_REPLACE("contatoTelefone", '[^0-9]', '', 'g'), 8) AS sufixo
        FROM "Lead"
        WHERE "empresaId" = ${empresaId}
          AND "contatoTelefone" IS NOT NULL
          ${scopeSql}
          AND RIGHT(REGEXP_REPLACE("contatoTelefone", '[^0-9]', '', 'g'), 8) IN (${Prisma.join(sufixosLote)})
      `);
      for (const r of rows) if (r.sufixo) sufixosComLead.add(r.sufixo);
    }

    let criados = 0;
    let jaEramLead = 0;
    for (const [i, c] of dto.contatos.entries()) {
      const sufixo = this.sufixoTel(c.telefone);
      if (sufixo && sufixosComLead.has(sufixo)) {
        jaEramLead += 1;
        continue;
      }
      const nome = (c.nome ?? '').trim();
      const tel = (c.telefone ?? '').replace(/\D/g, '');
      const nomeLead = nome.length >= 2 ? nome : tel || 'Contato';
      const email = c.email && /.+@.+\..+/.test(c.email) ? c.email : undefined;
      try {
        // parse() aplica os defaults do createLeadSchema (valorEstimado/etapa/etc).
        const payload = createLeadSchema.parse({
          nome: nomeLead,
          contatoNome: nome || undefined,
          contatoTelefone: c.telefone || undefined,
          contatoEmail: email,
          cidade: c.cidade,
          uf: c.uf,
          funilId: dto.funilId,
          funilEtapaId: dto.funilEtapaId,
          representanteId: c.representanteId ?? dto.representanteId,
        });
        await this.leads.create(user, payload);
        criados += 1;
        if (sufixo) sufixosComLead.add(sufixo); // evita duplicar dentro do próprio lote
      } catch (err) {
        falhas.push({
          id: `#${i + 1} ${nomeLead}`,
          erro: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return { ok: true, afetados: criados, falhas, jaEramLead };
  }
}
