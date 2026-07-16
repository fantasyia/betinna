import { Injectable, Logger } from '@nestjs/common';
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
  /** Tags do contato (união das tags do lead + cliente agregados). */
  tags: { id: string; nome: string; cor: string }[];
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

export interface ContatoDetalheFunil {
  funilId: string;
  funilNome: string;
  etapaId: string | null;
  etapaNome: string | null;
  dataEntrada: string | null;
}

/** Detalhe de UM contato agregado (Demanda MCP `contatos_ver`). */
export interface ContatoDetalhe {
  chave: string;
  nome: string;
  telefone: string | null;
  email: string | null;
  tipos: ContatoTipo[];
  tags: string[];
  funis: ContatoDetalheFunil[];
  representante: { id: string; nome: string } | null;
  leadIds: string[];
  clienteIds: string[];
  conversaIds: string[];
  criadoEm: string;
}

/** Linha do dedup-no-banco (paginarChaves): a chave + os ids das entidades daquele contato. */
interface ChaveRow {
  chave: string;
  lead_ids: string[];
  cliente_ids: string[];
  conversa_ids: string[];
  total: number;
}

@Injectable()
export class ContatosService {
  private readonly logger = new Logger(ContatosService.name);

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
    const term = params.search?.trim() || undefined;
    const repId = params.representanteId;

    // Validação de escopo do repId — o filtro ?representanteId NÃO pode furar a carteira.
    if (repId && scope !== null && !scope.includes(repId)) {
      throw new ForbiddenException(
        'Você não tem acesso à carteira deste representante',
        ErrorCode.TENANT_ACCESS_DENIED,
      );
    }

    // PERF (reescrita SQL): o dedup por sufixo de telefone (D18) + agrupamento + ordenação +
    // PAGINAÇÃO acontecem NO BANCO (paginarChaves) — antes fundia até ~15k linhas e paginava em
    // memória a CADA request (O(base)). Agora a query devolve só os ids da PÁGINA (O(page)) + o
    // total. O merge rico (prioridade de nome/campos) segue em memória, mas só sobre os ~limit
    // contatos da página. Validado diferencialmente contra prod (mesmo dedup/ordem/ids/total).
    const offset = (params.page - 1) * params.limit;
    const { rows, total } = await this.paginarChaves(
      {
        empresaId,
        scope,
        role: user.role,
        uid: user.id,
        term,
        repId,
        tagIds: params.tagIds,
        want: {
          lead: !params.tipo || params.tipo === 'LEAD',
          cliente: !params.tipo || params.tipo === 'CLIENTE',
          conversa: !params.tipo || params.tipo === 'CONVERSA',
        },
      },
      params.sortBy === 'nome' ? 'nome' : 'recente',
      params.limit,
      offset,
    );
    if (rows.length === 0) {
      return { ...buildPaginated([], total, params.page, params.limit), truncado: false };
    }

    // Busca SÓ as entidades da página (por id) — mesma ordenação de antes pra o merge first-wins
    // (||=/??=) escolher o mesmo registro dentro de cada grupo.
    const pageLeadIds = [...new Set(rows.flatMap((r) => r.lead_ids))];
    const pageClienteIds = [...new Set(rows.flatMap((r) => r.cliente_ids))];
    const pageConversaIds = [...new Set(rows.flatMap((r) => r.conversa_ids))];
    const repSel = { select: { id: true, nome: true } } as const;
    const [leads, clientes, conversas] = await Promise.all([
      pageLeadIds.length
        ? this.prisma.lead.findMany({
            where: { empresaId, id: { in: pageLeadIds } },
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
      pageClienteIds.length
        ? this.prisma.cliente.findMany({
            where: { empresaId, id: { in: pageClienteIds } },
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
      pageConversaIds.length
        ? this.prisma.conversation.findMany({
            where: { empresaId, id: { in: pageConversaIds } },
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

    // Tags da página (lead + cliente) → mapa por entidade pra acumular no merge.
    const tagSel = { tag: { select: { id: true, nome: true, cor: true } } } as const;
    const [leadTags, clienteTags] = await Promise.all([
      pageLeadIds.length
        ? this.prisma.leadTag.findMany({
            where: { leadId: { in: pageLeadIds } },
            select: { leadId: true, ...tagSel },
          })
        : [],
      pageClienteIds.length
        ? this.prisma.clienteTag.findMany({
            where: { clienteId: { in: pageClienteIds } },
            select: { clienteId: true, ...tagSel },
          })
        : [],
    ]);
    const tagsPorLead = new Map<string, { id: string; nome: string; cor: string }[]>();
    for (const lt of leadTags) {
      const arr = tagsPorLead.get(lt.leadId) ?? [];
      arr.push(lt.tag);
      tagsPorLead.set(lt.leadId, arr);
    }
    const tagsPorCliente = new Map<string, { id: string; nome: string; cor: string }[]>();
    for (const ct of clienteTags) {
      const arr = tagsPorCliente.get(ct.clienteId) ?? [];
      arr.push(ct.tag);
      tagsPorCliente.set(ct.clienteId, arr);
    }
    const acumularTags = (
      c: ContatoAgregado,
      novas: { id: string; nome: string; cor: string }[],
    ): void => {
      for (const t of novas) if (!c.tags.some((x) => x.id === t.id)) c.tags.push(t);
    };

    // ── Merge por chave (telefone-sufixo > email > origem:id) — só sobre a página ──
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
        tags: [],
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
      // CAÇADA-BUG #40: espelha o NULLIF(lower(btrim(email)),'') do SQL. `''?.toLowerCase().trim()` é
      // '' (não nullish) → o `??` não caía pro `lead:id`, gerando uma chave '' que o SQL nunca produz
      // → o contato sumia da página (byChave.get não achava). `|| undefined` normaliza email vazio.
      const chave =
        this.sufixoTel(l.contatoTelefone) ??
        (l.contatoEmail?.trim().toLowerCase() || undefined) ??
        `lead:${l.id}`;
      const c = pegar(chave);
      if (!c.tipos.includes('LEAD')) c.tipos.push('LEAD');
      acumularTags(c, tagsPorLead.get(l.id) ?? []);
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
      // #40: mesmo NULLIF do SQL — email vazio vira undefined (senão chave '' que o SQL não gera).
      const chave =
        this.sufixoTel(cl.telefone) ??
        (cl.email?.trim().toLowerCase() || undefined) ??
        `cliente:${cl.id}`;
      const c = pegar(chave);
      if (!c.tipos.includes('CLIENTE')) c.tipos.push('CLIENTE');
      acumularTags(c, tagsPorCliente.get(cl.id) ?? []);
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
    const byChave = new Map<string, ContatoAgregado>();
    for (const c of map.values()) {
      byChave.set(c.chave, {
        ...c,
        nome: c.nome || c.telefone || c.email || 'Sem nome',
        criadoEm: c.ultimaInteracaoEm ?? c.criadoEm,
      });
    }
    // A ORDEM e o filtro de tipo já vieram do SQL (rows). Só reidrato na ordem da página.
    const data = rows
      .map((r) => byChave.get(r.chave))
      .filter((c): c is ContatoAgregado => c !== undefined);

    // truncado=false: a paginação no banco expõe TODOS os contatos por páginas (nada é escondido).
    return { ...buildPaginated(data, total, params.page, params.limit), truncado: false };
  }

  /**
   * Dedup + agrupamento + ordenação + paginação NO BANCO. Devolve só os ids das entidades de
   * CADA contato da página (lead/cliente/conversa) + o total de contatos distintos.
   *
   * A chave de dedup espelha `sufixoTel`/`telDaConversa` do JS (D18): sufixo de 8 dígitos do
   * telefone > email (lower+trim) > `origem:id`. O nome/telefone/email "escolhidos" replicam a
   * prioridade do merge em memória (cliente > lead > conversa pro nome; ordem-de-processamento
   * lead > cliente > conversa pro telefone/email), com tie-break pelo registro MAIS RECENTE
   * (quando DESC) — igual ao first-wins (`||=`/`??=`) que processa em criadoEm desc.
   *
   * ⚠️ Micro-divergência conhecida e cosmética: quando 2+ CLIENTES compartilham o mesmo sufixo de
   * telefone com nomes diferentes, o merge em memória deixa o cliente mais ANTIGO vencer o nome
   * (`=` last-write), enquanto aqui vence o mais recente. Não afeta dedup/ids (ops em lote), só o
   * nome exibido nesse caso raro.
   */
  private async paginarChaves(
    opts: {
      empresaId: string;
      scope: string[] | null;
      role: string;
      uid: string;
      term?: string;
      repId?: string;
      tagIds?: string[];
      want: { lead: boolean; cliente: boolean; conversa: boolean };
    },
    sortBy: 'nome' | 'recente',
    limit: number,
    offset: number,
  ): Promise<{ rows: ChaveRow[]; total: number }> {
    const { empresaId, scope, role, uid, term, repId, want, tagIds } = opts;
    const like = term ? `%${term}%` : undefined;

    // Filtro por tags (semântica E: precisa ter TODAS). Conversa não tem tag →
    // filtrar por tag exclui conversas. HAVING COUNT(DISTINCT) = N garante o "todas".
    const temTags = (tagIds?.length ?? 0) > 0;
    const leadTagFilter = temTags
      ? Prisma.sql`AND id IN (SELECT "leadId" FROM "LeadTag" WHERE "tagId" IN (${Prisma.join(tagIds!)}) GROUP BY "leadId" HAVING COUNT(DISTINCT "tagId") = ${tagIds!.length})`
      : Prisma.empty;
    const clienteTagFilter = temTags
      ? Prisma.sql`AND id IN (SELECT "clienteId" FROM "ClienteTag" WHERE "tagId" IN (${Prisma.join(tagIds!)}) GROUP BY "clienteId" HAVING COUNT(DISTINCT "tagId") = ${tagIds!.length})`
      : Prisma.empty;

    // sufixo(expr) = últimos 8 dígitos, só se houver >=8 dígitos (senão NULL → cai p/ email/id).
    const reg = (e: Prisma.Sql) => Prisma.sql`regexp_replace(coalesce(${e},''),'[^0-9]','','g')`;
    const sufixo = (e: Prisma.Sql) =>
      Prisma.sql`CASE WHEN length(${reg(e)}) >= 8 THEN right(${reg(e)}, 8) END`;

    // telDaConversa: cliente.telefone > metadata.telefone (string) > peerId (não-grupo/lid, >=8 díg).
    const telConversa = Prisma.sql`COALESCE(
      cli.telefone,
      CASE WHEN jsonb_typeof(cv.metadata->'telefone')='string' AND (cv.metadata->>'telefone') <> ''
           THEN cv.metadata->>'telefone' END,
      CASE WHEN cv."peerId" LIKE '%@g.us%' OR cv."peerId" LIKE '%@lid%' THEN NULL
           WHEN split_part(split_part(cv."peerId",'@',1),':',1) ~ '[0-9]{8,}'
           THEN split_part(split_part(cv."peerId",'@',1),':',1)
           ELSE NULL END)`;

    // Filtro de carteira (lead/cliente): repId tem precedência sobre o escopo (já validado dentro).
    const scopeLeadCli = repId
      ? Prisma.sql`AND "representanteId" = ${repId}`
      : scope !== null
        ? Prisma.sql`AND "representanteId" IN (${Prisma.join(scope.length ? scope : ['__none__'])})`
        : Prisma.empty;

    const blocos: Prisma.Sql[] = [];
    if (want.lead) {
      blocos.push(Prisma.sql`
        SELECT 'LEAD' tipo, id lead_id, NULL::text cliente_id, NULL::text conversa_id,
          COALESCE(${sufixo(Prisma.sql`"contatoTelefone"`)}, NULLIF(lower(btrim("contatoEmail")),''), 'lead:'||id) chave,
          COALESCE(NULLIF("contatoNome",''), nome) nome_cand, "contatoTelefone" tel_cand, "contatoEmail" email_cand,
          1 ord_nome, 1 ord_tipo, "criadoEm" quando
        FROM "Lead"
        WHERE "empresaId" = ${empresaId} ${scopeLeadCli} ${leadTagFilter}
          ${like ? Prisma.sql`AND (nome ILIKE ${like} OR "contatoNome" ILIKE ${like} OR "contatoTelefone" LIKE ${like} OR "contatoEmail" ILIKE ${like})` : Prisma.empty}`);
    }
    if (want.cliente) {
      blocos.push(Prisma.sql`
        SELECT 'CLIENTE' tipo, NULL::text lead_id, id cliente_id, NULL::text conversa_id,
          COALESCE(${sufixo(Prisma.sql`telefone`)}, NULLIF(lower(btrim(email)),''), 'cliente:'||id) chave,
          nome nome_cand, telefone tel_cand, email email_cand,
          0 ord_nome, 2 ord_tipo, "criadoEm" quando
        FROM "Cliente"
        WHERE "empresaId" = ${empresaId} ${scopeLeadCli} ${clienteTagFilter}
          ${like ? Prisma.sql`AND (nome ILIKE ${like} OR telefone LIKE ${like} OR email ILIKE ${like} OR cnpj LIKE ${like})` : Prisma.empty}`);
    }
    if (want.conversa && !temTags) {
      // REP só vê o próprio WhatsApp; repId filtra por atribuído (igual ao where Prisma anterior).
      const repConv =
        role === 'REP'
          ? Prisma.sql`AND cv.canal = 'WHATSAPP' AND cv."proprietarioId" = ${uid}`
          : Prisma.empty;
      const repIdConv = repId ? Prisma.sql`AND cv."atribuidoId" = ${repId}` : Prisma.empty;
      blocos.push(Prisma.sql`
        SELECT 'CONVERSA' tipo, NULL::text lead_id, NULL::text cliente_id, cv.id conversa_id,
          COALESCE(${sufixo(telConversa)}, 'conversa:'||cv.id) chave,
          COALESCE(NULLIF(cli.nome,''), NULLIF(cv."peerNome",''), ${telConversa}) nome_cand, ${telConversa} tel_cand, NULL::text email_cand,
          2 ord_nome, 3 ord_tipo, COALESCE(cv."ultimaMsgEm", cv."criadoEm") quando
        FROM "Conversation" cv LEFT JOIN "Cliente" cli ON cli.id = cv."clienteId"
        WHERE cv."empresaId" = ${empresaId} ${repConv} ${repIdConv}
          ${like ? Prisma.sql`AND (cv."peerNome" ILIKE ${like} OR cv."peerId" LIKE ${like} OR cli.nome ILIKE ${like})` : Prisma.empty}`);
    }
    if (blocos.length === 0) return { rows: [], total: 0 };

    const cte = Prisma.sql`
      WITH src AS (${Prisma.join(blocos, ' UNION ALL ')}),
      grp AS (
        SELECT chave,
          array_remove(array_agg(lead_id), NULL) lead_ids,
          array_remove(array_agg(cliente_id), NULL) cliente_ids,
          array_remove(array_agg(conversa_id), NULL) conversa_ids,
          max(quando) ultima,
          (array_remove(array_agg(nome_cand ORDER BY ord_nome, quando DESC), NULL))[1] nome_pick,
          (array_remove(array_agg(tel_cand  ORDER BY ord_tipo, quando DESC), NULL))[1] tel_pick,
          (array_remove(array_agg(email_cand ORDER BY ord_tipo, quando DESC), NULL))[1] email_pick
        FROM src GROUP BY chave
      )`;
    const ordem =
      sortBy === 'nome'
        ? Prisma.sql`ORDER BY COALESCE(nome_pick, tel_pick, email_pick, 'Sem nome') COLLATE "pt-BR-x-icu" ASC`
        : Prisma.sql`ORDER BY ultima DESC NULLS LAST`;

    const rows = await this.prisma.$queryRaw<ChaveRow[]>(Prisma.sql`
      ${cte}
      SELECT chave, lead_ids, cliente_ids, conversa_ids, (count(*) OVER())::int total
      FROM grp ${ordem} LIMIT ${limit} OFFSET ${offset}`);
    if (rows.length > 0) return { rows, total: rows[0].total };

    // Página vazia (offset além do fim) → não há linha pra carregar o total; conta à parte.
    const cnt = await this.prisma.$queryRaw<Array<{ total: number }>>(Prisma.sql`
      ${cte} SELECT count(*)::int total FROM grp`);
    return { rows: [], total: cnt[0]?.total ?? 0 };
  }

  /**
   * Detalhe de UM contato (unificado) por identificador — leadId, clienteId,
   * telefone OU email. Resolve o sufixo de telefone (D18) e reúne TODAS as
   * entidades do contato (leads/clientes/conversas), agregando tipos, tags
   * (Lead+Cliente), funis (etapa atual + dataEntrada) e representante.
   * READ-only; respeita tenant + carteira (RepScope). Base do MCP `contatos_ver`.
   */
  async detalhe(
    user: AuthenticatedUser,
    q: { leadId?: string; clienteId?: string; telefone?: string; email?: string },
  ): Promise<ContatoDetalhe | null> {
    const empresaId = this.requireEmpresa(user);
    const scope = await this.repScope.getRepIds(user);
    const scopeWhere: Prisma.LeadWhereInput =
      scope !== null ? { representanteId: { in: scope.length ? scope : ['__none__'] } } : {};
    const scopeSql =
      scope !== null
        ? Prisma.sql`AND "representanteId" IN (${Prisma.join(scope.length ? scope : ['__none__'])})`
        : Prisma.empty;

    // 1) Descobre sufixo de telefone + email a partir do identificador informado.
    let sufixo = q.telefone ? this.sufixoTel(q.telefone) : null;
    let email = q.email?.trim().toLowerCase() || null;
    if (!sufixo && q.leadId) {
      const l = await this.prisma.lead.findFirst({
        where: { id: q.leadId, empresaId, ...scopeWhere },
        select: { contatoTelefone: true, contatoEmail: true },
      });
      if (l) {
        sufixo = this.sufixoTel(l.contatoTelefone);
        email ??= l.contatoEmail?.trim().toLowerCase() || null;
      }
    }
    if (!sufixo && q.clienteId) {
      const c = await this.prisma.cliente.findFirst({
        where: { id: q.clienteId, empresaId, ...(scopeWhere as Prisma.ClienteWhereInput) },
        select: { telefone: true, email: true },
      });
      if (c) {
        sufixo = this.sufixoTel(c.telefone);
        email ??= c.email?.trim().toLowerCase() || null;
      }
    }

    // 2) Reúne os ids das entidades do contato (sufixo de telefone, email e id direto).
    const leadIds = new Set<string>();
    const clienteIds = new Set<string>();
    const conversaIds = new Set<string>();
    if (q.leadId) leadIds.add(q.leadId);
    if (q.clienteId) clienteIds.add(q.clienteId);

    if (sufixo) {
      const [lr, cr, cv] = await Promise.all([
        this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT id FROM "Lead" WHERE "empresaId" = ${empresaId} ${scopeSql}
            AND "contatoTelefone" IS NOT NULL
            AND RIGHT(REGEXP_REPLACE("contatoTelefone", '[^0-9]', '', 'g'), 8) = ${sufixo}`),
        this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT id FROM "Cliente" WHERE "empresaId" = ${empresaId} ${scopeSql}
            AND telefone IS NOT NULL
            AND RIGHT(REGEXP_REPLACE(telefone, '[^0-9]', '', 'g'), 8) = ${sufixo}`),
        this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT cv.id FROM "Conversation" cv LEFT JOIN "Cliente" cli ON cli.id = cv."clienteId"
          WHERE cv."empresaId" = ${empresaId}
            ${user.role === 'REP' ? Prisma.sql`AND cv."proprietarioId" = ${user.id}` : Prisma.empty}
            AND RIGHT(REGEXP_REPLACE(COALESCE(cli.telefone,
              CASE WHEN cv."peerId" LIKE '%@g.us%' OR cv."peerId" LIKE '%@lid%' THEN NULL
                   ELSE split_part(split_part(cv."peerId", '@', 1), ':', 1) END), '[^0-9]', '', 'g'), 8) = ${sufixo}`),
      ]);
      lr.forEach((x) => leadIds.add(x.id));
      cr.forEach((x) => clienteIds.add(x.id));
      cv.forEach((x) => conversaIds.add(x.id));
    }
    if (email) {
      const [lr, cr] = await Promise.all([
        this.prisma.lead.findMany({
          where: { empresaId, ...scopeWhere, contatoEmail: { equals: email, mode: 'insensitive' } },
          select: { id: true },
        }),
        this.prisma.cliente.findMany({
          where: {
            empresaId,
            ...(scopeWhere as Prisma.ClienteWhereInput),
            email: { equals: email, mode: 'insensitive' },
          },
          select: { id: true },
        }),
      ]);
      lr.forEach((x) => leadIds.add(x.id));
      cr.forEach((x) => clienteIds.add(x.id));
    }

    if (leadIds.size === 0 && clienteIds.size === 0 && conversaIds.size === 0) return null;

    // 3) Carrega as entidades com tags + funil/etapa.
    const [leads, clientes, conversas] = await Promise.all([
      leadIds.size
        ? this.prisma.lead.findMany({
            where: { empresaId, id: { in: [...leadIds] } },
            orderBy: { criadoEm: 'desc' },
            select: {
              id: true,
              nome: true,
              contatoNome: true,
              contatoTelefone: true,
              contatoEmail: true,
              criadoEm: true,
              etapaDesde: true,
              representante: { select: { id: true, nome: true } },
              funil: { select: { id: true, nome: true } },
              funilEtapa: { select: { id: true, nome: true } },
              tags: { select: { tag: { select: { nome: true } } } },
            },
          })
        : [],
      clienteIds.size
        ? this.prisma.cliente.findMany({
            where: { empresaId, id: { in: [...clienteIds] } },
            orderBy: { criadoEm: 'desc' },
            select: {
              id: true,
              nome: true,
              telefone: true,
              email: true,
              criadoEm: true,
              representante: { select: { id: true, nome: true } },
              tags: { select: { tag: { select: { nome: true } } } },
            },
          })
        : [],
      conversaIds.size
        ? this.prisma.conversation.findMany({
            where: { empresaId, id: { in: [...conversaIds] } },
            select: { id: true, peerNome: true, criadoEm: true },
          })
        : [],
    ]);

    // 4) Agrega.
    const tipos: ContatoTipo[] = [];
    if (leads.length) tipos.push('LEAD');
    if (clientes.length) tipos.push('CLIENTE');
    if (conversas.length) tipos.push('CONVERSA');

    const tags = new Set<string>();
    leads.forEach((l) => l.tags.forEach((t) => tags.add(t.tag.nome)));
    clientes.forEach((c) => c.tags.forEach((t) => tags.add(t.tag.nome)));

    const funis: ContatoDetalheFunil[] = leads
      .filter((l) => l.funil)
      .map((l) => ({
        funilId: l.funil!.id,
        funilNome: l.funil!.nome,
        etapaId: l.funilEtapa?.id ?? null,
        etapaNome: l.funilEtapa?.nome ?? null,
        dataEntrada: l.etapaDesde.toISOString(),
      }));

    const cliente = clientes[0];
    const lead = leads[0];
    const conversa = conversas[0];
    const telefone = cliente?.telefone ?? lead?.contatoTelefone ?? null;
    const emailFinal = cliente?.email ?? lead?.contatoEmail ?? null;
    const nome =
      cliente?.nome ||
      lead?.contatoNome ||
      lead?.nome ||
      conversa?.peerNome ||
      telefone ||
      emailFinal ||
      'Sem nome';
    const criadoEmVals = [
      ...leads.map((l) => l.criadoEm),
      ...clientes.map((c) => c.criadoEm),
      ...conversas.map((c) => c.criadoEm),
    ];
    const criadoEm = criadoEmVals.length
      ? new Date(Math.min(...criadoEmVals.map((d) => d.getTime()))).toISOString()
      : new Date().toISOString();

    return {
      chave: sufixo ?? email ?? (lead ? `lead:${lead.id}` : cliente ? `cliente:${cliente.id}` : ''),
      nome,
      telefone,
      email: emailFinal,
      tipos,
      tags: [...tags],
      funis,
      representante: cliente?.representante ?? lead?.representante ?? null,
      leadIds: [...leadIds],
      clienteIds: [...clienteIds],
      conversaIds: [...conversaIds],
      criadoEm,
    };
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
        // userCanFor: respeita override individual (UsuarioPermissao) além do papel.
        if (g.aplica && !this.permissions.userCanFor(user.id, user.role, g.module, g.action)) {
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
  ): Promise<AcaoMassaResult & { jaEramLead: number; tagFalhas: number }> {
    const empresaId = this.requireEmpresa(user);
    const falhas: Array<{ id: string; erro: string }> = [];

    // Telefones (sufixo 8 díg.) que JÁ têm lead — consultamos só os sufixos DO LOTE via match
    // por sufixo (D18), não a base inteira em memória. O(lote) em vez de O(base) — importação
    // grande não vira leitura pesada + pico de memória.
    // DEDUP É INTEGRIDADE, NÃO VISIBILIDADE: a checagem varre a EMPRESA INTEIRA
    // (sem escopo de rep) — senão um GERENTE re-importando não enxergava o lead
    // de outro rep (nem os sem representante) e duplicava a pessoa.
    const sufixosLote = Array.from(
      new Set(dto.contatos.map((c) => this.sufixoTel(c.telefone)).filter((s): s is string => !!s)),
    );

    const sufixosComLead = new Set<string>();
    if (sufixosLote.length > 0) {
      const rows = await this.prisma.$queryRaw<Array<{ sufixo: string }>>(Prisma.sql`
        SELECT DISTINCT RIGHT(REGEXP_REPLACE("contatoTelefone", '[^0-9]', '', 'g'), 8) AS sufixo
        FROM "Lead"
        WHERE "empresaId" = ${empresaId}
          AND "contatoTelefone" IS NOT NULL
          AND RIGHT(REGEXP_REPLACE("contatoTelefone", '[^0-9]', '', 'g'), 8) IN (${Prisma.join(sufixosLote)})
      `);
      for (const r of rows) if (r.sufixo) sufixosComLead.add(r.sufixo);
    }

    // Dedup por E-MAIL (a base fria de e-mail marketing não tem telefone, então a
    // dedup por sufixo não pega — sem isso, re-importar duplicaria tudo).
    const emailsLote = Array.from(
      new Set(
        dto.contatos
          .map((c) => (c.email && /.+@.+\..+/.test(c.email) ? c.email.trim().toLowerCase() : null))
          .filter((e): e is string => !!e),
      ),
    );
    const emailsComLead = new Set<string>();
    if (emailsLote.length > 0) {
      const rows = await this.prisma.$queryRaw<Array<{ email: string }>>(Prisma.sql`
        SELECT DISTINCT LOWER("contatoEmail") AS email
        FROM "Lead"
        WHERE "empresaId" = ${empresaId}
          AND "contatoEmail" IS NOT NULL
          AND LOWER("contatoEmail") IN (${Prisma.join(emailsLote)})
      `);
      for (const r of rows) if (r.email) emailsComLead.add(r.email);
    }

    let criados = 0;
    let jaEramLead = 0;
    let tagFalhas = 0;
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
      const emailKey = email?.trim().toLowerCase();
      if (emailKey && emailsComLead.has(emailKey)) {
        jaEramLead += 1;
        continue;
      }
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
          semFunil: dto.semFunil,
          representanteId: c.representanteId ?? dto.representanteId,
        });
        const leadCriado = await this.leads.create(user, payload);
        // Aplica as tags do lote (cold/email-mkt/segmento) — best-effort por tag,
        // mas CONTADO: falha silenciosa fazia o import reportar ok sem as tags.
        for (const tagId of dto.tagIds ?? []) {
          await this.leads.adicionarTag(user, leadCriado.id, tagId).catch(() => {
            tagFalhas += 1;
          });
        }
        criados += 1;
        if (sufixo) sufixosComLead.add(sufixo); // evita duplicar dentro do próprio lote
        if (emailKey) emailsComLead.add(emailKey); // idem, dedup por e-mail no lote
      } catch (err) {
        // Corrida fechada pelo índice único de e-mail: request concorrente criou
        // primeiro → conta como "já era lead", não como falha do import.
        const conflito =
          (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') ||
          (err instanceof Error && /já existe um lead com este e-mail/i.test(err.message));
        if (conflito) {
          jaEramLead += 1;
          if (emailKey) emailsComLead.add(emailKey);
          if (sufixo) sufixosComLead.add(sufixo);
          continue;
        }
        falhas.push({
          id: `#${i + 1} ${nomeLead}`,
          erro: err instanceof Error ? err.message : String(err),
        });
      }
    }
    if (tagFalhas > 0) {
      this.logger.warn(`criarLeads: ${tagFalhas} aplicação(ões) de tag falharam no lote`);
    }
    return { ok: true, afetados: criados, falhas, jaEramLead, tagFalhas };
  }
}
