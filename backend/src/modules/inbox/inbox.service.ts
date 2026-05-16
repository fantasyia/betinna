import { Injectable, Logger } from '@nestjs/common';
import {
  type Conversation,
  type Message,
  type MessageChannel,
  type Prisma,
  MessageDirection,
  MessageStatus,
} from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
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

type ConversationWithRel = Prisma.ConversationGetPayload<{
  include: typeof conversationInclude;
}>;

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
  ) {}

  // ─── Visibilidade / multi-tenant ─────────────────────────────────────

  private requireEmpresa(user: AuthenticatedUser): string {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException(
        'Empresa não definida',
        ErrorCode.TENANT_ACCESS_DENIED,
      );
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
  ): Promise<Paginated<ConversationWithRel>> {
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
        orderBy: [{ ultimaMsgEm: 'desc' }, { criadoEm: 'desc' }],
        include: conversationInclude,
      }),
    ]);
    return buildPaginated(data, total, params.page, params.limit);
  }

  async findById(user: AuthenticatedUser, id: string): Promise<ConversationWithRel> {
    const conv = await this.prisma.conversation.findFirst({
      where: { id, ...this.baseWhere(user) },
      include: conversationInclude,
    });
    if (!conv) throw new NotFoundException('Conversation', id);
    return conv;
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

  // ─── Resposta (OUTBOUND) ─────────────────────────────────────────────

  async responder(
    user: AuthenticatedUser,
    conversationId: string,
    dto: ResponderDto,
  ): Promise<Message> {
    const conv = await this.findById(user, conversationId);
    const adapter = this.registry.obter(conv.canal);
    if (!adapter) {
      throw new BusinessRuleException(
        `Canal ${conv.canal} não tem adapter registrado`,
      );
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
      // Atualiza preview da conversa
      await this.prisma.conversation.update({
        where: { id: conversationId },
        data: {
          ultimaMsgEm: atualizada.criadoEm,
          ultimaMsgPreview: this.preview(dto.texto),
          status: conv.status === 'PENDENTE' ? 'ABERTA' : conv.status,
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
      throw new BusinessRuleException(
        `Falha ao enviar pelo canal ${conv.canal}: ${m}`,
      );
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

    const msg = await this.prisma.message.create({
      data: {
        conversationId: conv.id,
        direction: MessageDirection.INBOUND,
        tipo: params.tipo,
        conteudo: params.conteudo,
        externalId: params.externalId ?? null,
        status: MessageStatus.RECEIVED,
        mediaUrl: params.mediaUrl ?? null,
        mediaMime: params.mediaMime ?? null,
        meta: (params.meta as Prisma.InputJsonValue) ?? undefined,
        criadoEm: params.data ?? new Date(),
      },
    });

    await this.prisma.conversation.update({
      where: { id: conv.id },
      data: {
        ultimaMsgEm: msg.criadoEm,
        ultimaMsgPreview: this.preview(params.conteudo),
        naoLidas: { increment: 1 },
        status: 'PENDENTE',
      },
    });

    this.logger.log(
      `[${params.canal}] msg entrante ${msg.id} conv=${conv.id} peer=${params.peerId}`,
    );
    return { conversationId: conv.id, messageId: msg.id, duplicada: false };
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
    const existente = await this.prisma.conversation.findFirst({
      where: {
        empresaId: p.empresaId,
        canal: p.canal,
        peerId: p.peerId,
        proprietarioId: propId,
      },
    });
    if (existente) {
      return this.prisma.conversation.update({
        where: { id: existente.id },
        data: {
          peerNome: p.peerNome ?? undefined,
          clienteId: clienteId ?? undefined,
        },
      });
    }
    return this.prisma.conversation.create({
      data: {
        empresaId: p.empresaId,
        canal: p.canal,
        peerId: p.peerId,
        peerNome: p.peerNome ?? null,
        proprietarioId: propId,
        clienteId,
        status: 'PENDENTE',
        naoLidas: 0,
      },
    });
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
