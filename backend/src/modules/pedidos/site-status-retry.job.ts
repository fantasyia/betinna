import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EnvService } from '@config/env.service';
import { PrismaService } from '@database/prisma.service';
import { CronLockService } from '@shared/utils/cron-lock.service';
import { SiteStatusService } from './site-status.service';

/** Teto por rodada: o site é de um tenant só, não adianta martelar. */
const MAX_POR_RODADA = 50;

/**
 * Reenvia pro site os pedidos cujo aviso falhou — de minuto em minuto.
 *
 * ## Por que isto existe
 *
 * O site devolve **503 + `Retry-After: 30`** quando o banco dele soluça, em vez
 * do 400 antigo. Isso foi de propósito (conserto de 09/09, `SOMATEC-WEB-3`):
 * 400 diz "não repita" e a atualização se perdia pra sempre. Só que **ninguém
 * escutava esse 503** — o lado de cá fazia uma retentativa imediata, logava um
 * warn e seguia, e o `pedido-erp-sync` ainda descartava o booleano.
 *
 * Pior: a rodada do ERP **não** tentava de novo. Ela só chega no aviso quando
 * `mudou`, e `mudou` compara o ERP com o NOSSO banco — que já tinha sido
 * atualizado antes do push. Push falhado ⇒ ERP == banco ⇒ `semMudanca` ⇒ o
 * aviso nunca mais saía. O cliente ficava olhando um status velho e ninguém
 * recebia erro nenhum.
 *
 * ## Por que de minuto em minuto, e não na rodada diária
 *
 * O `Retry-After` pede 30 segundos. A varredura diária (16:00 UTC) deixaria a
 * tela do cliente mentindo por até um dia inteiro por causa de um soluço de um
 * segundo. Um minuto é o mesmo ritmo do `ErpWebhooksJob` e já respeita os 30s.
 *
 * ## Por que não uma fila com atraso
 *
 * Job em Redis some se o Redis for limpo, e o que não pode sumir é justamente a
 * dívida com o site. O marcador mora no pedido (`siteErroEm`), no Postgres:
 * sobrevive a restart, deploy e flush de Redis. A fila daria latência menor; a
 * coluna dá garantia. Aqui a garantia vale mais — ninguém morre esperando 60s.
 */
@Injectable()
export class SiteStatusRetryJob {
  private readonly logger = new Logger(SiteStatusRetryJob.name);

  constructor(
    private readonly env: EnvService,
    private readonly prisma: PrismaService,
    private readonly cronLock: CronLockService,
    private readonly site: SiteStatusService,
  ) {}

  @Cron('* * * * *', { name: 'site-status-retry', timeZone: 'UTC' })
  async reenviar(): Promise<void> {
    if (this.env.get('NODE_ENV') === 'test') return;
    // Tenant sem site configurado não tem o que reenviar.
    if (!this.site.configurado) return;
    // TTL 50s: menor que o intervalo, pra uma rodada travada não bloquear a
    // seguinte pra sempre. Duas réplicas reenviariam o mesmo pedido — não
    // duplica dado (o site é idempotente por número), mas é chamada à toa.
    if (!(await this.cronLock.acquire('site-status-retry', 50))) return;

    try {
      const atrasados = await this.prisma.pedido.findMany({
        // `siteErroEm` não-nulo = houve uma tentativa que falhou. Pedido que
        // nunca foi empurrado (legado, anterior a estas colunas) fica de fora
        // de propósito: varrer todos seria despejar a base inteira no site.
        where: { siteErroEm: { not: null }, numeroSite: { not: null } },
        select: {
          id: true,
          numero: true,
          numeroSite: true,
          status: true,
          rastreioCodigo: true,
          rastreioUrl: true,
          siteStatusEnviado: true,
          siteRastreioEnviado: true,
        },
        orderBy: { siteErroEm: 'asc' },
        take: MAX_POR_RODADA,
      });
      if (atrasados.length === 0) return;

      let ok = 0;
      let falhou = 0;
      for (const p of atrasados) {
        try {
          const r = await this.site.sincronizarPedido(p);
          if (r === true) ok += 1;
          else if (r === false) falhou += 1;
          else {
            // `null` = o site já está em dia (ou o status não tem equivalente
            // lá). O erro é história velha: limpa, senão este pedido volta em
            // toda rodada pra sempre.
            await this.prisma.pedido.update({
              where: { id: p.id },
              data: { siteErro: null, siteErroEm: null },
            });
          }
        } catch (err) {
          // Um pedido problemático não pode derrubar a varredura: o resto da
          // dívida continua valendo.
          falhou += 1;
          this.logger.warn(
            `[site] reenvio do ${p.numero} falhou: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      this.logger.log(
        `[site] reenvio: ${ok}/${atrasados.length} aceitos` +
          (falhou ? `, ${falhou} pendentes` : ''),
      );
    } catch (err) {
      this.logger.error(
        `[site] varredura de reenvio falhou: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
