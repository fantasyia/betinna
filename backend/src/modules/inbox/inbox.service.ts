import { Injectable, Logger } from '@nestjs/common';
import {
  type Conversation,
  type ConversationCategoria,
  type ConversationStatus,
  type Message,
  type MessageChannel,
  Prisma,
  MessageDirection,
  MessageStatus,
} from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { EnvService } from '@config/env.service';
import {
  BusinessRuleException,
  ForbiddenException,
  NotFoundException,
} from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { type Paginated, buildPaginated } from '@shared/types/pagination';
import { CanalAdapterRegistry } from './canal-adapter.registry';
import { type InboxEvento, InboxEventsService } from './inbox-events.service';
import { NotificacoesService } from '@modules/notificacoes/notificacoes.service';
import type {
  AlterarStatusDto,
  AtribuirDto,
  ListConversationsDto,
  ListMensagensDto,
  ResponderDto,
} from './inbox.dto';
import type { MensagemEntranteParams } from './inbox.types';
import { type CtwaReferral, campanhaDoReferral } from '@integrations/evolution/ctwa-referral.util';

const conversationInclude = {
  cliente: { select: { id: true, nome: true, telefone: true, cidade: true } },
  atribuido: { select: { id: true, nome: true, avatar: true } },
} satisfies Prisma.ConversationInclude;

// #25 fatia 2 — na LISTAGEM também trazemos a direção da última mensagem pra
// derivar o SLA (aguardando resposta) sem coluna nova no banco.
const conversationListInclude = {
  ...conversationInclude,
  mensagens: { take: 1, orderBy: { criadoEm: 'desc' as const }, select: { direction: true } },
} satisfies Prisma.ConversationInclude;

type ConversationWithRel = Prisma.ConversationGetPayload<{
  include: typeof conversationInclude;
}>;

type ConversationListRow = Prisma.ConversationGetPayload<{
  include: typeof conversationListInclude;
}>;

/** Conversa da listagem + SLA derivado (sem o array auxiliar de mensagens). */
type ConversationComSla = Omit<ConversationListRow, 'mensagens'> & {
  /** Quando a última mensagem é do CLIENTE numa conversa aberta: desde quando espera resposta. Senão null. */
  aguardandoDesde: Date | null;
};

/**
 * Inbox unificada — canal-agnóstica.
 *
 * Responsabilidades:
 *  - Materializar `Conversation` + `Message` quando o adapter (WhatsApp, IG, ...)
 *    entrega uma mensagem entrante via `processarMensagemEntrante`
 *  - Listar/atribuir/resolver conversations respeitando multi-tenant e carteira do REP
 *  - Rotear envios (responder) pelo `CanalAdapterRegistry` correspondente
 *
 * Política de visibilidade:
 *  - ADMIN/DIRECTOR/GERENTE/SAC: tudo da empresa
 *  - REP: apenas conversations atribuídas a ele OU com cliente da própria carteira
 */
@Injectable()
export class InboxService {
  private readonly logger = new Logger(InboxService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: CanalAdapterRegistry,
    private readonly env: EnvService,
    private readonly eventos: InboxEventsService,
    private readonly notificacoes: NotificacoesService,
  ) {}

  /**
   * Publica um evento SSE de mudança no Inbox (push-to-invalidate). Best-effort, fire-and-forget —
   * nunca pode atrasar/derrubar o fluxo de mensagem. O front refetcha a query (já escopada) ao receber.
   */
  private emitirEvento(
    conv: {
      id: string;
      empresaId: string;
      proprietarioId: string | null;
      atribuidoId: string | null;
      canal: string;
    },
    tipo: InboxEvento['tipo'],
  ): void {
    void this.eventos.publicar({
      empresaId: conv.empresaId,
      conversationId: conv.id,
      tipo,
      proprietarioId: conv.proprietarioId,
      atribuidoId: conv.atribuidoId,
      canal: conv.canal,
    });
  }

  /**
   * Fase 2 — hook do bot Muller. O MullerWhatsappService se registra aqui no
   * boot; assim o Inbox não precisa importar o módulo do bot (evita acoplamento
   * circular). Chamado best-effort após cada mensagem INBOUND nova.
   */
  private botHook?: (
    params: MensagemEntranteParams,
    resultado: { conversationId: string; messageId: string; duplicada: boolean },
  ) => void;

  registrarBotHook(fn: NonNullable<InboxService['botHook']>): void {
    this.botHook = fn;
  }

  /**
   * Orquestração (Fase B) — hook de eventos de lead. Um serviço de orquestração
   * se registra aqui no boot pra reagir a mensagens entrantes (gatilho
   * "Lead respondeu", retomar o nó "Conversar com IA"). Best-effort, não-bloqueante.
   */
  private leadEventHook?: (
    params: MensagemEntranteParams,
    resultado: { conversationId: string; messageId: string; duplicada: boolean },
  ) => void;

  registrarLeadEventHook(fn: NonNullable<InboxService['leadEventHook']>): void {
    this.leadEventHook = fn;
  }

  // ─── Visibilidade / multi-tenant ─────────────────────────────────────

  private requireEmpresa(user: AuthenticatedUser): string {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    return user.empresaIdAtiva;
  }

  private baseWhere(user: AuthenticatedUser): Prisma.ConversationWhereInput {
    const empresaId = this.requireEmpresa(user);
    // REP: acessa SÓ conversas do próprio WhatsApp (sessão Baileys pessoal).
    // Qualquer pessoa que conversa com ele aparece — clientes da carteira,
    // prospects, fornecedores, etc. É o WhatsApp dele.
    // Marketplaces e redes sociais ficam com a equipe interna SAC.
    if (user.role === 'REP') {
      return {
        empresaId,
        canal: 'WHATSAPP',
        proprietarioId: user.id,
      };
    }
    return { empresaId };
  }

  /**
   * Contatos WhatsApp (distintos por telefone) pra dropdowns — ex: destinatário
   * "contato salvo" da ação Enviar WhatsApp nos fluxos. Mais recentes primeiro.
   */
  async listarContatosWhatsapp(
    user: AuthenticatedUser,
  ): Promise<Array<{ id: string; nome: string; tipo: 'CONTATO' | 'GRUPO' }>> {
    const convs = await this.prisma.conversation.findMany({
      where: { canal: 'WHATSAPP', ...this.baseWhere(user) },
      orderBy: { ultimaMsgEm: 'desc' },
      take: 300,
      select: {
        peerId: true,
        peerNome: true,
        metadata: true,
        cliente: { select: { nome: true, telefone: true } },
      },
    });
    const vistos = new Set<string>();
    const out: Array<{ id: string; nome: string; tipo: 'CONTATO' | 'GRUPO' }> = [];
    for (const c of convs) {
      // GRUPO (@g.us): o identificador é o próprio jid — o envio manda direto pra
      // ele (não tem telefone). Nome = subject do grupo (peerNome). Dedup por jid.
      if (c.peerId.includes('@g.us')) {
        if (vistos.has(c.peerId)) continue;
        vistos.add(c.peerId);
        out.push({ id: c.peerId, nome: c.peerNome ?? 'Grupo', tipo: 'GRUPO' });
        continue;
      }
      const meta = (c.metadata ?? {}) as Record<string, unknown>;
      // Telefone REAL: cliente > metadata.telefone > parte local do peerId.
      // LID (@lid) é opaco — não vira telefone. Aceita @s.whatsapp.net, @c.us, ou
      // dígitos crus; tira o ":device".
      const ehLid = c.peerId.includes('@lid');
      const telPeer = ehLid ? undefined : (c.peerId.split('@')[0]?.split(':')[0] ?? '');
      const bruto =
        c.cliente?.telefone ??
        (typeof meta.telefone === 'string' ? meta.telefone : undefined) ??
        telPeer;
      const tel = (bruto ?? '').replace(/\D/g, '');
      if (tel.length < 8 || tel.length > 15 || vistos.has(tel)) continue;
      vistos.add(tel);
      out.push({ id: tel, nome: c.cliente?.nome ?? c.peerNome ?? tel, tipo: 'CONTATO' });
    }
    return out;
  }

  // ─── Listagem / detalhes ─────────────────────────────────────────────

  async list(
    user: AuthenticatedUser,
    params: ListConversationsDto,
  ): Promise<Paginated<ConversationComSla>> {
    const where: Prisma.ConversationWhereInput = { ...this.baseWhere(user) };
    const conds: Prisma.ConversationWhereInput[] = [];

    if (params.canal) conds.push({ canal: params.canal });
    // Status: filtro explícito quando informado; senão, lista só as ATIVAS
    // (esconde RESOLVIDA/ARQUIVADA) — resolver uma conversa a tira da aba ativa.
    if (params.status) conds.push({ status: params.status });
    else conds.push({ status: { notIn: ['RESOLVIDA', 'ARQUIVADA'] } });
    if (params.clienteId) conds.push({ clienteId: params.clienteId });
    if (params.meu) conds.push({ atribuidoId: user.id });
    if (params.atribuidoId) conds.push({ atribuidoId: params.atribuidoId });
    if (params.naoAtribuidas) conds.push({ atribuidoId: null });
    if (params.precisaHumano) conds.push({ precisaHumano: true });
    if (params.naoLidas) conds.push({ naoLidas: { gt: 0 } });
    if (params.search) {
      conds.push({
        OR: [
          { peerNome: { contains: params.search, mode: 'insensitive' } },
          { peerId: { contains: params.search } },
          { ultimaMsgPreview: { contains: params.search, mode: 'insensitive' } },
          { cliente: { nome: { contains: params.search, mode: 'insensitive' } } },
        ],
      });
    }
    if (conds.length > 0) {
      where.AND = [...((where.AND as Prisma.ConversationWhereInput[]) ?? []), ...conds];
    }

    const [total, data] = await Promise.all([
      this.prisma.conversation.count({ where }),
      this.prisma.conversation.findMany({
        where,
        skip: (params.page - 1) * params.limit,
        take: params.limit,
        // Lista SEMPRE da mensagem mais nova pra mais antiga (ultimaMsgEm desc).
        // "Precisa de humano" deixou de subir pro topo — quem manda é a data,
        // senão a conversa recente fica perdida no meio.
        orderBy: [{ ultimaMsgEm: 'desc' }, { criadoEm: 'desc' }],
        include: conversationListInclude,
      }),
    ]);
    return buildPaginated(
      data.map((c) => this.comSla(c)),
      total,
      params.page,
      params.limit,
    );
  }

  /**
   * DESTRUTIVO — apaga TODAS as conversas de WhatsApp da empresa + suas
   * mensagens (do banco mesmo). Usado pra começar limpo na migração p/ Evolution.
   * Apaga mensagens primeiro (FK), depois as conversas.
   */
  async limparWhatsapp(user: AuthenticatedUser): Promise<{ conversas: number; mensagens: number }> {
    const empresaId = this.requireEmpresa(user);
    const convs = await this.prisma.conversation.findMany({
      where: { empresaId, canal: 'WHATSAPP' },
      select: { id: true },
    });
    const ids = convs.map((c) => c.id);
    if (ids.length === 0) return { conversas: 0, mensagens: 0 };
    const msgs = await this.prisma.message.deleteMany({
      where: { conversationId: { in: ids } },
    });
    const cs = await this.prisma.conversation.deleteMany({ where: { id: { in: ids } } });
    this.logger.warn(
      `[inbox] LIMPOU WhatsApp empresa=${empresaId}: ${cs.count} conversas + ${msgs.count} msgs (por ${user.email})`,
    );
    return { conversas: cs.count, mensagens: msgs.count };
  }

  /**
   * Zera UMA conversa POR COMPLETO: apaga as mensagens da thread (o bot monta
   * contexto pelo histórico → isso reseta a "memória" dele) e devolve a conversa
   * pro estado de "nunca atendida" — inclusive o que um atendimento anterior
   * (manual ou de fluxo, ex: TRANSFERIR_ATENDIMENTO) tenha deixado gravado:
   * responsável, status e categoria. MANTÉM a conversa e o contato — pra testar
   * o bot do zero sem trocar de número. Escopo por tenant/papel (mesma regra de
   * visibilidade da Inbox).
   */
  async limparConversa(user: AuthenticatedUser, id: string): Promise<{ mensagens: number }> {
    const conv = await this.prisma.conversation.findFirst({
      where: { id, ...this.baseWhere(user) },
      select: { id: true, empresaId: true, peerId: true, leadId: true },
    });
    if (!conv) throw new NotFoundException('Conversation', id);
    const msgs = await this.prisma.message.deleteMany({ where: { conversationId: id } });

    // "Zerar" tem que zerar A CONVERSA INTEIRA, incluindo o que o MOTOR guarda:
    // a execução do nó "Conversar com IA" fica AGUARDANDO com o histórico dela
    // em contexto._iaHistorico. Apagar só as Messages deixava a IA retomar do
    // ponto anterior no próximo "oi" — o reset parecia funcionar e não era real.
    const execsCanceladas = await this.cancelarExecucoesDaConversa(conv);
    await this.prisma.conversation.update({
      where: { id },
      data: {
        naoLidas: 0,
        precisaHumano: false,
        ultimaMsgPreview: null,
        ultimaMsgEm: null,
        // Devolve pro estado "nunca atendida" — sem isso um teste anterior (ex:
        // TRANSFERIR_ATENDIMENTO gravando atribuidoId+categoria) ficava colado
        // no reset, e "zerar" não zerava de fato.
        atribuidoId: null,
        status: 'ABERTA',
        categoria: 'GERAL',
        botPausadoAte: null,
        incidentId: null,
        // Tombstone: a partir de agora, reimportação de histórico anterior é ignorada
        // (senão o history sync do WhatsApp ressuscita tudo que acabamos de apagar).
        mensagensZeradasEm: new Date(),
      },
    });
    this.logger.warn(
      `[inbox] conversa ${id} ZERADA: ${msgs.count} msgs apagadas, ` +
        `${execsCanceladas} execução(ões) de fluxo cancelada(s) (por ${user.email})`,
    );
    // AUDITORIA (#11): zerar não emitia SSE. Quem estava com a thread aberta
    // (inclusive em OUTRA aba/máquina) continuava vendo as mensagens apagadas
    // até dar F5 — e podia responder em cima de uma conversa que não existe
    // mais. 'mensagem' recarrega a thread; 'status' recarrega o preview da lista.
    await this.emitirEventoIds([id], 'mensagem');
    await this.emitirEventoIds([id], 'status');
    return { mensagens: msgs.count };
  }

  /**
   * Cancela as execuções de fluxo vivas da conversa — por conversationId e
   * também pelo LEAD do contato (o nó de IA guarda o histórico no contexto da
   * execução; deixar viva faz a IA retomar de onde parou depois do reset).
   * Best-effort: falhar aqui não pode impedir o zeramento das mensagens.
   */
  private async cancelarExecucoesDaConversa(conv: {
    id: string;
    empresaId: string;
    peerId: string;
    leadId: string | null;
  }): Promise<number> {
    try {
      const filtros: Prisma.FluxoExecucaoWhereInput[] = [
        { contexto: { path: ['conversationId'], equals: conv.id } },
      ];
      // Lead do contato: o da conversa, ou resolvido por sufixo de telefone
      // (D18) — nunca `contains`.
      let leadId = conv.leadId;
      if (!leadId) {
        const digitos = conv.peerId.split('@')[0]?.replace(/\D/g, '') ?? '';
        if (digitos.length >= 8) {
          const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
            SELECT id FROM "Lead"
            WHERE "empresaId" = ${conv.empresaId}
              AND "contatoTelefone" IS NOT NULL
              AND RIGHT(REGEXP_REPLACE("contatoTelefone", '[^0-9]', '', 'g'), 8) = ${digitos.slice(-8)}
            ORDER BY "atualizadoEm" DESC LIMIT 1`;
          leadId = rows[0]?.id ?? null;
        }
      }
      if (leadId) filtros.push({ contexto: { path: ['leadId'], equals: leadId } });

      const { count } = await this.prisma.fluxoExecucao.updateMany({
        where: {
          empresaId: conv.empresaId,
          status: { in: ['PENDENTE', 'EM_EXECUCAO', 'AGUARDANDO'] },
          OR: filtros,
        },
        data: {
          status: 'CANCELADO',
          aguardandoNoId: null,
          timeoutEm: null,
          terminouEm: new Date(),
        },
      });
      return count;
    } catch (err) {
      this.logger.warn(
        `[inbox] falha ao cancelar execuções da conversa ${conv.id}: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      return 0;
    }
  }

  /**
   * Reage a uma mensagem com um emoji (👍 etc.). `emoji` vazio remove a reação.
   * Só WhatsApp (via Evolution). Guarda a reação na meta da msg pra a UI mostrar.
   */
  async reagirMensagem(
    user: AuthenticatedUser,
    messageId: string,
    emoji: string,
  ): Promise<{ ok: true; emoji: string }> {
    const msg = await this.prisma.message.findFirst({
      where: { id: messageId, conversation: { ...this.baseWhere(user) } },
      select: {
        id: true,
        externalId: true,
        direction: true,
        meta: true,
        conversation: {
          select: { empresaId: true, peerId: true, canal: true, proprietarioId: true },
        },
      },
    });
    if (!msg) throw new NotFoundException('Message', messageId);
    if (msg.conversation.canal !== 'WHATSAPP') {
      throw new BusinessRuleException('Reação disponível só no WhatsApp.');
    }
    if (!msg.externalId) {
      throw new BusinessRuleException(
        'Mensagem sem identificador do WhatsApp — não dá pra reagir.',
      );
    }
    const adapter = this.registry.obter('WHATSAPP');
    if (!adapter?.reagir) throw new BusinessRuleException('Canal não suporta reação.');
    const fromMe = msg.direction === MessageDirection.OUTBOUND;
    await adapter.reagir(
      msg.conversation.empresaId,
      msg.conversation.peerId,
      msg.externalId,
      fromMe,
      emoji,
      { proprietarioId: msg.conversation.proprietarioId },
    );
    // Guarda a reação na meta (emoji vazio = remove).
    const metaAtual = (msg.meta ?? {}) as Record<string, unknown>;
    const novaMeta: Record<string, unknown> = { ...metaAtual };
    if (emoji) novaMeta.reacao = emoji;
    else delete novaMeta.reacao;
    await this.prisma.message.update({
      where: { id: messageId },
      data: { meta: novaMeta as Prisma.InputJsonValue },
    });
    return { ok: true, emoji };
  }

  /**
   * #25 fatia 2 — deriva o SLA da conversa: se a ÚLTIMA mensagem é do cliente
   * (INBOUND) e a conversa está aberta/pendente, retorna desde quando espera
   * resposta (`ultimaMsgEm`). Caso contrário, null (nada pendente). O front
   * pinta o selo verde/amarelo/vermelho a partir disso.
   */
  private comSla(conv: ConversationListRow): ConversationComSla {
    const { mensagens, ...rest } = conv;
    const ultimaInbound = mensagens[0]?.direction === MessageDirection.INBOUND;
    const aberta = conv.status === 'ABERTA' || conv.status === 'PENDENTE';
    return { ...rest, aguardandoDesde: ultimaInbound && aberta ? conv.ultimaMsgEm : null };
  }

  async findById(user: AuthenticatedUser, id: string): Promise<ConversationWithRel> {
    const conv = await this.prisma.conversation.findFirst({
      where: { id, ...this.baseWhere(user) },
      include: conversationInclude,
    });
    if (!conv) throw new NotFoundException('Conversation', id);
    return conv;
  }

  /**
   * Retorna `mediaUrl` (storage path) de uma mensagem, validando acesso.
   * Usado por `GET /inbox/messages/:id/media` pra gerar signed URL.
   */
  async getMessageMediaPath(
    user: AuthenticatedUser,
    messageId: string,
  ): Promise<{ canal: string; storagePath: string; mime: string | null } | null> {
    const msg = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: {
        mediaUrl: true,
        mediaMime: true,
        conversation: {
          select: {
            id: true,
            canal: true,
            empresaId: true,
            proprietarioId: true,
          },
        },
      },
    });
    if (!msg || !msg.mediaUrl) return null;
    // Reaproveita findById pra validar visibilidade da conversation
    await this.findById(user, msg.conversation.id);
    return { canal: msg.conversation.canal, storagePath: msg.mediaUrl, mime: msg.mediaMime };
  }

  async listMensagens(
    user: AuthenticatedUser,
    conversationId: string,
    params: ListMensagensDto,
  ): Promise<Message[]> {
    await this.findById(user, conversationId); // garante visibilidade

    let cursorWhere: Prisma.MessageWhereInput = {};
    if (params.antesDe) {
      const anchor = await this.prisma.message.findUnique({
        where: { id: params.antesDe },
        select: { criadoEm: true },
      });
      if (anchor) cursorWhere = { criadoEm: { lt: anchor.criadoEm } };
    }
    return this.prisma.message.findMany({
      where: { conversationId, ...cursorWhere },
      orderBy: { criadoEm: 'desc' },
      take: params.limit,
    });
  }

  // ─── Ações ────────────────────────────────────────────────────────────

  async marcarComoLida(user: AuthenticatedUser, id: string): Promise<{ ok: true }> {
    await this.findById(user, id);
    await this.prisma.conversation.update({ where: { id }, data: { naoLidas: 0 } });
    await this.emitirEventoIds([id], 'status');
    return { ok: true };
  }

  async atribuir(
    user: AuthenticatedUser,
    id: string,
    dto: AtribuirDto,
  ): Promise<ConversationWithRel> {
    // findById valida visibilidade (REP só vê WhatsApp da carteira dele)
    const existing = await this.findById(user, id);
    // REP não pode reatribuir conversas — função gerencial
    if (user.role === 'REP') {
      throw new ForbiddenException(
        'Apenas gerência pode reatribuir conversas',
        ErrorCode.TENANT_ACCESS_DENIED,
      );
    }
    if (dto.atribuidoId) {
      // Tenant: o destinatário precisa pertencer à empresa da conversa (anti cross-tenant).
      const exists = await this.prisma.usuario.findFirst({
        where: { id: dto.atribuidoId, empresas: { some: { empresaId: existing.empresaId } } },
        select: { id: true },
      });
      if (!exists) throw new NotFoundException('Usuario', dto.atribuidoId);
    }
    await this.prisma.conversation.updateMany({
      where: { id, empresaId: existing.empresaId },
      data: { atribuidoId: dto.atribuidoId },
    });

    // Notifica o novo responsável (item do card de atendimento). Só quando MUDA
    // pra alguém — reatribuir pra mesma pessoa ou desatribuir (null) não notifica.
    // Não notifica quem se auto-atribui (já sabe). Best-effort.
    if (
      dto.atribuidoId &&
      dto.atribuidoId !== existing.atribuidoId &&
      dto.atribuidoId !== user.id
    ) {
      const quem = existing.peerNome?.trim() || existing.cliente?.nome || 'um contato';
      await this.notificacoes.criarParaUsuario({
        empresaId: existing.empresaId,
        usuarioId: dto.atribuidoId,
        tipo: 'MENSAGEM_INBOX',
        titulo: 'Conversa atribuída a você',
        mensagem: `${quem} foi atribuído a você no atendimento.`,
        link: `/inbox?conversa=${id}`,
        metadata: { conversationId: id },
      });
    }

    // #B12: o painel dos OUTROS atendentes precisa saber que essa conversa
    // trocou de dono — senão dois respondem o mesmo cliente.
    await this.emitirEventoIds([id], 'atribuicao');

    return this.prisma.conversation.findUniqueOrThrow({
      where: { id },
      include: conversationInclude,
    });
  }

  async alterarStatus(
    user: AuthenticatedUser,
    id: string,
    dto: AlterarStatusDto,
  ): Promise<ConversationWithRel> {
    const existing = await this.findById(user, id);
    await this.prisma.conversation.updateMany({
      where: { id, empresaId: existing.empresaId },
      data: { status: dto.status },
    });
    await this.emitirEventoIds([id], 'status');
    return this.prisma.conversation.findUniqueOrThrow({
      where: { id },
      include: conversationInclude,
    });
  }

  // ─── Bulk operations ─────────────────────────────────────────────────

  /**
   * Atribui N conversations a um único usuário (ou desatribui se atribuidoId=null).
   * REP bloqueado (gerencial, D38).
   *
   * Filtra pelo escopo do user — IDs que ele não pode ver não são atualizados.
   * Retorna o count real de updates aplicados (pode ser menor que ids.length).
   */
  /**
   * AUDITORIA #B12: só mensagem emitia SSE. Atribuir/mudar status/bulk mudavam o
   * estado da conversa e NINGUÉM era avisado — o outro atendente seguia vendo a
   * conversa como dele até dar refresh, e dois respondiam o mesmo cliente. Como
   * o updateMany não devolve as linhas, relemos o essencial pra montar o evento.
   */
  private async emitirEventoIds(ids: string[], tipo: InboxEvento['tipo']): Promise<void> {
    if (ids.length === 0) return;
    // Best-effort igual ao emitirEvento: avisar a UI NUNCA pode derrubar a
    // operação que já foi persistida.
    try {
      const convs = await this.prisma.conversation.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          empresaId: true,
          proprietarioId: true,
          atribuidoId: true,
          canal: true,
        },
      });
      for (const c of convs ?? []) this.emitirEvento(c, tipo);
    } catch (err) {
      this.logger.warn(
        `Falha ao emitir evento SSE de ${tipo}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async bulkAtribuir(
    user: AuthenticatedUser,
    ids: string[],
    atribuidoId: string | null,
  ): Promise<{ atualizados: number }> {
    if (user.role === 'REP') {
      throw new ForbiddenException(
        'Apenas gerência pode reatribuir conversas',
        ErrorCode.TENANT_ACCESS_DENIED,
      );
    }
    if (atribuidoId) {
      // Tenant: destinatário precisa pertencer à empresa do caller (anti cross-tenant).
      const exists = await this.prisma.usuario.findFirst({
        where: { id: atribuidoId, empresas: { some: { empresaId: this.requireEmpresa(user) } } },
        select: { id: true },
      });
      if (!exists) throw new NotFoundException('Usuario', atribuidoId);
    }
    const where: Prisma.ConversationWhereInput = { id: { in: ids }, ...this.baseWhere(user) };
    const r = await this.prisma.conversation.updateMany({
      where,
      data: { atribuidoId },
    });
    await this.emitirEventoIds(ids, 'atribuicao');
    return { atualizados: r.count };
  }

  async bulkAlterarStatus(
    user: AuthenticatedUser,
    ids: string[],
    status: ConversationStatus,
  ): Promise<{ atualizados: number }> {
    const where: Prisma.ConversationWhereInput = { id: { in: ids }, ...this.baseWhere(user) };
    const r = await this.prisma.conversation.updateMany({
      where,
      data: { status },
    });
    await this.emitirEventoIds(ids, 'status');
    return { atualizados: r.count };
  }

  /** Atalho semântico: bulkArquivar = bulkAlterarStatus(ARQUIVADA). */
  async bulkArquivar(user: AuthenticatedUser, ids: string[]): Promise<{ atualizados: number }> {
    return this.bulkAlterarStatus(user, ids, 'ARQUIVADA');
  }

  /** Atalho: marca todas mensagens das conversations como lidas. */
  async bulkMarcarLidas(user: AuthenticatedUser, ids: string[]): Promise<{ atualizados: number }> {
    // Permissão padrão de inbox — mesmo escopo de leitura
    const visibles = await this.prisma.conversation.findMany({
      where: { id: { in: ids }, ...this.baseWhere(user) },
      select: { id: true },
    });
    if (visibles.length === 0) return { atualizados: 0 };
    const r = await this.prisma.message.updateMany({
      where: {
        conversationId: { in: visibles.map((c) => c.id) },
        direction: MessageDirection.INBOUND,
        status: { in: [MessageStatus.RECEIVED, MessageStatus.DELIVERED, MessageStatus.SENT] },
      },
      data: { status: MessageStatus.READ },
    });
    await this.emitirEventoIds(
      visibles.map((c) => c.id),
      'status',
    );
    return { atualizados: r.count };
  }

  // ─── Resposta (OUTBOUND) ─────────────────────────────────────────────

  async responder(
    user: AuthenticatedUser,
    conversationId: string,
    dto: ResponderDto,
  ): Promise<Message> {
    const conv = await this.findById(user, conversationId);
    const adapter = this.registry.obter(conv.canal);
    if (!adapter) {
      throw new BusinessRuleException(`Canal ${conv.canal} não tem adapter registrado`);
    }
    const disponivel = await adapter.estaDisponivel(conv.empresaId, conv.proprietarioId);
    if (!disponivel) {
      throw new BusinessRuleException(
        `Canal ${conv.canal} não está pareado/conectado para esta sessão`,
      );
    }

    // Quote/citação: resolve o externalId (key.id do WhatsApp) da msg citada.
    let quoted: { externalId: string; fromMe: boolean; conteudo?: string } | undefined;
    if (dto.respondendoA) {
      const alvo = await this.prisma.message.findFirst({
        where: { id: dto.respondendoA, conversationId }, // mesma conversa = segurança
        select: { externalId: true, direction: true, conteudo: true },
      });
      if (alvo?.externalId) {
        quoted = {
          externalId: alvo.externalId,
          fromMe: alvo.direction === MessageDirection.OUTBOUND,
          conteudo: alvo.conteudo ?? undefined,
        };
      }
      // sem externalId (msg só local/pendente) → ignora o quote, envia normal
    }

    // Cria mensagem PENDING primeiro pra ter id local mesmo se o envio falhar
    const msg = await this.prisma.message.create({
      data: {
        conversationId,
        direction: MessageDirection.OUTBOUND,
        tipo: 'TEXT',
        conteudo: dto.texto,
        status: MessageStatus.PENDING,
        autorUsuarioId: user.id,
        // Referência da msg citada (id local) — a UI renderiza o trecho na bolha.
        ...(dto.respondendoA ? { meta: { respondendoA: dto.respondendoA } } : {}),
      },
    });
    this.emitirEvento(conv, 'mensagem');

    try {
      const r = await adapter.enviarTexto(conv.empresaId, conv.peerId, dto.texto, {
        proprietarioId: conv.proprietarioId,
        metadata: conv.metadata as Record<string, unknown> | null,
        quoted: quoted ?? null,
      });
      const atualizada = await this.prisma.message.update({
        where: { id: msg.id },
        data: { status: MessageStatus.SENT, externalId: r.externalId ?? null },
      });
      // Atualiza preview da conversa + zera naoLidas (responder = leu).
      // Fase 2 — HANDOFF: humano respondeu → limpa o "precisa humano" (alguém
      // assumiu) e PAUSA o bot — MAS só pausa se o bot está de fato ATIVO nesta
      // conversa. Pausar um bot desligado gerava o selo "Bot pausado"/"Religar bot"
      // enganoso (o bot é off por padrão; o usuário liga só pra alguns contatos).
      const handoff = await this.fragmentoHandoffHumano(conv);
      await this.prisma.conversation.update({
        where: { id: conversationId },
        data: {
          ultimaMsgEm: atualizada.criadoEm,
          ultimaMsgPreview: this.preview(dto.texto),
          status: conv.status === 'PENDENTE' ? 'ABERTA' : conv.status,
          naoLidas: 0,
          ...handoff,
        },
      });
      return atualizada;
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Falha enviando msg ${msg.id} em ${conv.canal}: ${m}`);
      await this.prisma.message.update({
        where: { id: msg.id },
        // Merge: preserva o respondendoA (citação) já gravado no create.
        data: {
          status: MessageStatus.FAILED,
          meta: { ...(dto.respondendoA ? { respondendoA: dto.respondendoA } : {}), erro: m },
        },
      });
      throw new BusinessRuleException(`Falha ao enviar pelo canal ${conv.canal}: ${m}`);
    }
  }

  // ─── Fase 2 — Bot ────────────────────────────────────────────────────

  /**
   * Envia uma resposta gerada pelo BOT (não-humano). Sem AuthenticatedUser:
   * autorUsuarioId fica null, enviadaPorBot=true, e NÃO ativa handoff (o bot
   * respondendo não deve pausar a si mesmo). Best-effort do ponto de vista do
   * chamador — lança em falha pro motor do bot logar.
   */
  async responderComoBot(
    conversationId: string,
    texto: string,
    idempotencyKey?: string,
  ): Promise<void> {
    const conv = await this.prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conv) return;
    const adapter = this.registry.obter(conv.canal);
    if (!adapter) throw new BusinessRuleException(`Canal ${conv.canal} sem adapter`);

    const msg = await this.prisma.message.create({
      data: {
        conversationId,
        direction: MessageDirection.OUTBOUND,
        tipo: 'TEXT',
        conteudo: texto,
        status: MessageStatus.PENDING,
        enviadaPorBot: true,
      },
    });
    this.emitirEvento(conv, 'mensagem');
    try {
      // idempotencyKey por balão (quando fornecida): o gate do provider deduplica se o mesmo
      // inbound for reprocessado após o TTL do lock — alinha com o nó "Conversar com IA".
      const r = await adapter.enviarTexto(conv.empresaId, conv.peerId, texto, {
        proprietarioId: conv.proprietarioId,
        metadata: conv.metadata as Record<string, unknown> | null,
        ...(idempotencyKey ? { idempotencyKey } : {}),
      });
      await this.prisma.message.update({
        where: { id: msg.id },
        data: { status: MessageStatus.SENT, externalId: r.externalId ?? null },
      });
      await this.prisma.conversation.update({
        where: { id: conversationId },
        data: { ultimaMsgEm: new Date(), ultimaMsgPreview: this.preview(texto) },
      });
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      await this.prisma.message.update({
        where: { id: msg.id },
        data: { status: MessageStatus.FAILED, meta: { erro: m } },
      });
      throw err instanceof Error ? err : new Error(m);
    }
  }

  /** Marca a conversa como "precisa de humano" (usado pelo motor no fallback). */
  async marcarPrecisaHumano(conversationId: string): Promise<void> {
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { precisaHumano: true },
    });
  }

  /** Pausa manual do bot nesta conversa (pelo BOT_HANDOFF_HORAS). */
  async pausarBot(user: AuthenticatedUser, id: string): Promise<ConversationWithRel> {
    const existing = await this.findById(user, id);
    const handoffMs = this.env.get('BOT_HANDOFF_HORAS') * 60 * 60 * 1000;
    await this.prisma.conversation.updateMany({
      where: { id, empresaId: existing.empresaId },
      data: { botPausadoAte: new Date(Date.now() + handoffMs) },
    });
    return this.prisma.conversation.findUniqueOrThrow({
      where: { id },
      include: conversationInclude,
    });
  }

  /** Religa o bot nesta conversa (cancela a pausa e limpa "precisa humano"). */
  async religarBot(user: AuthenticatedUser, id: string): Promise<ConversationWithRel> {
    const existing = await this.findById(user, id);
    await this.prisma.conversation.updateMany({
      where: { id, empresaId: existing.empresaId },
      data: { botPausadoAte: null, precisaHumano: false },
    });
    await this.limparTriadoAoReligar(existing.empresaId, existing.leadId, user);
    return this.prisma.conversation.findUniqueOrThrow({
      where: { id },
      include: conversationInclude,
    });
  }

  /**
   * Religar o bot LIMPA a tag `triado` do lead da conversa (regra do Léo, 11/08).
   *
   * Por quê: o ramo Financeiro/Suporte da triagem termina marcando `triado`, e
   * essa tag é a guarda do 1º nó — quem a tem não é re-triado. Um cliente que
   * pediu 2ª via e, meses depois, volta querendo COMPRAR morria no primeiro nó,
   * sem virar lead comercial e sem ninguém perceber.
   *
   * Por que AQUI e não tirando a tag do fluxo: sem a tag, o fluxo dispararia,
   * passaria as guardas e morreria no CONVERSAR_IA com o bot desligado (o
   * PAUSAR_IA do transfer). Trocaria lead perdido em silêncio por fluxo travado
   * em silêncio. Religar significa "o robô assume de novo" — daí o próximo
   * contato ser contato novo, que merece triagem nova. E não depende de ninguém
   * lembrar de destaguear.
   *
   * NÃO mexe nas tags de triagem (`Indefinido (triagem)`, `Sem resposta …`):
   * elas têm rota de retomada própria dentro do fluxo.
   */
  private async limparTriadoAoReligar(
    empresaId: string,
    leadId: string | null | undefined,
    user: AuthenticatedUser,
  ): Promise<void> {
    if (!leadId) return; // conversa sem lead vinculado: nada a fazer, sem erro
    try {
      const tag = await this.prisma.tag.findUnique({
        where: { empresaId_nome: { empresaId, nome: 'triado' } },
        select: { id: true },
      });
      if (!tag) return;
      const { count } = await this.prisma.leadTag.deleteMany({ where: { leadId, tagId: tag.id } });
      if (count > 0) {
        this.logger.log(
          `Bot religado por ${user.nome} (${user.id}) — tag "triado" removida do lead ${leadId}, ` +
            'o próximo contato volta a ser triado do zero',
        );
      }
    } catch (err) {
      // Best-effort: religar o bot é a operação principal e não pode falhar por
      // causa da limpeza da tag.
      this.logger.warn(
        `Falha ao limpar a tag "triado" do lead ${leadId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Override do bot NESTA conversa, independente do liga/desliga global:
   * `true` = ligado aqui (mesmo com global off — limpa pausa/precisa-humano);
   * `false` = desligado aqui (mesmo com global on); `null` = segue o global.
   */
  async setBotLigado(
    user: AuthenticatedUser,
    id: string,
    ligado: boolean | null,
  ): Promise<ConversationWithRel> {
    const existing = await this.findById(user, id);
    await this.prisma.conversation.updateMany({
      where: { id, empresaId: existing.empresaId },
      data:
        ligado === true
          ? { botLigado: true, botPausadoAte: null, precisaHumano: false }
          : { botLigado: ligado },
    });
    // Mesma regra do religarBot: LIGAR o bot nesta conversa devolve o controle
    // ao robô, então o próximo contato merece triagem nova. Só no `true` —
    // desligar ou voltar pro global não é "encerrei o atendimento".
    if (ligado === true) {
      await this.limparTriadoAoReligar(existing.empresaId, existing.leadId, user);
    }
    return this.prisma.conversation.findUniqueOrThrow({
      where: { id },
      include: conversationInclude,
    });
  }

  /**
   * Envia mídia OUTBOUND. Hoje suporta canal WHATSAPP — outros canais
   * lançam BusinessRule até ganharem implementação.
   *
   * Fluxo:
   *  1. Valida visibilidade da conversation
   *  2. Cria Message com tipo correspondente em PENDING
   *  3. Chama WhatsAppService.enviarMidia diretamente (não passa pelo
   *     CanalAdapterRegistry porque adapters atuais só implementam enviarTexto)
   *  4. Atualiza status pra SENT + externalId
   *
   * Forçamos canal=WHATSAPP no MVP. Quando outros adapters ganharem
   * `enviarMidia`, generaliza.
   */
  /**
   * Fragmento de HANDOFF pro update da conversa: humano respondeu → limpa o
   * "precisa humano" e PAUSA o bot. Só pausa se o bot está de fato ativo nesta
   * conversa (pausar bot desligado gerava o selo "Bot pausado" enganoso).
   * Compartilhado por `responder` e `responderComMidia` — a versão com mídia não
   * fazia nada disso, então o bot respondia POR CIMA do atendente que acabou de
   * mandar um arquivo.
   */
  private async fragmentoHandoffHumano(conv: {
    empresaId: string;
    botLigado: boolean | null;
  }): Promise<{ precisaHumano: boolean; botPausadoAte?: Date }> {
    const empresaBot = await this.prisma.empresa.findUnique({
      where: { id: conv.empresaId },
      select: { botWhatsappAtivo: true },
    });
    const botAtivoNaConversa =
      conv.botLigado === true || (conv.botLigado == null && empresaBot?.botWhatsappAtivo === true);
    const handoffMs = this.env.get('BOT_HANDOFF_HORAS') * 60 * 60 * 1000;
    return {
      precisaHumano: false,
      ...(botAtivoNaConversa ? { botPausadoAte: new Date(Date.now() + handoffMs) } : {}),
    };
  }

  async responderComMidia(
    user: AuthenticatedUser,
    conversationId: string,
    params: {
      tipo: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'DOCUMENT';
      caption?: string;
      fileName?: string;
      mimetype?: string;
      ptt?: boolean;
      storagePath?: string;
      url?: string;
      /** Base64 puro (sem prefixo data:...) — convertido pra Buffer aqui. */
      dataBase64?: string;
    },
    whatsapp: {
      enviarMidia: (
        empresaId: string,
        peerId: string,
        p: Parameters<InboxService['responderComMidia']>[2] & { buffer?: Buffer },
        ctx?: { proprietarioId?: string | null },
      ) => Promise<{ externalId?: string }>;
    },
    whatsappMedia?: {
      uploadOutbound: (
        empresaId: string,
        peerId: string,
        buffer: Buffer,
        mimetype: string | undefined,
        msgIdOpt?: string,
      ) => Promise<string | null>;
    },
  ): Promise<Message> {
    const conv = await this.findById(user, conversationId);
    if (conv.canal !== 'WHATSAPP') {
      throw new BusinessRuleException(
        `Envio de mídia ainda não suportado no canal ${conv.canal}. Por enquanto, só WhatsApp.`,
      );
    }

    const tipoMessage = params.tipo;
    const conteudoPlaceholder =
      params.caption ??
      (params.tipo === 'DOCUMENT' && params.fileName
        ? params.fileName
        : { IMAGE: '[imagem]', VIDEO: '[vídeo]', AUDIO: '[áudio]', DOCUMENT: '[documento]' }[
            params.tipo
          ]);

    // Converte base64 pra Buffer (será reusado pra upload + envio Baileys)
    const buffer = params.dataBase64 ? Buffer.from(params.dataBase64, 'base64') : undefined;

    // Upload do buffer pro Storage ANTES de criar a Message, pra ela já
    // ter mediaUrl preenchido e a UI conseguir renderizar a imagem/áudio.
    // Sem isso, mensagens OUTBOUND apareciam só como "[imagem]" sem preview.
    let storagePath: string | null = params.storagePath ?? null;
    if (!storagePath && buffer && whatsappMedia) {
      storagePath = await whatsappMedia.uploadOutbound(
        conv.empresaId,
        conv.peerId,
        buffer,
        params.mimetype,
      );
    }

    const msg = await this.prisma.message.create({
      data: {
        conversationId,
        direction: MessageDirection.OUTBOUND,
        tipo: tipoMessage,
        conteudo: conteudoPlaceholder,
        status: MessageStatus.PENDING,
        autorUsuarioId: user.id,
        mediaUrl: storagePath ?? params.url ?? null,
        mediaMime: params.mimetype ?? null,
      },
    });
    this.emitirEvento(conv, 'mensagem');

    try {
      const r = await whatsapp.enviarMidia(
        conv.empresaId,
        conv.peerId,
        { ...params, buffer },
        { proprietarioId: conv.proprietarioId },
      );
      const atualizada = await this.prisma.message.update({
        where: { id: msg.id },
        data: { status: MessageStatus.SENT, externalId: r.externalId ?? null },
      });
      // Mesmo handoff do `responder`: mandar um arquivo TAMBÉM é o humano
      // assumindo a conversa.
      const handoff = await this.fragmentoHandoffHumano(conv);
      await this.prisma.conversation.update({
        where: { id: conversationId },
        data: {
          ultimaMsgEm: atualizada.criadoEm,
          ultimaMsgPreview: this.preview(conteudoPlaceholder),
          status: conv.status === 'PENDENTE' ? 'ABERTA' : conv.status,
          naoLidas: 0,
          ...handoff,
        },
      });
      return atualizada;
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Falha enviando mídia ${msg.id}: ${m}`);
      await this.prisma.message.update({
        where: { id: msg.id },
        data: { status: MessageStatus.FAILED, meta: { erro: m } },
      });
      throw new BusinessRuleException(`Falha ao enviar mídia: ${m}`);
    }
  }

  // ─── Entrante (chamado pelos adapters) ───────────────────────────────

  async processarMensagemEntrante(
    params: MensagemEntranteParams,
  ): Promise<{ conversationId: string; messageId: string; duplicada: boolean }> {
    // Idempotência: se já temos mensagem com mesmo externalId nessa conversa
    // (mesmo proprietário/sessão), retornar. Diferentes proprietários podem ter
    // o mesmo peer com IDs diferentes — então o escopo da idempotência inclui
    // proprietarioId.
    if (params.externalId) {
      const existente = await this.prisma.message.findFirst({
        where: {
          externalId: params.externalId,
          conversation: {
            empresaId: params.empresaId,
            canal: params.canal,
            // NÃO escopar por peerId: o externalId (key.id do WhatsApp) já é único
            // por mensagem. No Evolution o LID faz o remoteJid chegar ora como
            // telefone, ora como `<id>@lid` (sem remoteJidAlt) → o peerId varia pra
            // a MESMA mensagem e a dedup falhava → webhook + poll re-disparavam o
            // bot (loop). Manter só proprietarioId pro escopo dual-owner.
            proprietarioId: params.proprietarioId ?? null,
          },
        },
        select: { id: true, conversationId: true, conteudo: true },
      });
      if (existente) {
        // Heal-on-reprocess: mensagens salvas como placeholder "[mensagem não
        // suportada...]" ANTES de o parser saber lê-las. No reconnect o WhatsApp
        // reentrega a mensagem CRUA (history sync) e agora o parser extrai o
        // conteúdo real (ou ao menos o tipo) — então ATUALIZAMOS em vez de pular.
        // Só mexe em placeholders: nunca sobrescreve conteúdo real já salvo.
        const PLACEHOLDER = '[mensagem não suportada';
        if (
          existente.conteudo.startsWith(PLACEHOLDER) &&
          params.conteudo.trim().length > 0 &&
          params.conteudo !== existente.conteudo
        ) {
          await this.prisma.message.update({
            where: { id: existente.id },
            data: {
              conteudo: params.conteudo,
              tipo: params.tipo,
              ...(params.mediaMime ? { mediaMime: params.mediaMime } : {}),
              ...(params.mediaUrl ? { mediaUrl: params.mediaUrl } : {}),
            },
          });
          this.logger.log(
            `[${params.canal}] msg ${existente.id} curada (placeholder → conteúdo reprocessado)`,
          );
        }
        return {
          conversationId: existente.conversationId,
          messageId: existente.id,
          duplicada: true,
        };
      }
    }

    const clienteId = await this.resolverCliente(
      params.empresaId,
      params.peerTelefone,
      params.peerEmail,
    );

    const conv = await this.upsertConversation(params, clienteId);

    // Tombstone "Zerar conversa": se a conversa foi zerada e ESTA mensagem é uma
    // reimportação de histórico anterior ao zeramento (timestamp <= zeradasEm),
    // NÃO recria — senão o history sync do WhatsApp ressuscita o que foi apagado.
    // Mensagens genuinamente novas têm timestamp > zeradasEm e passam normalmente.
    // Janela conhecida e ACEITA: timestamp do WhatsApp tem granularidade de
    // segundo (relógio do remetente) — mensagem legítima no MESMO segundo do
    // zerar (ou com skew) é descartada. Trade-off consciente: janela ínfima vs
    // ressuscitar o histórico inteiro; não vale complexidade extra.
    if (conv.mensagensZeradasEm && params.data && params.data <= conv.mensagensZeradasEm) {
      return { conversationId: conv.id, messageId: '', duplicada: true };
    }

    // Direction: default INBOUND. OUTBOUND quando o próprio número enviou
    // a mensagem (ex: dono respondeu pelo celular enquanto Baileys está
    // pareado — Baileys emite messages.upsert com fromMe=true).
    const direction =
      params.direction === 'OUTBOUND' ? MessageDirection.OUTBOUND : MessageDirection.INBOUND;
    const isInbound = direction === MessageDirection.INBOUND;

    // Anti-duplicata do ECHO outbound: o bot/operador cria a Message OUTBOUND e só grava o
    // externalId APÓS o POST ao provider. Se o eco (fromMe) chega nessa janela, a dedup por
    // externalId acima não acha a linha em-voo (externalId ainda null) → criaria um 2º balão.
    // Aqui adotamos o externalId do eco na linha já existente em vez de duplicar.
    if (!isInbound && params.externalId) {
      // AUDITORIA (média): a busca era escopada em `conversationId: conv.id`. O eco
      // @lid do WhatsApp pode resolver pra OUTRA conversa quando chega sem
      // `remoteJidAlt` e a conversa ainda não tem `metadata.lid` gravado — a
      // linha em-voo está na conversa do telefone, e o eco procura na conversa
      // do LID. Não achava, criava um 2º balão e nascia conversa fantasma.
      // Agora procura na EMPRESA (mesma janela de 2min + mesmo conteúdo +
      // externalId nulo já são um filtro estreitíssimo) e usa a conversa da
      // linha encontrada, não a resolvida pelo peer.
      const emVoo = await this.prisma.message.findFirst({
        where: {
          // ⚠️ REVISÃO (11/08): a 1ª tentativa deste fix abriu o escopo pra
          // `empresaId` puro — largo DEMAIS. Numa campanha ou em resposta
          // padronizada ("Bom dia!"), o eco do contato A adotava a linha em-voo
          // do contato B: mensagem atribuída à CONVERSA ERRADA e a certa
          // marcada como duplicada. Trocar um balão duplicado por mensagem no
          // chat de outra pessoa é pior que o bug original.
          // Escopo correto: mesma empresa + mesmo CANAL + mesmo dono da sessão
          // (dual-owner D38). Isso cobre o caso do @lid (peerId diferente,
          // mesma sessão) sem cruzar contatos de sessões/canais distintos.
          conversation: {
            empresaId: conv.empresaId,
            canal: conv.canal,
            proprietarioId: conv.proprietarioId,
          },
          direction: MessageDirection.OUTBOUND,
          externalId: null,
          conteudo: params.conteudo,
          criadoEm: { gte: new Date(Date.now() - 2 * 60 * 1000) },
        },
        orderBy: { criadoEm: 'desc' },
        select: { id: true, conversationId: true },
      });
      if (emVoo) {
        // Se a escrita do envio gravar o externalId primeiro (unique), o update aqui falha →
        // ignora (a linha em-voo já ficou consistente). Em ambos os casos, sem balão duplicado.
        await this.prisma.message
          .update({ where: { id: emVoo.id }, data: { externalId: params.externalId } })
          .catch(() => undefined);
        return { conversationId: emVoo.conversationId, messageId: emVoo.id, duplicada: true };
      }
    }

    // Mescla senderName na meta pra renderizar autor da msg em grupos.
    const metaFinal: Record<string, unknown> = {
      ...(params.meta ?? {}),
      ...(params.senderName ? { senderName: params.senderName } : {}),
    };
    let msg: { id: string; criadoEm: Date };
    try {
      msg = await this.prisma.message.create({
        data: {
          conversationId: conv.id,
          direction,
          tipo: params.tipo,
          conteudo: params.conteudo,
          externalId: params.externalId ?? null,
          status: isInbound ? MessageStatus.RECEIVED : MessageStatus.SENT,
          mediaUrl: params.mediaUrl ?? null,
          mediaMime: params.mediaMime ?? null,
          meta:
            Object.keys(metaFinal).length > 0 ? (metaFinal as Prisma.InputJsonValue) : undefined,
          criadoEm: params.data ?? new Date(),
        },
        select: { id: true, criadoEm: true },
      });
    } catch (err) {
      // Corrida webhook+poll do mesmo provider: outra entrega gravou a MESMA mensagem
      // (P2002 no @@unique([conversationId, externalId])). A entrega vencedora cuida dos
      // efeitos (não-lidas, bot, lead-event); aqui devolvemos a existente como duplicada
      // sem re-incrementar nem re-disparar os hooks — em vez de propagar o erro e pular tudo.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002' &&
        params.externalId
      ) {
        const existente = await this.prisma.message.findFirst({
          where: { conversationId: conv.id, externalId: params.externalId },
          select: { id: true },
        });
        if (existente) {
          return { conversationId: conv.id, messageId: existente.id, duplicada: true };
        }
      }
      throw err;
    }

    // INBOUND: incrementa não-lidas e marca conversa como PENDENTE.
    // OUTBOUND: zera naoLidas — o dono mandou mensagem (pelo celular ou outro
    // dispositivo) = leu o que tinha pra responder. Sinaliza confiável de
    // leitura mesmo quando o evento chats.update do Baileys não chega.
    await this.prisma.conversation.update({
      where: { id: conv.id },
      data: {
        ultimaMsgEm: msg.criadoEm,
        ultimaMsgPreview: this.preview(params.conteudo),
        ...(isInbound
          ? { naoLidas: { increment: 1 }, status: 'PENDENTE' as const }
          : { naoLidas: 0 }),
      },
    });

    this.logger.log(
      `[${params.canal}] msg entrante ${msg.id} conv=${conv.id} peer=${params.peerId}`,
    );

    // Push SSE: mensagem nova → o front refetcha a lista + a thread (sem esperar o poll de 2s).
    this.emitirEvento(conv, 'mensagem');

    const resultado = { conversationId: conv.id, messageId: msg.id, duplicada: false };

    // Fase 2 — dispara o bot Muller (best-effort, não bloqueia o recebimento).
    // O hook decide internamente se responde (só WhatsApp da empresa, etc.).
    if (this.botHook && isInbound) {
      try {
        this.botHook(params, resultado);
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Falha ao disparar bot hook conv=${conv.id}: ${m}`);
      }
    }

    // Orquestração (Fase B) — eventos de lead (gatilho "Lead respondeu", retomada IA).
    if (this.leadEventHook && isInbound) {
      try {
        this.leadEventHook(params, resultado);
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Falha no leadEventHook conv=${conv.id}: ${m}`);
      }
    }

    return resultado;
  }

  /** Resolve Cliente por telefone (normalizado) ou e-mail. Retorna null se não bater. */
  private async resolverCliente(
    empresaId: string,
    telefone: string | undefined,
    email: string | undefined,
  ): Promise<string | null> {
    if (telefone) {
      const tel = this.normalizarTelefone(telefone);
      if (tel) {
        // Match por sufixo de 8 dígitos (D18). Normaliza o telefone ARMAZENADO
        // (que vem formatado do OMIE, ex.: "(11) 98765-4321") tirando tudo que não
        // é dígito e comparando os 8 finais por IGUALDADE — robusto a formatação e
        // usa o índice de expressão `Cliente_empresaId_telefoneSufixo_idx`. (O
        // antigo `LIKE '%sufixo%'` fazia seq scan e quebrava quando o número
        // formatado tinha hífen no meio do sufixo.)
        const sufixo = tel.slice(-8);
        const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "Cliente"
          WHERE "empresaId" = ${empresaId}
            AND RIGHT(REGEXP_REPLACE("telefone", '[^0-9]', '', 'g'), 8) = ${sufixo}
          LIMIT 1
        `;
        if (rows[0]) return rows[0].id;
      }
    }
    if (email) {
      const c = await this.prisma.cliente.findFirst({
        where: { empresaId, email: { equals: email, mode: 'insensitive' } },
        select: { id: true },
      });
      if (c) return c.id;
    }
    return null;
  }

  /**
   * Upsert manual (findFirst + create/update) porque a chave inclui
   * `proprietarioId` que é nullable. Postgres trata NULLs como distintos em
   * unique indexes, então `upsert` direto não funciona consistente — fazemos
   * o lookup explícito.
   */
  private async upsertConversation(
    p: MensagemEntranteParams,
    clienteId: string | null,
  ): Promise<Conversation> {
    const propId = p.proprietarioId ?? null;

    // Campos canal-específicos que guardamos na metadata (JSON, sem coluna própria):
    //  - telefone: telefone REAL do contato (útil quando o peerId é um LID/número
    //    oculto do WhatsApp — aí o número de verdade vem em peerTelefone)
    const metaPatch: Record<string, unknown> = {};
    if (p.peerTelefone) metaPatch.telefone = p.peerTelefone;

    // Chaves que os adapters de ENVIO leem do Conversation.metadata (ML pack /
    // Shopee conv). Vêm em params.meta mas até aqui só iam pra Message.meta —
    // resultado: responder chat pós-venda ML/Shopee pela Inbox falhava sempre.
    const CHAVES_ADAPTER = ['ml_seller_id', 'ml_buyer_id', 'shopee_from_id'] as const;
    for (const k of CHAVES_ADAPTER) {
      if (p.meta?.[k] !== undefined && p.meta[k] !== null) metaPatch[k] = p.meta[k];
    }

    // CATEGORIA: os adapters de marketplace já informam (POS_VENDA etc.) dentro
    // do `meta`, mas ela nunca era gravada na Conversation — TODA conversa de
    // marketplace ficava GERAL, e o Composer não sabia bloquear os canais que não
    // aceitam texto livre. Promove no create e no update (só PROMOVE: nunca
    // rebaixa uma categoria mais específica de volta pra GERAL).
    const CATEGORIAS_VALIDAS = [
      'GERAL',
      'PRE_VENDA',
      'POS_VENDA',
      'RECLAMACAO',
      'MEDIACAO',
      'DEVOLUCAO',
      'DISPUTA',
    ];
    const categoriaMeta =
      typeof p.meta?.categoria === 'string' && CATEGORIAS_VALIDAS.includes(p.meta.categoria)
        ? (p.meta.categoria as ConversationCategoria)
        : undefined;

    // ── Atribuição de anúncio (Click-to-WhatsApp) ──────────────────────────
    // O referral vem SÓ na 1ª mensagem da conversa. Guardamos o bloco cru em
    // metadata.atribuicao + a campanha na COLUNA utmCampaign (indexada). Regra
    // 1ª-VEZ-VENCE: uma conversa que já tem atribuição NUNCA é sobrescrita —
    // mesma semântica do 1º toque da UTM do site. É o dado que o Lead vai HERDAR
    // quando nascer na triagem; perder aqui = perder a campanha que trouxe.
    const referral = p.meta?.ctwaReferral as Record<string, unknown> | undefined;
    const campanha = referral ? campanhaDoReferral(referral as CtwaReferral) : undefined;

    // Guarda o LID do contato (quando o adapter informa) pra casar a mensagem
    // que vier SÓ com o LID lá embaixo.
    if (typeof p.meta?.lid === 'string') metaPatch.lid = p.meta.lid;

    // Lookup primeiro
    let existente = await this.prisma.conversation.findFirst({
      where: {
        empresaId: p.empresaId,
        canal: p.canal,
        peerId: p.peerId,
        proprietarioId: propId,
      },
    });
    // Fallback do LID: o WhatsApp entrega `<id>@lid` ora COM o telefone real
    // (remoteJidAlt), ora SEM. Sem este segundo lookup, a variante sem telefone
    // criava uma conversa PARALELA do mesmo contato — sem cliente vinculado,
    // sem histórico, e a triagem gerava um lead fantasma sem telefone.
    if (!existente && p.peerId.endsWith('@lid')) {
      existente = await this.prisma.conversation.findFirst({
        where: {
          empresaId: p.empresaId,
          canal: p.canal,
          proprietarioId: propId,
          metadata: { path: ['lid'], equals: p.peerId },
        },
      });
    }
    if (existente) {
      // Mescla avatarUrl/telefone na metadata existente quando o adapter informa.
      const metaAtual = (existente.metadata as Record<string, unknown> | null) ?? {};
      // 1ª-VEZ-VENCE: só grava a atribuição se a conversa ainda não tiver nenhuma.
      const jaTemAtribuicao = !!existente.utmCampaign || !!metaAtual.atribuicao;
      const gravarAtrib = !!referral && !jaTemAtribuicao;
      if (gravarAtrib) metaPatch.atribuicao = referral;

      const nextMetadata =
        Object.keys(metaPatch).length > 0 ? { ...metaAtual, ...metaPatch } : undefined;
      return this.prisma.conversation.update({
        where: { id: existente.id },
        data: {
          peerNome: p.peerNome ?? undefined,
          clienteId: clienteId ?? undefined,
          // Só promove de GERAL — não rebaixa classificação já feita.
          ...(categoriaMeta && existente.categoria === 'GERAL' ? { categoria: categoriaMeta } : {}),
          ...(gravarAtrib && campanha ? { utmCampaign: campanha } : {}),
          ...(nextMetadata ? { metadata: nextMetadata as Prisma.InputJsonValue } : {}),
        },
      });
    }

    // Race protection (Auditoria 2026-05-17, M2): duas mensagens simultâneas do
    // mesmo peer poderiam fazer find+create em paralelo e criar 2 conversations.
    // Postgres não permite `@@unique` direto pq `proprietarioId` é nullable
    // (NULLs distintos). Mitigação: tenta create e captura P2002; se cair em
    // duplicate (vencido pelo outro racer), refaz o lookup.
    try {
      return await this.prisma.conversation.create({
        data: {
          empresaId: p.empresaId,
          canal: p.canal,
          peerId: p.peerId,
          peerNome: p.peerNome ?? null,
          proprietarioId: propId,
          clienteId,
          status: 'PENDENTE',
          naoLidas: 0,
          ...(categoriaMeta ? { categoria: categoriaMeta } : {}),
          // Conversa NOVA: se veio de anúncio, nasce já com a atribuição.
          ...(campanha ? { utmCampaign: campanha } : {}),
          ...(() => {
            const meta = referral ? { ...metaPatch, atribuicao: referral } : metaPatch;
            return Object.keys(meta).length > 0 ? { metadata: meta as Prisma.InputJsonValue } : {};
          })(),
        },
      });
    } catch (err) {
      // Prisma error P2002 = unique constraint violation. Caso o cliente tenha
      // adicionado `@@unique` parcial via migration manual no Postgres
      // (recomendado quando volume crescer), o create vai falhar — neste caso
      // o racer já criou; basta buscar de novo.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const reload = await this.prisma.conversation.findFirst({
          where: {
            empresaId: p.empresaId,
            canal: p.canal,
            peerId: p.peerId,
            proprietarioId: propId,
          },
        });
        if (reload) return reload;
      }
      throw err;
    }
  }

  /** Remove caracteres não-numéricos. Retorna null se sobrar < 8 dígitos. */
  private normalizarTelefone(t: string): string | null {
    const digits = t.replace(/\D/g, '');
    return digits.length >= 8 ? digits : null;
  }

  private preview(s: string): string {
    const single = s.replace(/\s+/g, ' ').trim();
    return single.length > 140 ? `${single.slice(0, 137)}...` : single;
  }

  /** Helper público: lista canais com adapter ativo. Usado por UI/diagnóstico. */
  canaisDisponiveis(): MessageChannel[] {
    return this.registry.canaisRegistrados();
  }
}
