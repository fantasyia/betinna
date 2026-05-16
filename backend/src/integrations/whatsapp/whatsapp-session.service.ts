import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Boom } from '@hapi/boom';
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  type ConnectionState,
  type WASocket,
  type proto,
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import { EnvService } from '@config/env.service';
import { PrismaService } from '@database/prisma.service';
import { InboxService } from '@modules/inbox/inbox.service';
import { BusinessRuleException } from '@shared/errors/app-exception';
import { WhatsAppAuthState, ownerKey, type WhatsAppOwner } from './whatsapp-auth-state';
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
}

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
  ) {}

  // ─── Lifecycle ────────────────────────────────────────────────────────

  async onModuleInit(): Promise<void> {
    if (this.env.get('NODE_ENV') === 'test') return;
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
    const ctx = this.sessions.get(ownerKey(owner));
    if (!ctx || ctx.info.status !== 'CONNECTED') {
      throw new BusinessRuleException(`Sessão WhatsApp ${ownerKey(owner)} não está conectada`);
    }
    const jid = this.normalizarJid(peerId);
    const r = await ctx.sock.sendMessage(jid, { text: texto });
    return { externalId: r?.key?.id ?? undefined };
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

    const sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys),
      },
      printQRInTerminal: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      logger: { level: 'silent', child: () => ({}) as any } as any,
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
    };
    this.sessions.set(key, ctx);

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (u) => {
      this.handleConnectionUpdate(ctx, u);
    });

    sock.ev.on('messages.upsert', (u) => {
      if (u.type !== 'notify') return;
      void this.handleMensagensEntrantes(ctx, u.messages).catch((err) => {
        const m = err instanceof Error ? err.message : String(err);
        this.logger.warn(`[${ownerKey(ctx.owner)}] Falha processando msgs entrantes: ${m}`);
      });
    });
  }

  private handleConnectionUpdate(ctx: SessionContext, u: Partial<ConnectionState>): void {
    const key = ownerKey(ctx.owner);
    if (u.qr) {
      ctx.info.status = 'QR_PENDING';
      ctx.info.qrRaw = u.qr;
      ctx.info.desde = new Date();
      QRCode.toDataURL(u.qr, { errorCorrectionLevel: 'M', margin: 1, width: 320 })
        .then((dataUrl) => {
          ctx.info.qrDataUrl = dataUrl;
        })
        .catch(() => undefined);
      this.logger.log(`[${key}] QR code disponível`);
    }
    if (u.connection === 'open') {
      ctx.info.status = 'CONNECTED';
      ctx.info.desde = new Date();
      ctx.info.qrDataUrl = undefined;
      ctx.info.qrRaw = undefined;
      ctx.info.numero = ctx.sock.user?.id;
      ctx.reconectTentativas = 0;
      this.logger.log(`[${key}] WhatsApp conectado (${ctx.info.numero ?? '?'})`);
    }
    if (u.connection === 'close') {
      const code = (u.lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      if (loggedOut) {
        ctx.info.status = 'LOGGED_OUT';
        ctx.info.desde = new Date();
        this.logger.warn(`[${key}] WhatsApp deslogado — exige novo QR`);
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

  private async handleMensagensEntrantes(
    ctx: SessionContext,
    mensagens: proto.IWebMessageInfo[],
  ): Promise<void> {
    for (const m of mensagens) {
      if (!m.key) continue;
      if (m.key.fromMe) continue;
      const peerId = m.key.remoteJid ?? '';
      if (!peerId) continue;
      if (peerId.endsWith('@g.us') || peerId.endsWith('@broadcast')) continue;
      if (peerId === 'status@broadcast') continue;

      const { conteudo, tipo, mediaMime } = this.extrairConteudo(m.message);
      if (!conteudo && tipo === 'TEXT') continue;

      // Quando owner=USUARIO, passa proprietarioId pra Conversation ficar
      // atrelada à sessão do rep. Empresa = null (conversa "compartilhada").
      const proprietarioId = ctx.owner.type === 'USUARIO' ? ctx.owner.id : undefined;

      await this.inbox.processarMensagemEntrante({
        empresaId: ctx.empresaId,
        canal: 'WHATSAPP',
        peerId,
        peerNome: m.pushName ?? undefined,
        peerTelefone: this.jidParaTelefone(peerId),
        tipo,
        conteudo,
        externalId: m.key.id ?? undefined,
        data: m.messageTimestamp ? new Date(Number(m.messageTimestamp) * 1000) : undefined,
        mediaMime,
        proprietarioId,
        meta: { jid: peerId, ownerKey: ownerKey(ctx.owner) },
      });
    }
  }

  private extrairConteudo(msg: proto.IMessage | null | undefined): {
    conteudo: string;
    tipo: 'TEXT' | 'IMAGE' | 'AUDIO' | 'VIDEO' | 'DOCUMENT' | 'STICKER' | 'LOCATION' | 'CONTACT';
    mediaMime?: string;
  } {
    if (!msg) return { conteudo: '', tipo: 'TEXT' };
    if (msg.conversation) return { conteudo: msg.conversation, tipo: 'TEXT' };
    if (msg.extendedTextMessage?.text) {
      return { conteudo: msg.extendedTextMessage.text, tipo: 'TEXT' };
    }
    if (msg.imageMessage) {
      return {
        conteudo: msg.imageMessage.caption ?? '[imagem]',
        tipo: 'IMAGE',
        mediaMime: msg.imageMessage.mimetype ?? undefined,
      };
    }
    if (msg.videoMessage) {
      return {
        conteudo: msg.videoMessage.caption ?? '[vídeo]',
        tipo: 'VIDEO',
        mediaMime: msg.videoMessage.mimetype ?? undefined,
      };
    }
    if (msg.audioMessage) {
      return {
        conteudo: '[áudio]',
        tipo: 'AUDIO',
        mediaMime: msg.audioMessage.mimetype ?? undefined,
      };
    }
    if (msg.documentMessage) {
      return {
        conteudo: msg.documentMessage.fileName ?? '[documento]',
        tipo: 'DOCUMENT',
        mediaMime: msg.documentMessage.mimetype ?? undefined,
      };
    }
    if (msg.stickerMessage) return { conteudo: '[sticker]', tipo: 'STICKER' };
    if (msg.locationMessage) {
      const lat = msg.locationMessage.degreesLatitude ?? 0;
      const lng = msg.locationMessage.degreesLongitude ?? 0;
      return { conteudo: `[localização] ${lat},${lng}`, tipo: 'LOCATION' };
    }
    if (msg.contactMessage) {
      return { conteudo: msg.contactMessage.displayName ?? '[contato]', tipo: 'CONTACT' };
    }
    return { conteudo: '', tipo: 'TEXT' };
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
