import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { ForbiddenException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { RepScopeService } from '@shared/scope/rep-scope.service';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { type Paginated, buildPaginated } from '@shared/types/pagination';
import type { ListContatosDto } from './contatos.dto';

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly repScope: RepScopeService,
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

    const total = arr.length;
    const start = (params.page - 1) * params.limit;
    const slice = arr.slice(start, start + params.limit);
    return { ...buildPaginated(slice, total, params.page, params.limit), truncado };
  }
}
