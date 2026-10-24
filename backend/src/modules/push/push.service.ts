import { Injectable, Logger } from '@nestjs/common';
import * as webpush from 'web-push';
import { EnvService } from '@config/env.service';
import { PrismaService } from '@database/prisma.service';

/** O que aparece na notificação do aparelho. `url` abre ao tocar. */
export interface PushPayload {
  titulo: string;
  corpo: string;
  url?: string;
  /** Mesma tag substitui a notificação anterior (não empilha). */
  tag?: string;
}

/**
 * Web Push (24/10): notificação no celular e no PC com o app FECHADO.
 * Cada aparelho se inscreve uma vez (botão no Perfil); o envio é melhor esforço:
 * push nunca derruba quem chamou. Aparelho que o provedor diz que sumiu
 * (404/410) sai da lista.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private configurado = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
  ) {
    const pub = this.env.get('VAPID_PUBLIC_KEY');
    const priv = this.env.get('VAPID_PRIVATE_KEY');
    if (pub && priv) {
      webpush.setVapidDetails(this.env.get('VAPID_SUBJECT'), pub, priv);
      this.configurado = true;
    }
  }

  ativo(): boolean {
    return this.configurado;
  }

  chavePublica(): string | null {
    return this.configurado ? this.env.get('VAPID_PUBLIC_KEY') : null;
  }

  async inscrever(
    usuarioId: string,
    empresaId: string | null,
    s: { endpoint: string; p256dh: string; auth: string; userAgent?: string | null },
  ): Promise<void> {
    await this.prisma.pushInscricao.upsert({
      where: { endpoint: s.endpoint },
      create: {
        usuarioId,
        empresaId,
        endpoint: s.endpoint,
        p256dh: s.p256dh,
        auth: s.auth,
        userAgent: s.userAgent?.slice(0, 300) ?? null,
      },
      update: { usuarioId, empresaId, p256dh: s.p256dh, auth: s.auth },
    });
  }

  async desinscrever(usuarioId: string, endpoint: string): Promise<void> {
    await this.prisma.pushInscricao.deleteMany({ where: { usuarioId, endpoint } });
  }

  async aparelhosDo(usuarioId: string): Promise<number> {
    return this.prisma.pushInscricao.count({ where: { usuarioId } });
  }

  /** Manda pra TODOS os aparelhos desses usuários. Devolve quantos entregou. */
  async enviar(usuarioIds: string[], payload: PushPayload): Promise<number> {
    if (!this.configurado || usuarioIds.length === 0) return 0;
    const alvos = await this.prisma.pushInscricao.findMany({
      where: { usuarioId: { in: usuarioIds } },
    });
    const corpo = JSON.stringify(payload);
    let ok = 0;
    for (const a of alvos) {
      try {
        await webpush.sendNotification(
          { endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth } },
          corpo,
          { TTL: 6 * 3600 },
        );
        ok++;
        await this.prisma.pushInscricao
          .update({ where: { id: a.id }, data: { ultimoUsoEm: new Date() } })
          .catch(() => undefined);
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await this.prisma.pushInscricao.delete({ where: { id: a.id } }).catch(() => undefined);
          this.logger.log(`[push] aparelho ${a.id} saiu (provedor respondeu ${status})`);
        } else {
          this.logger.warn(`[push] falhou pro aparelho ${a.id}: ${String(err)}`);
        }
      }
    }
    return ok;
  }
}
