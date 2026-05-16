import { Injectable, Logger } from '@nestjs/common';
import type { MessageChannel } from '@prisma/client';
import type { CanalAdapter } from './inbox.types';

/**
 * Registro singleton onde os módulos de canal (WhatsApp, IG, FB, ...)
 * registram seus adapters no boot. O InboxService consulta esse registry
 * pra rotear envios pelo canal correto.
 *
 * Padrão: cada adapter module faz `registry.registrar(this)` em `onModuleInit`.
 */
@Injectable()
export class CanalAdapterRegistry {
  private readonly logger = new Logger(CanalAdapterRegistry.name);
  private readonly adapters = new Map<MessageChannel, CanalAdapter>();

  registrar(adapter: CanalAdapter): void {
    if (this.adapters.has(adapter.canal)) {
      this.logger.warn(`Adapter para canal ${adapter.canal} já registrado — sobrescrevendo`);
    }
    this.adapters.set(adapter.canal, adapter);
    this.logger.log(`Adapter registrado: ${adapter.canal}`);
  }

  obter(canal: MessageChannel): CanalAdapter | null {
    return this.adapters.get(canal) ?? null;
  }

  /** True se há adapter para o canal e ele está disponível para a empresa. */
  async disponivel(empresaId: string, canal: MessageChannel): Promise<boolean> {
    const a = this.adapters.get(canal);
    if (!a) return false;
    try {
      return await a.estaDisponivel(empresaId);
    } catch {
      return false;
    }
  }

  /** Lista canais com adapter registrado (não checa disponibilidade). */
  canaisRegistrados(): MessageChannel[] {
    return Array.from(this.adapters.keys());
  }
}
