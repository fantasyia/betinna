import { Injectable, Logger } from '@nestjs/common';
import {
  type Conversation,
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
import type {
  AlterarStatusDto,
  AtribuirDto,
  ListConversationsDto,
  ListMensagensDto,
  ResponderDto,
} from './inbox.dto';
import type { MensagemEntranteParams } from './inbox.types';

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
  ) {}

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

  // ─── Listagem / detalhes ─────────────────────────────────────────────

  async list(
    user: AuthenticatedUser,
    params: ListConversationsDto,
  ): Promise<Paginated<ConversationComSla>> {
    const where: Prisma.ConversationWhereInput = { ...this.baseWhere(user) };
    const conds: Prisma.ConversationWhereInput[] = [];

    if (params.canal) conds.push({ canal: params.canal });
    if (params.status) conds.push({ status: params.status });
    if (params.clienteId) conds.push({ clienteId: params.clienteId });
    if (params.meu) conds.push({ atribuidoId: user.id });
    if (params.atribuidoId) conds.push({ atribuidoId: params.atribuidoId });
    if (params.naoAtribuidas) conds.push({ atribuidoId: null });
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
        // Fase 2 — conversas que "precisam de humano" (bot caiu no fallback)
        // sobem pro topo, depois ordena por mais recente.
        orderBy: [{ precisaHumano: 'desc' }, { ultimaMsgEm: 'desc' }, { criadoEm: 'desc' }],
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
      const exists = await this.prisma.usuario.findFirst({
        where: { id: dto.atribuidoId },
        select: { id: true },
      });
      if (!exists) throw new NotFoundException('Usuario', dto.atribuidoId);
    }
    await this.prisma.conversation.updateMany({
      where: { id, empresaId: existing.empresaId },
      data: { atribuidoId: dto.atribuidoId },
    });
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
      const exists = await this.prisma.usuario.findFirst({
        where: { id: atribuidoId },
        select: { id: true },
      });
      if (!exists) throw new NotFoundException('Usuario', atribuidoId);
    }
    const where: Prisma.ConversationWhereInput = { id: { in: ids }, ...this.baseWhere(user) };
    const r = await this.prisma.conversation.updateMany({
      where,
      data: { atribuidoId },
    });
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

    // Cria mensagem PENDING primeiro pra ter id local mesmo se o envio falhar
    const msg = await this.prisma.message.create({
      data: {
        conversationId,
        direction: MessageDirection.OUTBOUND,
        tipo: 'TEXT',
        conteudo: dto.texto,
        status: MessageStatus.PENDING,
        autorUsuarioId: user.id,
      },
    });

    try {
      const r = await adapter.enviarTexto(conv.empresaId, conv.peerId, dto.texto, {
        proprietarioId: conv.proprietarioId,
        metadata: conv.metadata as Record<string, unknown> | null,
      });
      const atualizada = await this.prisma.message.update({
        where: { id: msg.id },
        data: { status: MessageStatus.SENT, externalId: r.externalId ?? null },
      });
      // Atualiza preview da conversa + zera naoLidas (responder = leu).
      // Fase 2 — HANDOFF: humano respondeu → pausa o bot nesta conversa por
      // BOT_HANDOFF_HORAS e limpa o "precisa humano" (alguém assumiu).
      const handoffMs = this.env.get('BOT_HANDOFF_HORAS') * 60 * 60 * 1000;
      await this.prisma.conversation.update({
        where: { id: conversationId },
        data: {
          ultimaMsgEm: atualizada.criadoEm,
          ultimaMsgPreview: this.preview(dto.texto),
          status: conv.status === 'PENDENTE' ? 'ABERTA' : conv.status,
          naoLidas: 0,
          botPausadoAte: new Date(Date.now() + handoffMs),
          precisaHumano: false,
        },
      });
      return atualizada;
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Falha enviando msg ${msg.id} em ${conv.canal}: ${m}`);
      await this.prisma.message.update({
        where: { id: msg.id },
        data: { status: MessageStatus.FAILED, meta: { erro: m } },
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
  async responderComoBot(conversationId: string, texto: string): Promise<void> {
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
    try {
      const r = await adapter.enviarTexto(conv.empresaId, conv.peerId, texto, {
        proprietarioId: conv.proprietarioId,
        metadata: conv.metadata as Record<string, unknown> | null,
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
      await this.prisma.conversation.update({
        where: { id: conversationId },
        data: {
          ultimaMsgEm: atualizada.criadoEm,
          ultimaMsgPreview: this.preview(conteudoPlaceholder),
          status: conv.status === 'PENDENTE' ? 'ABERTA' : conv.status,
          naoLidas: 0,
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
            peerId: params.peerId,
            proprietarioId: params.proprietarioId ?? null,
          },
        },
        select: { id: true, conversationId: true },
      });
      if (existente) {
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

    // Direction: default INBOUND. OUTBOUND quando o próprio número enviou
    // a mensagem (ex: dono respondeu pelo celular enquanto Baileys está
    // pareado — Baileys emite messages.upsert com fromMe=true).
    const direction =
      params.direction === 'OUTBOUND' ? MessageDirection.OUTBOUND : MessageDirection.INBOUND;
    const isInbound = direction === MessageDirection.INBOUND;

    // Mescla senderName na meta pra renderizar autor da msg em grupos.
    const metaFinal: Record<string, unknown> = {
      ...(params.meta ?? {}),
      ...(params.senderName ? { senderName: params.senderName } : {}),
    };
    const msg = await this.prisma.message.create({
      data: {
        conversationId: conv.id,
        direction,
        tipo: params.tipo,
        conteudo: params.conteudo,
        externalId: params.externalId ?? null,
        status: isInbound ? MessageStatus.RECEIVED : MessageStatus.SENT,
        mediaUrl: params.mediaUrl ?? null,
        mediaMime: params.mediaMime ?? null,
        meta: Object.keys(metaFinal).length > 0 ? (metaFinal as Prisma.InputJsonValue) : undefined,
        criadoEm: params.data ?? new Date(),
      },
    });

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
        const c = await this.prisma.cliente.findFirst({
          where: {
            empresaId,
            // Match por sufixo do telefone (ignorando código país/DDD inconsistências comuns)
            telefone: { contains: tel.slice(-8) },
          },
          select: { id: true },
        });
        if (c) return c.id;
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
    //  - avatarUrl: foto de perfil do peer
    //  - telefone: telefone REAL do contato (útil quando o peerId é um LID/número
    //    oculto do WhatsApp — aí o número de verdade vem em peerTelefone)
    const metaPatch: Record<string, unknown> = {};
    if (p.peerAvatarUrl) metaPatch.avatarUrl = p.peerAvatarUrl;
    if (p.peerTelefone) metaPatch.telefone = p.peerTelefone;

    // Lookup primeiro
    const existente = await this.prisma.conversation.findFirst({
      where: {
        empresaId: p.empresaId,
        canal: p.canal,
        peerId: p.peerId,
        proprietarioId: propId,
      },
    });
    if (existente) {
      // Mescla avatarUrl/telefone na metadata existente quando o adapter informa.
      const nextMetadata =
        Object.keys(metaPatch).length > 0
          ? { ...((existente.metadata as Record<string, unknown> | null) ?? {}), ...metaPatch }
          : undefined;
      return this.prisma.conversation.update({
        where: { id: existente.id },
        data: {
          peerNome: p.peerNome ?? undefined,
          clienteId: clienteId ?? undefined,
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
          ...(Object.keys(metaPatch).length > 0
            ? { metadata: metaPatch as Prisma.InputJsonValue }
            : {}),
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
