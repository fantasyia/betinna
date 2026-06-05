import { Injectable, Logger } from '@nestjs/common';
import type { proto } from '@whiskeysockets/baileys';
import { PrismaService } from '@database/prisma.service';
import { InboxService } from '@modules/inbox/inbox.service';
import { WhatsAppSessionService } from '@integrations/whatsapp/whatsapp-session.service';
import { WhatsAppMediaService } from '@integrations/whatsapp/whatsapp-media.service';
import { EvolutionService } from './evolution.service';

/** Mensagem como o Evolution entrega no webhook messages.upsert (formato Baileys). */
interface EvoMessage {
  key?: {
    remoteJid?: string;
    fromMe?: boolean;
    id?: string;
    participant?: string;
    /** WhatsApp LID: telefone real quando remoteJid vem como `<id>@lid`. */
    remoteJidAlt?: string;
  };
  pushName?: string;
  message?: proto.IMessage;
  messageType?: string;
  messageTimestamp?: number;
  /** Mídia em base64 (quando a instância tem webhook base64:true). */
  base64?: string;
}

/**
 * Processa os eventos que o Evolution manda no webhook. REUSA o parser do
 * Baileys (`WhatsAppSessionService.extrairConteudo`) — o Evolution entrega a
 * mensagem no MESMO formato. Mapeia a instância (`emp_<id>`/`user_<id>`) de
 * volta pro dono (dual-owner) e joga no `InboxService` igual ao Baileys.
 *
 * QR e estado de conexão ficam num cache em memória pra a tela /whatsapp ler.
 */
@Injectable()
export class EvolutionInboundService {
  private readonly logger = new Logger(EvolutionInboundService.name);
  /** Último QR (base64) por instância — a tela de conectar lê daqui. */
  private readonly qrPorInstancia = new Map<string, { base64: string; em: number }>();
  /** Último estado de conexão por instância. */
  private readonly estadoPorInstancia = new Map<string, string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly inbox: InboxService,
    private readonly session: WhatsAppSessionService,
    private readonly media: WhatsAppMediaService,
    private readonly evolution: EvolutionService,
  ) {}

  /**
   * FALLBACK (cron): puxa as mensagens recentes de cada instância e reprocessa
   * idempotente. Cobre o que o webhook do Evolution PERDE quando o socket dele
   * oscila — a mensagem fica salva no banco do Evolution mas o webhook não
   * dispara. Janela 45s–12min: dá tempo do webhook entregar as novas (evita
   * corrida + bot em dobro) e a dedup por externalId garante zero duplicata.
   */
  async sincronizarRecentes(): Promise<void> {
    const instancias = await this.evolution.listarInstancias();
    if (instancias.length === 0) return;
    const agora = Date.now();
    const PISO = 45_000; // 45s — webhook já teve a chance dele
    const TETO = 12 * 60_000; // 12min — não revarre histórico antigo
    let total = 0;
    for (const instance of instancias) {
      const records = (await this.evolution.mensagensRecentes(instance, 30)) as EvoMessage[];
      const recentes = records.filter((m) => {
        const ts = m.messageTimestamp ? Number(m.messageTimestamp) * 1000 : 0;
        const idade = agora - ts;
        return ts > 0 && idade >= PISO && idade <= TETO;
      });
      if (recentes.length === 0) continue;
      await this.onMensagem(instance, { messages: recentes }).catch((err) => {
        this.logger.warn(
          `[evolution] sync ${instance}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
      total += recentes.length;
    }
    if (total > 0) this.logger.debug(`[evolution] poll fallback varreu ${total} msg(s) recentes`);
  }

  qrDe(instance: string): string | undefined {
    const q = this.qrPorInstancia.get(instance);
    // QR do WhatsApp expira em ~60s; descarta se velho.
    return q && Date.now() - q.em < 60_000 ? q.base64 : undefined;
  }

  estadoDe(instance: string): string | undefined {
    return this.estadoPorInstancia.get(instance);
  }

  /** Ponto de entrada — roteia pelo `event` do payload. */
  async processarEvento(body: {
    event?: string;
    instance?: string;
    data?: unknown;
  }): Promise<void> {
    const evento = (body.event ?? '').toLowerCase();
    const instance = body.instance ?? '';
    if (!instance) return;
    try {
      if (evento === 'messages.upsert') {
        await this.onMensagem(instance, body.data as EvoMessage | { messages?: EvoMessage[] });
      } else if (evento === 'connection.update') {
        const estado = (body.data as { state?: string })?.state ?? '?';
        this.estadoPorInstancia.set(instance, estado);
        this.logger.log(`[evolution] ${instance} conexão: ${estado}`);
      } else if (evento === 'qrcode.updated') {
        const d = body.data as { qrcode?: { base64?: string }; base64?: string };
        const base64 = d?.qrcode?.base64 ?? d?.base64;
        if (base64) {
          this.qrPorInstancia.set(instance, { base64, em: Date.now() });
          this.logger.log(`[evolution] ${instance} QR atualizado`);
        }
      }
    } catch (err) {
      this.logger.warn(
        `[evolution] falha no evento ${evento} (${instance}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async onMensagem(
    instance: string,
    data: EvoMessage | { messages?: EvoMessage[] },
  ): Promise<void> {
    // O Evolution pode mandar uma msg só ou um array.
    const msgs: EvoMessage[] = Array.isArray((data as { messages?: EvoMessage[] }).messages)
      ? ((data as { messages?: EvoMessage[] }).messages as EvoMessage[])
      : [data as EvoMessage];
    const dono = this.parseInstancia(instance);
    if (!dono) return;
    const empresaId = await this.resolverEmpresaId(dono);
    if (!empresaId) return;
    const proprietarioId = dono.type === 'USUARIO' ? dono.id : undefined;

    for (const m of msgs) {
      const rjid = m.key?.remoteJid ?? '';
      // WhatsApp LID: o remoteJid vem como `<id>@lid` (ID opaco) e o telefone
      // real fica em remoteJidAlt. Prefere o telefone (@s.whatsapp.net) — é
      // estável e casa o cliente por sufixo; senão a conversa fica "sem contato".
      const rjidAlt = m.key?.remoteJidAlt ?? '';
      const peerId = rjid.endsWith('@lid') && rjidAlt ? rjidAlt : rjid;
      if (
        !peerId ||
        peerId.endsWith('@broadcast') ||
        peerId === 'status@broadcast' ||
        peerId.endsWith('@g.us') // grupos: WhatsApp é 1:1 no nosso modelo
      )
        continue;

      const fromMe = !!m.key?.fromMe;
      const { conteudo, tipo, mediaMime, extras } = this.session.extrairConteudo(m.message);

      // Mídia em base64 (webhook base64:true) → sobe pro Supabase = mesma UX do Baileys.
      let mediaUrl: string | undefined;
      if (m.base64 && tipo !== 'TEXT' && tipo !== 'LOCATION' && tipo !== 'CONTACT') {
        const buf = Buffer.from(m.base64, 'base64');
        const path = await this.media
          .uploadOutbound(empresaId, peerId, buf, mediaMime, m.key?.id ?? undefined)
          .catch(() => null);
        mediaUrl = path ?? undefined;
      }

      const conteudoFinal = conteudo || (tipo === 'TEXT' ? '[mensagem não suportada]' : conteudo);
      if (!conteudoFinal) continue;

      await this.inbox.processarMensagemEntrante({
        empresaId,
        canal: 'WHATSAPP',
        peerId,
        peerNome: fromMe ? undefined : (m.pushName ?? undefined),
        peerTelefone: this.telefone(peerId),
        tipo,
        conteudo: conteudoFinal,
        externalId: m.key?.id ?? undefined,
        data: m.messageTimestamp ? new Date(Number(m.messageTimestamp) * 1000) : undefined,
        proprietarioId,
        direction: fromMe ? 'OUTBOUND' : 'INBOUND',
        ...(mediaUrl ? { mediaUrl } : {}),
        ...(mediaMime ? { mediaMime } : {}),
        meta: { ...(extras ?? {}), jid: peerId, provider: 'evolution' },
      });
    }
  }

  /** `emp_<id>` → EMPRESA · `user_<id>` → USUARIO. */
  private parseInstancia(instance: string): { type: 'EMPRESA' | 'USUARIO'; id: string } | null {
    const m = /^(emp|user)_(.+)$/.exec(instance);
    if (!m) return null;
    return { type: m[1] === 'emp' ? 'EMPRESA' : 'USUARIO', id: m[2] };
  }

  private async resolverEmpresaId(dono: {
    type: 'EMPRESA' | 'USUARIO';
    id: string;
  }): Promise<string | undefined> {
    if (dono.type === 'EMPRESA') return dono.id;
    // USUARIO: empresa vinculada (primeira).
    const u = await this.prisma.usuario.findUnique({
      where: { id: dono.id },
      select: { empresas: { select: { empresaId: true }, take: 1 } },
    });
    return u?.empresas[0]?.empresaId;
  }

  private telefone(jid: string): string | undefined {
    const m = jid.match(/^(\d+)(?::\d+)?@/);
    return m ? m[1] : undefined;
  }
}
