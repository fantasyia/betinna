import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { EvolutionService } from './evolution.service';

/**
 * Persistência do estado das instâncias Evolution (tabela `EvolutionInstancia`). É a "verdade local"
 * espelhada do Evolution — alimentada em TEMPO-REAL pelo webhook CONNECTION_UPDATE. Antes o estado da
 * instância vivia só em memória (volátil) + no Evolution; agora há um registro durável (base p/
 * dashboard, sync/reconexão de zumbi e cleanup on-deactivation). Best-effort: nunca lança.
 */
@Injectable()
export class EvolutionInstanciaService {
  private readonly logger = new Logger(EvolutionInstanciaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly evolution: EvolutionService,
  ) {}

  /**
   * Cleanup on-deactivation: ao desativar uma empresa/rep, desconecta + deleta a instância no
   * Evolution e remove o registro local. Best-effort (nunca lança — não pode derrubar a desativação).
   * No-op se o provider não for Evolution.
   */
  async desativar(owner: { type: 'EMPRESA' | 'USUARIO'; id: string }): Promise<void> {
    const instanceName = EvolutionService.instanceName(owner);
    try {
      if (this.evolution.ativo()) {
        await this.evolution.logout(instanceName).catch(() => undefined);
        await this.evolution.deletar(instanceName).catch(() => undefined);
      }
      await this.remover(instanceName);
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Falha ao desativar instância ${instanceName}: ${m}`);
    }
  }

  /**
   * Upsert do estado de conexão a partir de um evento do Evolution (tipicamente CONNECTION_UPDATE).
   * Resolve empresa/usuário pelo `instanceName` (`emp_<empresaId>` | `user_<usuarioId>`).
   */
  async sincronizarConexao(
    instanceName: string,
    connectionStatus: string,
    ownerJid?: string | null,
  ): Promise<void> {
    try {
      const dono = this.parseInstancia(instanceName);
      if (!dono) return;
      const empresaId = await this.resolverEmpresaId(dono);
      if (!empresaId) return;
      const usuarioId = dono.type === 'USUARIO' ? dono.id : null;
      const agora = new Date();
      await this.prisma.evolutionInstancia.upsert({
        where: { instanceName },
        create: {
          instanceName,
          empresaId,
          usuarioId,
          connectionStatus,
          ownerJid: ownerJid ?? null,
          ultimoEventoEm: agora,
        },
        // Não sobrescreve empresaId/usuarioId (estáveis); ownerJid só quando vem preenchido.
        update: {
          connectionStatus,
          ultimoEventoEm: agora,
          ...(ownerJid ? { ownerJid } : {}),
        },
      });
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Falha ao sincronizar instância ${instanceName}: ${m}`);
    }
  }

  /** Remove o registro da instância (ao deletar/desconectar definitivo no Evolution). Best-effort. */
  async remover(instanceName: string): Promise<void> {
    try {
      await this.prisma.evolutionInstancia.deleteMany({ where: { instanceName } });
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Falha ao remover instância ${instanceName}: ${m}`);
    }
  }

  // Espelha o parse do evolution-inbound (emp_<id> | user_<id>).
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
    const u = await this.prisma.usuario.findUnique({
      where: { id: dono.id },
      select: { empresas: { select: { empresaId: true }, take: 1 } },
    });
    return u?.empresas[0]?.empresaId;
  }
}
