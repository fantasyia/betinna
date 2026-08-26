import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EnvService } from '@config/env.service';
import { PrismaService } from '@database/prisma.service';
import { IntegracoesService } from '@modules/integracoes/integracoes.service';
import { CronLockService } from '@shared/utils/cron-lock.service';
import { TinyOAuthService, MARGEM_REFRESH_MS } from './tiny-oauth.service';
import type { TinyCredenciais } from './tiny.types';

/**
 * Mantém a conexão com o Tiny VIVA sem depender de tráfego.
 *
 * O refresh token do Tiny dura **1 dia** (o access, 4h). Os outros OAuth do
 * sistema toleram renovar só sob demanda porque o refresh deles dura de 30 dias
 * a 1 ano; aqui, um fim de semana sem ninguém mexer no sistema mata a conexão —
 * e mata em silêncio, que é o pior jeito: ninguém descobre até um pedido não
 * subir pro ERP na segunda de manhã.
 *
 * De 3 em 3 horas: renova quem está perto de vencer (menos de 12h de refresh
 * restante = duas rodadas de folga), e ALERTA quando não dá mais pra salvar.
 */
@Injectable()
export class TinyTokenRefreshJob {
  private readonly logger = new Logger(TinyTokenRefreshJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly cronLock: CronLockService,
    private readonly oauth: TinyOAuthService,
    private readonly integracoes: IntegracoesService,
  ) {}

  @Cron('0 */3 * * *', { name: 'tiny-token-refresh', timeZone: 'UTC' })
  async renovarTokens(): Promise<void> {
    if (this.env.get('NODE_ENV') === 'test') return;
    // TTL 10min: a rodada é curta (uma chamada HTTP por empresa conectada) e o
    // lock só existe pra api e worker não renovarem em paralelo — o que
    // rotacionaria o refresh duas vezes e derrubaria a conexão.
    if (!(await this.cronLock.acquire('tiny-token-refresh', 10 * 60))) return;

    const conexoes = await this.prisma.integracaoConexao.findMany({
      where: { servico: 'tiny', ativo: true },
      select: { empresaId: true },
    });
    if (conexoes.length === 0) return;

    for (const { empresaId } of conexoes) {
      try {
        const conn = await this.integracoes.obterCredenciaisInternas(empresaId, 'tiny');
        const c = conn.credenciais as Partial<TinyCredenciais>;
        if (!c.refreshToken || !c.refreshExpiresAt) {
          this.logger.warn(`Tiny empresa=${empresaId}: credencial incompleta — pulando`);
          continue;
        }

        const restante = c.refreshExpiresAt - Date.now();
        if (restante <= 0) {
          // Já morreu: renovar é impossível, só reconectar pelo navegador. O
          // alerta é o produto aqui — sem ele, a descoberta vem por um pedido
          // que não subiu.
          await this.integracoes
            .marcarDesconectado(
              empresaId,
              'tiny',
              'refresh_token do Tiny expirou (dura 1 dia) — reconecte o ERP em Integrações',
            )
            .catch(() => undefined);
          this.logger.error(`Tiny empresa=${empresaId}: refresh VENCIDO — precisa reconectar`);
          continue;
        }
        if (restante > MARGEM_REFRESH_MS) continue; // ainda tem folga

        await this.oauth.renovar(empresaId, c);
        this.logger.log(
          `Tiny empresa=${empresaId}: tokens renovados (faltavam ${Math.round(restante / 60_000)}min de refresh)`,
        );
      } catch (err) {
        // Isolamento por empresa: erro num tenant não pode impedir a renovação
        // dos outros — cada um tem seu próprio relógio de 1 dia correndo.
        this.logger.error(
          `Falha ao renovar Tiny empresa=${empresaId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
}
