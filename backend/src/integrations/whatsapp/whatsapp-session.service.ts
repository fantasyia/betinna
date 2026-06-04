import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { MessageChannel, MessageDirection, MessageStatus } from '@prisma/client';
import { Boom } from '@hapi/boom';
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  type ConnectionState,
  type WASocket,
  proto,
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import { EnvService } from '@config/env.service';
import { PrismaService } from '@database/prisma.service';
import { InboxService } from '@modules/inbox/inbox.service';
import { IntegracaoStatusService } from '@modules/integracoes/integracao-status.service';
import { BusinessRuleException } from '@shared/errors/app-exception';
import { WhatsAppAuthState, ownerKey, type WhatsAppOwner } from './whatsapp-auth-state';
import { WhatsAppMediaService } from './whatsapp-media.service';
import type { WhatsAppSessionInfo, WhatsAppSessionStatus } from './whatsapp.types';

interface SessionContext {
  owner: WhatsAppOwner;
  /** Tenant em que essa sessão opera. Pra EMPRESA = owner.id. Pra USUARIO = empresaIdAtiva do user. */
  empresaId: string;
  sock: WASocket;
  auth: WhatsAppAuthState;
  info: WhatsAppSessionInfo;
  reconectTentativas: number;
  reconectTimer: NodeJS.Timeout | null;
  desligadoManualmente: boolean;
  /**
   * Cache do subject (nome) de grupos por jid (`xxx@g.us`).
   * TTL 30min — nomes mudam pouco. Valor null = falha ao buscar (cacheia
   * pra não retentar a cada msg do mesmo grupo).
   */
  groupNameCache: Map<string, { name: string | null; cachedAt: number }>;
}

const GROUP_NAME_TTL_MS = 30 * 60 * 1000;

/**
 * Gerencia sessões Baileys com **dois escopos**:
 *  - **EMPRESA**: 1 número central por empresa (operado pela equipe SAC)
 *  - **USUARIO**: 1 número por representante (cada rep com o próprio celular)
 *
 * Cada sessão é indexada por `ownerKey` (`emp:<id>` ou `user:<id>`). O mesmo
 * tenant (empresa) pode ter N sessões: 1 da empresa + N dos reps.
 *
 * Eventos de mensagens entrantes vão pro `InboxService.processarMensagemEntrante`
 * com o `proprietarioId` quando USUARIO (null quando EMPRESA — chat da central
 * é compartilhado, sem dono pessoal).
 *
 * Limitações conhecidas:
 *  - Não escala horizontalmente — sessões ficam presas no container que abriu
 *  - Grupos e broadcasts são ignorados (apenas 1:1)
 *  - Mídia recebida tem placeholder no conteúdo
 */
@Injectable()
export class WhatsAppSessionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WhatsAppSessionService.name);
  private readonly sessions = new Map<string, SessionContext>();
  private destruindo = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly inbox: InboxService,
    private readonly media: WhatsAppMediaService,
    private readonly statusIntegracao: IntegracaoStatusService,
  ) {}

  // ─── Lifecycle ────────────────────────────────────────────────────────

  async onModuleInit(): Promise<void> {
    if (this.env.get('NODE_ENV') === 'test') return;
    // CRÍTICO: só UM processo pode abrir o socket Baileys por número. A API e o
    // worker carregam o MESMO AppModule; sem esta trava, os DOIS abriam o socket
    // do mesmo número com a mesma credencial → o WhatsApp trata como CONFLITO e
    // fica derrubando os dois (a mensagem caía no meio da conversa, e re-parear
    // o QR não resolvia porque os dois reconectavam). A API é a dona do socket.
    if (this.env.get('SERVICE_TYPE') === 'worker') {
      this.logger.log(
        'SERVICE_TYPE=worker — NÃO abre socket WhatsApp (dono é a API). Sem conflito de sessão.',
      );
      return;
    }
    await Promise.all([this.bootEmpresa(), this.bootUsuarios()]);
  }

  private async bootEmpresa(): Promise<void> {
    const ativas = await this.prisma.integracaoConexao.findMany({
      where: { servico: 'whatsapp', ativo: true },
      select: { empresaId: true },
    });
    if (ativas.length > 0) {
      this.logger.log(
        `Boot: restaurando ${ativas.length} sessão(ões) WhatsApp empresa em background`,
      );
      for (const a of ativas) {
        void this.iniciarEmpresa(a.empresaId).catch((err) => {
          const m = err instanceof Error ? err.message : String(err);
          this.logger.warn(`Restauração empresa=${a.empresaId} falhou: ${m}`);
        });
      }
    }
  }

  private async bootUsuarios(): Promise<void> {
    const ativas = await this.prisma.usuarioIntegracao.findMany({
      where: { servico: 'whatsapp', ativo: true },
      select: {
        usuarioId: true,
        usuario: { select: { empresas: { select: { empresaId: true }, take: 1 } } },
      },
    });
    if (ativas.length > 0) {
      this.logger.log(
        `Boot: restaurando ${ativas.length} sessão(ões) WhatsApp usuário em background`,
      );
      for (const a of ativas) {
        const empresaId = a.usuario.empresas[0]?.empresaId;
        if (!empresaId) {
          this.logger.warn(
            `Usuário ${a.usuarioId} com integração WhatsApp mas sem empresa vinculada`,
          );
          continue;
        }
        void this.iniciarUsuario(a.usuarioId, empresaId).catch((err) => {
          const m = err instanceof Error ? err.message : String(err);
          this.logger.warn(`Restauração usuário=${a.usuarioId} falhou: ${m}`);
        });
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.destruindo = true;
    for (const ctx of this.sessions.values()) {
      ctx.desligadoManualmente = true;
      if (ctx.reconectTimer) clearTimeout(ctx.reconectTimer);
      try {
        void ctx.sock.end(new Error('shutdown'));
      } catch {
        // ignore
      }
      await ctx.auth.flush().catch(() => undefined);
    }
    this.sessions.clear();
  }

  // ─── API pública ──────────────────────────────────────────────────────

  /** Inicia sessão WhatsApp empresa (1 central por tenant). */
  async iniciarEmpresa(empresaId: string): Promise<WhatsAppSessionInfo> {
    return this.iniciar({ type: 'EMPRESA', id: empresaId }, empresaId);
  }

  /** Inicia sessão WhatsApp pessoal (1 por usuário). */
  async iniciarUsuario(usuarioId: string, empresaId: string): Promise<WhatsAppSessionInfo> {
    return this.iniciar({ type: 'USUARIO', id: usuarioId }, empresaId);
  }

  private async iniciar(owner: WhatsAppOwner, empresaId: string): Promise<WhatsAppSessionInfo> {
    const key = ownerKey(owner);
    const existente = this.sessions.get(key);
    if (existente) return existente.info;
    await this.criarSessao(owner, empresaId, false);
    const ctx = this.sessions.get(key);
    return ctx ? ctx.info : this.infoVazia(owner, empresaId, 'ERROR', 'falha ao iniciar');
  }

  async desconectarEmpresa(empresaId: string): Promise<void> {
    await this.desconectar({ type: 'EMPRESA', id: empresaId });
  }

  async desconectarUsuario(usuarioId: string): Promise<void> {
    await this.desconectar({ type: 'USUARIO', id: usuarioId });
  }

  private async desconectar(owner: WhatsAppOwner): Promise<void> {
    const ctx = this.sessions.get(ownerKey(owner));
    if (!ctx) return;
    ctx.desligadoManualmente = true;
    if (ctx.reconectTimer) clearTimeout(ctx.reconectTimer);
    try {
      await ctx.sock.logout().catch(() => undefined);
      void ctx.sock.end(undefined);
    } catch {
      // ignore
    }
    await ctx.auth.flush().catch(() => undefined);
    this.sessions.delete(ownerKey(owner));
  }

  /** Apaga credenciais e encerra. Próxima `iniciar` exige novo QR. */
  async resetarEmpresa(empresaId: string): Promise<void> {
    await this.resetar({ type: 'EMPRESA', id: empresaId });
  }
  async resetarUsuario(usuarioId: string): Promise<void> {
    await this.resetar({ type: 'USUARIO', id: usuarioId });
  }
  private async resetar(owner: WhatsAppOwner): Promise<void> {
    await this.desconectar(owner);
    const auth = await WhatsAppAuthState.carregar(
      owner,
      this.prisma,
      this.env.get('ENCRYPTION_KEY'),
    );
    await auth.limpar();
  }

  statusEmpresa(empresaId: string): WhatsAppSessionInfo {
    const ctx = this.sessions.get(ownerKey({ type: 'EMPRESA', id: empresaId }));
    return ctx
      ? ctx.info
      : this.infoVazia({ type: 'EMPRESA', id: empresaId }, empresaId, 'DISCONNECTED');
  }

  statusUsuario(usuarioId: string, empresaId: string): WhatsAppSessionInfo {
    const ctx = this.sessions.get(ownerKey({ type: 'USUARIO', id: usuarioId }));
    return ctx
      ? ctx.info
      : this.infoVazia({ type: 'USUARIO', id: usuarioId }, empresaId, 'DISCONNECTED');
  }

  /** True se sessão owner está conectada (CONNECTED). */
  estaConectado(owner: WhatsAppOwner): boolean {
    return this.sessions.get(ownerKey(owner))?.info.status === 'CONNECTED';
  }

  /**
   * Envia texto. Owner indica qual sessão (empresa ou usuário) deve mandar.
   * Lança se sessão não conectada.
   */
  async enviarTexto(
    owner: WhatsAppOwner,
    peerId: string,
    texto: string,
  ): Promise<{ externalId?: string }> {
    let ctx = this.sessions.get(ownerKey(owner));
    // Queda MOMENTÂNEA (blip de segundos) não pode perder a mensagem: se a
    // sessão não está CONNECTED, espera a reconexão automática voltar antes de
    // desistir. Era a causa de respostas do bot marcadas FAILED "não conectado"
    // quando o socket caía por 1-2s no exato instante do envio.
    if (!ctx || ctx.info.status !== 'CONNECTED') {
      ctx = await this.aguardarConexao(owner, 12_000);
    }
    if (!ctx || ctx.info.status !== 'CONNECTED') {
      throw new BusinessRuleException(`Sessão WhatsApp ${ownerKey(owner)} não está conectada`);
    }
    const jid = this.normalizarJid(peerId);
    try {
      const r = await ctx.sock.sendMessage(jid, { text: texto });
      return { externalId: r?.key?.id ?? undefined };
    } catch (err) {
      this.tratarFalhaSocket(ctx, err);
      throw err;
    }
  }

  /**
   * Espera a sessão voltar pra CONNECTED por até `timeoutMs` (a reconexão é
   * automática com backoff — costuma voltar em poucos segundos). Desiste cedo
   * se a sessão deslogou (LOGGED_OUT) ou deu erro definitivo (ERROR), porque aí
   * esperar não adianta — precisa de QR/ação manual.
   */
  private async aguardarConexao(
    owner: WhatsAppOwner,
    timeoutMs: number,
  ): Promise<SessionContext | undefined> {
    const ate = Date.now() + timeoutMs;
    while (Date.now() < ate) {
      const ctx = this.sessions.get(ownerKey(owner));
      if (ctx?.info.status === 'CONNECTED') return ctx;
      if (ctx?.info.status === 'LOGGED_OUT' || ctx?.info.status === 'ERROR') return ctx;
      await new Promise((r) => setTimeout(r, 700));
    }
    return this.sessions.get(ownerKey(owner));
  }

  /**
   * Persistência/retry: ao reconectar, reenvia as mensagens OUTBOUND que ficaram
   * `FAILED` por queda da sessão (blip/queda/deploy). Janela de 15 min pra não
   * ressuscitar mensagem velha. É seguro reenviar: `FAILED` = não saiu. Filtra
   * só as conversas DESTA sessão (empresa central vs WhatsApp pessoal do rep).
   * Best-effort — erro aqui nunca atrapalha a reconexão.
   */
  private async reenviarPendentes(ctx: SessionContext): Promise<void> {
    const key = ownerKey(ctx.owner);
    try {
      const desde = new Date(Date.now() - 15 * 60_000);
      const convFilter =
        ctx.owner.type === 'USUARIO'
          ? { canal: MessageChannel.WHATSAPP, proprietarioId: ctx.owner.id }
          : { canal: MessageChannel.WHATSAPP, empresaId: ctx.empresaId, proprietarioId: null };
      const pendentes = await this.prisma.message.findMany({
        where: {
          direction: MessageDirection.OUTBOUND,
          status: MessageStatus.FAILED,
          criadoEm: { gte: desde },
          conversation: convFilter,
        },
        select: { id: true, conteudo: true, conversation: { select: { peerId: true } } },
        orderBy: { criadoEm: 'asc' },
        take: 50,
      });
      if (pendentes.length === 0) return;
      this.logger.log(`[${key}] reenviando ${pendentes.length} mensagem(ns) FAILED pós-reconexão`);
      for (const m of pendentes) {
        try {
          const r = await this.enviarTexto(ctx.owner, m.conversation.peerId, m.conteudo);
          await this.prisma.message.update({
            where: { id: m.id },
            data: { status: MessageStatus.SENT, externalId: r.externalId ?? null },
          });
        } catch {
          // Segue FAILED — nova tentativa na próxima reconexão (dentro da janela).
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[${key}] reenvio pós-reconexão falhou: ${msg}`);
    }
  }

  /**
   * Quando `sock.sendMessage` falha com erro de socket fechado, o status
   * interno (`ctx.info.status`) pode estar dessincronizado (ainda CONNECTED).
   * Marca como caído pra próximos sends falharem cedo (no check inicial) e
   * dispara reconexão imediata em background. UX-wise o usuário vê erro 1x,
   * próximo retry funciona já reconectado.
   */
  private tratarFalhaSocket(ctx: SessionContext, err: unknown): void {
    const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
    const isSocketDown =
      msg.includes('connection closed') ||
      msg.includes('connection lost') ||
      msg.includes('timed out') ||
      msg.includes('socket') ||
      msg.includes('not open');
    if (!isSocketDown) return;
    const key = ownerKey(ctx.owner);
    this.logger.warn(
      `[${key}] Socket WhatsApp caiu durante envio (${msg}) — reagendando reconexão`,
    );
    ctx.info.status = 'DISCONNECTED';
    ctx.info.desde = new Date();
    // Reconexão async — não bloqueia o erro que vai voltar pro usuário.
    // Próxima tentativa do usuário vai pegar a sessão já reconectada (ou
    // status DISCONNECTED claro pra reconectar via UI).
    void this.criarSessao(ctx.owner, ctx.empresaId, true).catch((e) => {
      const m = e instanceof Error ? e.message : String(e);
      this.logger.warn(`[${key}] Reconexão pós-falha falhou: ${m}`);
    });
  }

  /**
   * Envia mídia (imagem/vídeo/áudio/documento) via Baileys.
   *
   * Aceita 3 formas de fornecer o conteúdo (ordem de preferência):
   *  1. `buffer`: bytes diretos (sem rede). Ideal pra forwarding (já temos no Storage).
   *  2. `storagePath`: caminho no bucket `whatsapp-media`. Service resolve signed URL
   *     e Baileys baixa de lá.
   *  3. `url`: URL pública já acessível. Use com cautela — não passar URLs CDN
   *     de outros provedores que podem expirar.
   *
   * `tipo` controla a estrutura WAMessage:
   *  - IMAGE / VIDEO: caption opcional, mimetype auto
   *  - AUDIO: PTT (voice note) toggle
   *  - DOCUMENT: fileName + mimetype obrigatórios
   *
   * Limites WhatsApp:
   *  - Imagem: 5 MB
   *  - Vídeo: 16 MB
   *  - Áudio: 16 MB
   *  - Documento: 100 MB
   * Excedendo, a Meta retorna erro do Baileys que propagamos como BusinessRule.
   */
  async enviarMidia(
    owner: WhatsAppOwner,
    peerId: string,
    params: {
      tipo: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'DOCUMENT';
      caption?: string;
      mimetype?: string;
      fileName?: string;
      ptt?: boolean;
      buffer?: Buffer;
      url?: string;
      storagePath?: string;
    },
  ): Promise<{ externalId?: string }> {
    const ctx = this.sessions.get(ownerKey(owner));
    if (!ctx || ctx.info.status !== 'CONNECTED') {
      throw new BusinessRuleException(`Sessão WhatsApp ${ownerKey(owner)} não está conectada`);
    }

    // Resolve fonte do binário
    let mediaSource: { url: string } | Buffer;
    if (params.buffer) {
      mediaSource = params.buffer;
    } else if (params.storagePath) {
      const signed = await this.media.signedUrl(params.storagePath, 300);
      if (!signed) {
        throw new BusinessRuleException(
          'Falha ao gerar URL de mídia do Storage — verifique o storagePath',
        );
      }
      mediaSource = { url: signed };
    } else if (params.url) {
      mediaSource = { url: params.url };
    } else {
      throw new BusinessRuleException(
        'Forneça buffer, storagePath ou url pra enviar mídia WhatsApp',
      );
    }

    const jid = this.normalizarJid(peerId);
    let waMessage: Parameters<typeof ctx.sock.sendMessage>[1];

    switch (params.tipo) {
      case 'IMAGE':
        waMessage = {
          image: mediaSource,
          caption: params.caption,
          mimetype: params.mimetype ?? 'image/jpeg',
        };
        break;
      case 'VIDEO':
        waMessage = {
          video: mediaSource,
          caption: params.caption,
          mimetype: params.mimetype ?? 'video/mp4',
        };
        break;
      case 'AUDIO':
        waMessage = {
          audio: mediaSource,
          mimetype: params.mimetype ?? 'audio/ogg; codecs=opus',
          ptt: params.ptt ?? false,
        };
        break;
      case 'DOCUMENT':
        if (!params.fileName) {
          throw new BusinessRuleException('fileName obrigatório para DOCUMENT');
        }
        waMessage = {
          document: mediaSource,
          mimetype: params.mimetype ?? 'application/pdf',
          fileName: params.fileName,
          caption: params.caption,
        };
        break;
      default:
        throw new BusinessRuleException(`Tipo de mídia não suportado: ${String(params.tipo)}`);
    }

    try {
      const r = await ctx.sock.sendMessage(jid, waMessage);
      return { externalId: r?.key?.id ?? undefined };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Falha enviando mídia WhatsApp ${ownerKey(owner)} → ${peerId}: ${msg}`);
      this.tratarFalhaSocket(ctx, err);
      throw new BusinessRuleException(`Falha ao enviar mídia WhatsApp: ${msg}`);
    }
  }

  // ─── Implementação interna ────────────────────────────────────────────

  private async criarSessao(
    owner: WhatsAppOwner,
    empresaId: string,
    isReconexao: boolean,
  ): Promise<void> {
    if (this.destruindo) return;
    const key = ownerKey(owner);
    if (this.sessions.has(key) && !isReconexao) return;

    const auth = await WhatsAppAuthState.carregar(
      owner,
      this.prisma,
      this.env.get('ENCRYPTION_KEY'),
    );
    const { state, saveCreds } = auth.build();
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));

    // Logger silencioso pra Baileys — tem que implementar TODOS os métodos
    // do pino (trace/debug/info/warn/error/fatal) senão Baileys crasha em
    // shutdown chamando `logger.trace()`. Bug fix 2026-05-23 (TypeError:
    // logger.trace is not a function no Sentry).

    const noop = (): void => undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const silentLogger: any = {
      level: 'silent',
      trace: noop,
      debug: noop,
      info: noop,
      warn: noop,
      error: noop,
      fatal: noop,
      // child precisa retornar um logger com a mesma forma (referência recursiva)
      child: () => silentLogger,
    };

    const sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys),
      },
      printQRInTerminal: false,
      logger: silentLogger,
      browser: ['Betinna.ai', 'Chrome', '1.0.0'],
    });

    const info: WhatsAppSessionInfo = {
      ownerType: owner.type,
      ownerId: owner.id,
      empresaId,
      status: 'CONNECTING',
      desde: new Date(),
    };

    const ctx: SessionContext = {
      owner,
      empresaId,
      sock,
      auth,
      info,
      reconectTentativas: isReconexao ? (this.sessions.get(key)?.reconectTentativas ?? 0) : 0,
      reconectTimer: null,
      desligadoManualmente: false,
      groupNameCache: this.sessions.get(key)?.groupNameCache ?? new Map(),
    };
    this.sessions.set(key, ctx);

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (u) => {
      void this.handleConnectionUpdate(ctx, u);
    });

    sock.ev.on('messages.upsert', (u) => {
      // Aceita tanto 'notify' (tempo real) quanto 'append' (history sync após
      // reconnect — ex: deploy Railway que restarta container). Idempotência
      // por externalId garante que não duplica nada.
      if (u.type !== 'notify' && u.type !== 'append') return;
      void this.handleMensagensEntrantes(ctx, u.messages).catch((err) => {
        const m = err instanceof Error ? err.message : String(err);
        this.logger.warn(`[${ownerKey(ctx.owner)}] Falha processando msgs entrantes: ${m}`);
      });
    });

    // Após reconnect, Baileys emite messaging-history.set com TODAS as msgs
    // recentes (últimas N do servidor WhatsApp). Crítico pra cobrir mensagens
    // que chegaram durante o downtime (redeploy Railway). Idempotência por
    // externalId previne duplicação das que a gente já tem.
    sock.ev.on('messaging-history.set', (h) => {
      const msgs = Array.isArray(h.messages) ? h.messages : [];
      if (msgs.length > 0) {
        this.logger.log(
          `[${ownerKey(ctx.owner)}] history sync: ${msgs.length} mensagens (syncType=${h.syncType ?? '?'}, isLatest=${h.isLatest ?? '?'})`,
        );
        void this.handleMensagensEntrantes(ctx, msgs).catch((err) => {
          const m = err instanceof Error ? err.message : String(err);
          this.logger.warn(`[${ownerKey(ctx.owner)}] Falha processando history sync: ${m}`);
        });
      }
      // No history sync também vêm os chats com unreadCount snapshot — sincroniza
      // o contador de não-lidas inicial pra refletir o estado do WhatsApp.
      const chats = Array.isArray(h.chats) ? h.chats : [];
      if (chats.length > 0) {
        void this.sincronizarUnreadCount(ctx, chats).catch((err) => {
          const m = err instanceof Error ? err.message : String(err);
          this.logger.warn(`[${ownerKey(ctx.owner)}] Falha sync unreadCount (history): ${m}`);
        });
      }
    });

    // Quando o user lê mensagens em OUTRO dispositivo (celular, WhatsApp Web),
    // Baileys emite chats.update com o novo unreadCount do chat. Sincronizamos
    // pra Betinna não mostrar contador "fake" alto quando o usuário já leu fora.
    sock.ev.on('chats.update', (updates) => {
      if (!Array.isArray(updates) || updates.length === 0) return;
      void this.sincronizarUnreadCount(ctx, updates).catch((err) => {
        const m = err instanceof Error ? err.message : String(err);
        this.logger.warn(`[${ownerKey(ctx.owner)}] Falha sync unreadCount (update): ${m}`);
      });
    });

    // Recibo de leitura: quando o destinatário LÊ uma mensagem que enviamos
    // (status READ/PLAYED), Baileys emite messages.update com o key.id da nossa
    // msg. Casamos com CampanhaDestinatario.waMessageId pra marcar LIDO.
    sock.ev.on('messages.update', (updates) => {
      if (!Array.isArray(updates) || updates.length === 0) return;
      void this.marcarRecibosLeitura(updates).catch((err) => {
        const m = err instanceof Error ? err.message : String(err);
        this.logger.warn(`[${ownerKey(ctx.owner)}] Falha processando recibos de leitura: ${m}`);
      });
    });
  }

  private async handleConnectionUpdate(
    ctx: SessionContext,
    u: Partial<ConnectionState>,
  ): Promise<void> {
    const key = ownerKey(ctx.owner);
    if (u.qr) {
      // Fix QR (Fase 2.0): gera a IMAGEM do QR ANTES de expor o status.
      // Antes, status virava QR_PENDING na hora mas o qrDataUrl chegava ms
      // depois (assíncrono); o polling do front (a cada 3s) podia pegar a
      // janela vazia → mostrava "Aguardando QR" sem imagem. Agora o dataUrl
      // já está pronto quando o status QR_PENDING aparece. O qrRaw fica como
      // reserva caso a geração da imagem falhe.
      let dataUrl: string | undefined;
      try {
        dataUrl = await QRCode.toDataURL(u.qr, {
          errorCorrectionLevel: 'M',
          margin: 1,
          width: 320,
        });
      } catch {
        dataUrl = undefined;
      }
      ctx.info.qrRaw = u.qr;
      ctx.info.qrDataUrl = dataUrl;
      ctx.info.status = 'QR_PENDING';
      ctx.info.desde = new Date();
      this.logger.log(`[${key}] QR code disponível${dataUrl ? '' : ' (sem imagem — QR cru)'}`);
    }
    if (u.connection === 'open') {
      ctx.info.status = 'CONNECTED';
      ctx.info.desde = new Date();
      ctx.info.qrDataUrl = undefined;
      ctx.info.qrRaw = undefined;
      ctx.info.numero = ctx.sock.user?.id;
      ctx.reconectTentativas = 0;
      this.logger.log(`[${key}] WhatsApp conectado (${ctx.info.numero ?? '?'})`);
      // Semáforo de saúde — só o WhatsApp empresa aparece no painel de integrações.
      if (ctx.owner.type === 'EMPRESA') {
        void this.statusIntegracao.registrarSucesso(ctx.empresaId, 'whatsapp');
      }
      // Persistência/retry: reenvia as OUTBOUND que ficaram FAILED por queda da
      // sessão (blip/queda/deploy). A mensagem nunca mais se perde — assim que o
      // WhatsApp volta, ela sai.
      void this.reenviarPendentes(ctx);
    }
    if (u.connection === 'close') {
      const code = (u.lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      if (loggedOut) {
        ctx.info.status = 'LOGGED_OUT';
        ctx.info.desde = new Date();
        this.logger.warn(`[${key}] WhatsApp deslogado — exige novo QR`);
        if (ctx.owner.type === 'EMPRESA') {
          void this.statusIntegracao.marcarDesconectado(
            ctx.empresaId,
            'whatsapp',
            'WhatsApp deslogado — exige novo pareamento (QR).',
          );
        }
        void ctx.auth.limpar().catch(() => undefined);
        this.sessions.delete(key);
        return;
      }
      if (ctx.desligadoManualmente || this.destruindo) {
        ctx.info.status = 'DISCONNECTED';
        return;
      }
      this.agendarReconexao(ctx);
    }
  }

  private agendarReconexao(ctx: SessionContext): void {
    const key = ownerKey(ctx.owner);
    ctx.reconectTentativas++;
    if (ctx.reconectTentativas > 10) {
      ctx.info.status = 'ERROR';
      ctx.info.erro = 'limite de tentativas de reconexão atingido';
      this.logger.error(`[${key}] Reconexão WhatsApp desistiu após 10 tentativas`);
      if (ctx.owner.type === 'EMPRESA') {
        void this.statusIntegracao.marcarDesconectado(
          ctx.empresaId,
          'whatsapp',
          'Reconexão automática desistiu após 10 tentativas.',
        );
      }
      return;
    }
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(6, ctx.reconectTentativas));
    this.logger.warn(`[${key}] reconectando em ${delay}ms (tentativa ${ctx.reconectTentativas})`);
    ctx.info.status = 'CONNECTING';
    ctx.reconectTimer = setTimeout(() => {
      void this.criarSessao(ctx.owner, ctx.empresaId, true).catch((err) => {
        const m = err instanceof Error ? err.message : String(err);
        this.logger.warn(`[${key}] reconect falhou: ${m}`);
      });
    }, delay);
  }

  /**
   * Sincroniza Conversation.naoLidas com o unreadCount do WhatsApp.
   *
   * Recebe array de chats do Baileys (vindos de chats.update ou
   * messaging-history.set). Pra cada chat com unreadCount definido,
   * atualiza a Conversation correspondente.
   *
   * Por que isso é necessário: a Betinna incrementa naoLidas a cada
   * mensagem entrante. Mas se o user lê no celular (outro device pareado),
   * o Baileys informa via chats.update e a Betinna precisa zerar/reduzir
   * pra não ficar com contador "fake" alto.
   */
  private async sincronizarUnreadCount(
    ctx: SessionContext,
    chats: Array<{ id?: string | null; unreadCount?: number | null }>,
  ): Promise<void> {
    const proprietarioId = ctx.owner.type === 'USUARIO' ? ctx.owner.id : null;
    for (const chat of chats) {
      const jid = chat.id;
      if (!jid || typeof jid !== 'string') continue;
      // Ignora broadcasts/status — não temos Conversation pra eles.
      if (jid.endsWith('@broadcast') || jid === 'status@broadcast') continue;
      const unread = typeof chat.unreadCount === 'number' ? chat.unreadCount : null;
      if (unread === null) continue;
      // Clamp ≥ 0 (Baileys às vezes manda -1 pra "mute marker", ignoramos)
      const safeUnread = Math.max(0, unread);
      await this.prisma.conversation.updateMany({
        where: {
          empresaId: ctx.empresaId,
          canal: 'WHATSAPP',
          peerId: jid,
          proprietarioId,
        },
        data: { naoLidas: safeUnread },
      });
    }
  }

  /**
   * Casa recibos de leitura (messages.update status READ/PLAYED) de mensagens
   * que NÓS enviamos (fromMe) com `CampanhaDestinatario.waMessageId` e marca
   * LIDO. Mensagens fora de campanha não casam nada (updateMany afeta 0 linhas),
   * então é seguro rodar pra todo update. Matching por waMessageId global
   * (key.id é único) — não precisa de escopo por empresa.
   */
  private async marcarRecibosLeitura(
    updates: Array<{ key?: proto.IMessageKey | null; update?: { status?: number | null } | null }>,
  ): Promise<void> {
    const READ = proto.WebMessageInfo.Status.READ;
    const lidos: string[] = [];
    for (const u of updates) {
      const status = u.update?.status;
      const leu = typeof status === 'number' && status >= READ;
      if (u.key?.fromMe === true && leu && u.key.id) lidos.push(u.key.id);
    }
    if (lidos.length === 0) return;
    const res = await this.prisma.campanhaDestinatario.updateMany({
      where: { waMessageId: { in: lidos }, status: 'ENVIADO' },
      data: { status: 'LIDO', lido: true, lidoEm: new Date() },
    });
    if (res.count > 0) {
      this.logger.debug(`Recibo de leitura: ${res.count} destinatário(s) de campanha → LIDO`);
    }
  }

  private async handleMensagensEntrantes(
    ctx: SessionContext,
    mensagens: proto.IWebMessageInfo[],
  ): Promise<void> {
    for (const m of mensagens) {
      if (!m.key) continue;
      // NÃO descarta fromMe — quando o dono do número responde pelo celular
      // (ou outro dispositivo Multi-Device), Baileys emite com fromMe=true.
      // Precisa aparecer na Betinna como OUTBOUND. Idempotência por externalId
      // evita duplicar mensagens que a própria Betinna enviou.
      const fromMe = m.key.fromMe === true;
      const peerId = m.key.remoteJid ?? '';
      if (!peerId) continue;
      // Mantém broadcasts e status do WhatsApp filtrados — não são conversas.
      // Grupos (@g.us) AGORA passam — tratados com peerNome=subject + senderName.
      if (peerId.endsWith('@broadcast')) continue;
      if (peerId === 'status@broadcast') continue;
      const isGroup = peerId.endsWith('@g.us');

      const { conteudo, tipo, mediaMime, extras } = this.extrairConteudo(m.message);
      // Antes: descartava silenciosamente quando extrairConteudo caía no fallback
      // (tipos não reconhecidos: reply citando, reação, edição, poll, lista,
      // viewOnce, etc). Resultado: algumas mensagens "sumiam". Agora logamos
      // quando descartamos pra ter visibilidade e SÓ pulamos casos claramente
      // não-conteúdo (reactionMessage, protocolMessage, senderKeyDistribution).
      if (!conteudo && tipo === 'TEXT') {
        // Detecta tipos "silenciosos" que NÃO devem aparecer na inbox
        // (eventos internos do WhatsApp, não mensagens de fato)
        const isSilent =
          !!m.message?.reactionMessage ||
          !!m.message?.protocolMessage ||
          !!m.message?.senderKeyDistributionMessage ||
          !!m.message?.messageContextInfo;
        if (isSilent) continue;
        // Tipo desconhecido com conteúdo vazio → deixa passar como placeholder
        // pra usuário ver "tem alguma coisa aqui que o sistema não suporta ainda".
        // Lista keys do m.message pra debug.
        const keys = m.message ? Object.keys(m.message).join(',') : '(null)';
        this.logger.warn(`[${ownerKey(ctx.owner)}] msg sem conteúdo extraível — tipos: ${keys}`);
        // Salva com placeholder pra UX (sem perder a mensagem)
        await this.inbox.processarMensagemEntrante({
          empresaId: ctx.empresaId,
          canal: 'WHATSAPP',
          peerId,
          peerNome: fromMe ? undefined : (m.pushName ?? undefined),
          peerTelefone: this.telefoneRealDoKey(peerId, m.key),
          tipo: 'TEXT',
          conteudo: '[mensagem não suportada]',
          externalId: m.key.id ?? undefined,
          data: m.messageTimestamp ? new Date(Number(m.messageTimestamp) * 1000) : undefined,
          proprietarioId: ctx.owner.type === 'USUARIO' ? ctx.owner.id : undefined,
          direction: fromMe ? 'OUTBOUND' : 'INBOUND',
          meta: { jid: peerId, ownerKey: ownerKey(ctx.owner), tiposBrutos: keys },
        });
        continue;
      }

      // Quando owner=USUARIO, passa proprietarioId pra Conversation ficar
      // atrelada à sessão do rep. Empresa = null (conversa "compartilhada").
      const proprietarioId = ctx.owner.type === 'USUARIO' ? ctx.owner.id : undefined;

      // Mídia: tenta baixar e armazenar em Supabase Storage (best-effort).
      // Se falhar, segue com placeholder no `conteudo` (`[imagem]` etc).
      let mediaUrl: string | undefined;
      if (tipo !== 'TEXT' && tipo !== 'LOCATION' && tipo !== 'CONTACT') {
        const path = await this.media.baixarEArmazenar({
          message: m,
          empresaId: ctx.empresaId,
          peerId,
          mediaMime,
          msgId: m.key.id ?? undefined,
        });
        if (path) mediaUrl = path;
      }

      // Em grupos, peerNome é o NOME DO GRUPO (subject) e senderName é
      // quem mandou (pushName do membro). Em 1:1 peerNome=pushName e
      // senderName fica vazio.
      const peerNomeDef = isGroup
        ? await this.obterNomeGrupo(ctx, peerId)
        : fromMe
          ? undefined
          : (m.pushName ?? undefined);
      const senderName = isGroup && !fromMe ? (m.pushName ?? undefined) : undefined;

      await this.inbox.processarMensagemEntrante({
        empresaId: ctx.empresaId,
        canal: 'WHATSAPP',
        peerId,
        peerNome: peerNomeDef,
        senderName,
        // Grupos não têm telefone único — pula match por sufixo.
        // Pra contatos com LID (número oculto) usa o telefone real do remoteJidAlt.
        peerTelefone: isGroup ? undefined : this.telefoneRealDoKey(peerId, m.key),
        tipo,
        conteudo,
        externalId: m.key.id ?? undefined,
        data: m.messageTimestamp ? new Date(Number(m.messageTimestamp) * 1000) : undefined,
        mediaMime,
        mediaUrl,
        proprietarioId,
        direction: fromMe ? 'OUTBOUND' : 'INBOUND',
        meta: { jid: peerId, ownerKey: ownerKey(ctx.owner), ...(extras ?? {}) },
      });
    }
  }

  /**
   * Busca o subject (nome) de um grupo. Cacheado TTL 30min. Retorna undefined
   * se falhar (não é grupo, sem permissão, erro de rede). Frontend cai pro jid
   * cru nesses casos.
   */
  private async obterNomeGrupo(ctx: SessionContext, jid: string): Promise<string | undefined> {
    const now = Date.now();
    const cached = ctx.groupNameCache.get(jid);
    if (cached && now - cached.cachedAt < GROUP_NAME_TTL_MS) {
      return cached.name ?? undefined;
    }
    try {
      const meta = await ctx.sock.groupMetadata(jid);
      const name = meta?.subject ?? null;
      ctx.groupNameCache.set(jid, { name, cachedAt: now });
      return name ?? undefined;
    } catch {
      // Sock não conectado, grupo inacessível, etc — cacheia null pra não retentar.
      ctx.groupNameCache.set(jid, { name: null, cachedAt: now });
      return undefined;
    }
  }

  private extrairConteudo(msg: proto.IMessage | null | undefined): {
    conteudo: string;
    tipo: 'TEXT' | 'IMAGE' | 'AUDIO' | 'VIDEO' | 'DOCUMENT' | 'STICKER' | 'LOCATION' | 'CONTACT';
    mediaMime?: string;
    /** Dados estruturados específicos do tipo — vão pra `Message.meta`. */
    extras?: Record<string, unknown>;
  } {
    if (!msg) return { conteudo: '', tipo: 'TEXT' };
    if (msg.conversation) return { conteudo: msg.conversation, tipo: 'TEXT' };
    if (msg.extendedTextMessage?.text) {
      return { conteudo: msg.extendedTextMessage.text, tipo: 'TEXT' };
    }
    // View-once: WhatsApp embute a mensagem real dentro de viewOnceMessage(V2).
    // Desembrulha recursivamente pra extrair o conteúdo (imagem/vídeo/texto).
    if (msg.viewOnceMessage?.message) {
      return this.extrairConteudo(msg.viewOnceMessage.message);
    }
    if (msg.viewOnceMessageV2?.message) {
      return this.extrairConteudo(msg.viewOnceMessageV2.message);
    }
    if (msg.viewOnceMessageV2Extension?.message) {
      return this.extrairConteudo(msg.viewOnceMessageV2Extension.message);
    }
    // Mensagem editada: o texto novo vem em editedMessage.message.protocolMessage.editedMessage.
    // Fallback: tenta extrair de editedMessage.message direto.
    if (msg.editedMessage?.message) {
      const inner = this.extrairConteudo(msg.editedMessage.message);
      return inner.conteudo ? { ...inner, conteudo: `${inner.conteudo} (editada)` } : inner;
    }
    if (msg.imageMessage) {
      return {
        conteudo: msg.imageMessage.caption ?? '[imagem]',
        tipo: 'IMAGE',
        mediaMime: msg.imageMessage.mimetype ?? undefined,
        extras: msg.imageMessage.fileLength
          ? { fileLength: Number(msg.imageMessage.fileLength) }
          : undefined,
      };
    }
    if (msg.videoMessage) {
      return {
        conteudo: msg.videoMessage.caption ?? '[vídeo]',
        tipo: 'VIDEO',
        mediaMime: msg.videoMessage.mimetype ?? undefined,
        extras: {
          ...(msg.videoMessage.seconds ? { duracaoSeg: msg.videoMessage.seconds } : {}),
          ...(msg.videoMessage.fileLength
            ? { fileLength: Number(msg.videoMessage.fileLength) }
            : {}),
        },
      };
    }
    if (msg.audioMessage) {
      return {
        conteudo: '[áudio]',
        tipo: 'AUDIO',
        mediaMime: msg.audioMessage.mimetype ?? undefined,
        extras: {
          ...(msg.audioMessage.seconds ? { duracaoSeg: msg.audioMessage.seconds } : {}),
          ...(msg.audioMessage.ptt ? { ptt: true } : {}), // voice note
        },
      };
    }
    if (msg.documentMessage) {
      return {
        conteudo: msg.documentMessage.fileName ?? '[documento]',
        tipo: 'DOCUMENT',
        mediaMime: msg.documentMessage.mimetype ?? undefined,
        extras: {
          ...(msg.documentMessage.fileName ? { fileName: msg.documentMessage.fileName } : {}),
          ...(msg.documentMessage.fileLength
            ? { fileLength: Number(msg.documentMessage.fileLength) }
            : {}),
          ...(msg.documentMessage.pageCount ? { pageCount: msg.documentMessage.pageCount } : {}),
        },
      };
    }
    if (msg.stickerMessage) return { conteudo: '[sticker]', tipo: 'STICKER' };
    if (msg.locationMessage) {
      const lat = msg.locationMessage.degreesLatitude ?? 0;
      const lng = msg.locationMessage.degreesLongitude ?? 0;
      return {
        conteudo: `[localização] ${lat},${lng}`,
        tipo: 'LOCATION',
        extras: {
          latitude: lat,
          longitude: lng,
          ...(msg.locationMessage.name ? { nome: msg.locationMessage.name } : {}),
          ...(msg.locationMessage.address ? { endereco: msg.locationMessage.address } : {}),
          /**
           * Link clicável Google Maps — usado pelo frontend pra renderizar
           * preview/CTA "abrir no mapa" sem precisar reconstruir.
           */
          mapsUrl: `https://www.google.com/maps?q=${lat},${lng}`,
        },
      };
    }
    if (msg.contactMessage) {
      const displayName = msg.contactMessage.displayName ?? '[contato]';
      const vcard = msg.contactMessage.vcard ?? '';
      // Parse simples do vCard pra extrair TEL + EMAIL (best-effort, formato vCard 3.0)
      const telefones = this.parseVCardField(vcard, 'TEL');
      const emails = this.parseVCardField(vcard, 'EMAIL');
      const nome = this.parseVCardField(vcard, 'FN')[0] ?? displayName;
      return {
        conteudo: displayName,
        tipo: 'CONTACT',
        extras: {
          nome,
          ...(telefones.length > 0 ? { telefones } : {}),
          ...(emails.length > 0 ? { emails } : {}),
        },
      };
    }
    return { conteudo: '', tipo: 'TEXT' };
  }

  /**
   * Extrai campos de um vCard 3.0/4.0 — parser tolerante.
   * Procura linhas começando com `<FIELD>:` ou `<FIELD>;...:` e devolve valores.
   * Ex: vCard com `TEL;TYPE=CELL:+5511999998888` → `parseVCardField(v, 'TEL') === ['+5511999998888']`
   */
  private parseVCardField(vcard: string, field: string): string[] {
    if (!vcard) return [];
    const lines = vcard.split(/\r?\n/);
    const out: string[] = [];
    const upper = field.toUpperCase();
    for (const line of lines) {
      // Match: FIELD[;params]:value
      const m = /^([A-Z]+)(;[^:]*)?:(.+)$/u.exec(line.trim());
      if (m && m[1].toUpperCase() === upper && m[3]) {
        out.push(m[3].trim());
      }
    }
    return out;
  }

  private normalizarJid(peerId: string): string {
    if (peerId.includes('@')) return peerId;
    const digits = peerId.replace(/\D/g, '');
    return `${digits}@s.whatsapp.net`;
  }

  private jidParaTelefone(jid: string): string | undefined {
    const m = jid.match(/^(\d+)(?::\d+)?@/);
    return m ? m[1] : undefined;
  }

  /**
   * Resolve o telefone REAL do contato a partir do key da mensagem.
   *
   * No WhatsApp moderno (Baileys 7) o `remoteJid` muitas vezes vem como LID
   * (`<id>@lid` — número oculto por privacidade). Nesses casos o telefone
   * verdadeiro vem em `remoteJidAlt` (`<telefone>@s.whatsapp.net`).
   * Estratégia: preferimos sempre o JID de telefone (`@s.whatsapp.net`); se só
   * houver LID/grupo (número realmente oculto), retorna undefined (sem telefone).
   */
  private telefoneRealDoKey(remoteJid: string, key: proto.IMessageKey): string | undefined {
    const alt = (key as { remoteJidAlt?: string }).remoteJidAlt;
    const candidatos = [remoteJid, alt].filter((j): j is string => !!j);
    const pn = candidatos.find((j) => j.endsWith('@s.whatsapp.net'));
    if (pn) return this.jidParaTelefone(pn);
    const comum = candidatos.find(
      (j) => !j.endsWith('@lid') && !j.endsWith('@g.us') && !j.endsWith('@broadcast'),
    );
    return comum ? this.jidParaTelefone(comum) : undefined;
  }

  private infoVazia(
    owner: WhatsAppOwner,
    empresaId: string,
    status: WhatsAppSessionStatus,
    erro?: string,
  ): WhatsAppSessionInfo {
    return {
      ownerType: owner.type,
      ownerId: owner.id,
      empresaId,
      status,
      erro,
      desde: new Date(),
    };
  }
}
