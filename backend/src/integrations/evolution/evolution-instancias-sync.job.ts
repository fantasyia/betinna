import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EnvService } from '@config/env.service';
import { RedisService } from '@database/redis.service';
import { CronLockService } from '@shared/utils/cron-lock.service';
import { IntegracaoStatusService } from '@modules/integracoes/integracao-status.service';
import { EvolutionInstanciaService } from './evolution-instancia.service';
import { EvolutionService } from './evolution.service';

/**
 * Cron de SYNC das instâncias Evolution (a cada 10min). O webhook CONNECTION_UPDATE já mantém a
 * tabela fresca em TEMPO-REAL, mas instâncias que não MUDAM de estado (ex.: já `open` há muito) nunca
 * disparam o evento — o sync garante que a tabela reflita TODAS as instâncias + o ownerJid atual.
 *
 * AUTO-RESET de zumbi (open + disconnectionReasonCode = deslogado/travado): com GUARD de 2 ciclos
 * consecutivos (~20min) via contador Redis pra não resetar num glitch transiente. Confirmado →
 * `resetarForte` (restart+logout+delete, destrutivo) + alerta o diretor pra re-parear + marca close
 * na tabela. Saudável → zera o contador.
 *
 * Só roda com WHATSAPP_PROVIDER=evolution + lock distribuído (um processo por janela).
 */
@Injectable()
export class EvolutionInstanciasSyncJob {
  private readonly logger = new Logger(EvolutionInstanciasSyncJob.name);

  constructor(
    private readonly evolution: EvolutionService,
    private readonly instancias: EvolutionInstanciaService,
    private readonly env: EnvService,
    private readonly cronLock: CronLockService,
    private readonly redis: RedisService,
    private readonly status: IntegracaoStatusService,
  ) {}

  @Cron('*/10 * * * *', { name: 'evolution-instancias-sync' })
  async sincronizar(): Promise<void> {
    if (this.env.get('NODE_ENV') === 'test') return;
    if (this.env.get('WHATSAPP_PROVIDER') !== 'evolution') return;
    // Lock 9min (< intervalo 10min) → um só processo sincroniza por janela.
    if (!(await this.cronLock.acquire('evolution-instancias-sync', 540))) return;
    try {
      const lista = await this.evolution.listarInstanciasDetalhadas();
      let zumbis = 0;
      for (const i of lista) {
        await this.instancias.sincronizarConexao(i.name, i.connectionStatus ?? 'close', i.ownerJid);
        // Zumbi = 'open' mas com motivo de desconexão (deslogado/travado).
        if (i.connectionStatus === 'open' && i.disconnectionReasonCode != null) {
          zumbis += 1;
          await this.tratarZumbi(i.name);
        } else {
          // Saudável → zera o contador de detecções consecutivas.
          await this.redis.del(`evo:zumbi:${i.name}`).catch(() => undefined);
        }
      }
      if (lista.length > 0) {
        this.logger.log(
          `[evolution] sync de instâncias: ${lista.length} sincronizada(s), ${zumbis} zumbi(s)`,
        );
      }
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[evolution] sync de instâncias falhou: ${m}`);
    }
  }

  /**
   * Trata um candidato a zumbi com GUARD de 2 detecções consecutivas (contador Redis, TTL 25min) —
   * evita resetar num glitch transiente. Confirmado: resetarForte (destrutivo) + marca close + alerta.
   */
  private async tratarZumbi(instance: string): Promise<void> {
    const key = `evo:zumbi:${instance}`;
    const n = await this.redis.incr(key);
    if (n === 1) await this.redis.client.expire(key, 1500); // TTL 25min só na criação (> 2 ciclos)
    if (n < 2) {
      this.logger.warn(`[evolution] ${instance} candidato a ZUMBI (1ª detecção — confirmando)`);
      return;
    }
    this.logger.warn(`[evolution] ${instance} ZUMBI confirmado (2 ciclos) → resetarForte + alerta`);
    await this.evolution.resetarForte(instance).catch(() => undefined);
    await this.instancias.sincronizarConexao(instance, 'close'); // tabela reflete o reset
    await this.redis.del(key).catch(() => undefined);
    // Alerta o diretor pra re-parear (instâncias de empresa têm canal de status próprio).
    const emp = /^emp_(.+)$/.exec(instance);
    if (emp) {
      await this.status
        .marcarDesconectado(
          emp[1],
          'whatsapp',
          'Sessão WhatsApp caiu (zumbi) e foi resetada automaticamente — reconecte escaneando o QR.',
        )
        .catch(() => undefined);
    }
  }
}
