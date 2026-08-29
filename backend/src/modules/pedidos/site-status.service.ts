import { Injectable, Logger } from '@nestjs/common';
import { EnvService } from '@config/env.service';
import { HttpClientService } from '@shared/http/http-client.service';

export interface StatusParaSite {
  numeroSite: string;
  status: string;
  rastreioCodigo?: string | null;
  rastreioUrl?: string | null;
}

/**
 * Avisa o SITE quando a situação ou o rastreio do pedido mudam.
 *
 * O site é dono da tela do cliente — é lá que a pessoa vai olhar "cadê meu
 * pedido". Sem este retorno, o pedido pago some do ponto de vista dela até
 * alguém responder no WhatsApp; com ele, a tela conta a verdade sozinha.
 *
 * **Best-effort de propósito.** Site fora do ar não pode derrubar a
 * sincronização com o ERP: o estado real mora aqui, e a rodada seguinte
 * reenvia. O que não pode é falhar em silêncio — por isso o log.
 */
@Injectable()
export class SiteStatusService {
  private readonly logger = new Logger(SiteStatusService.name);

  constructor(
    private readonly env: EnvService,
    private readonly http: HttpClientService,
  ) {}

  /** `false` quando não há site configurado — o tenant simplesmente não tem um. */
  get configurado(): boolean {
    return Boolean(this.env.get('SITE_PEDIDOS_STATUS_URL')) && Boolean(this.segredo);
  }

  private get segredo(): string {
    return this.env.get('SITE_PEDIDOS_STATUS_SECRET') ?? '';
  }

  async notificar(dados: StatusParaSite): Promise<boolean> {
    if (!this.configurado) return false;
    // Pedido que não nasceu no site não tem tela lá pra atualizar.
    if (!dados.numeroSite) return false;
    try {
      await this.http.post(this.env.get('SITE_PEDIDOS_STATUS_URL'), {
        body: {
          numero: dados.numeroSite,
          status: dados.status,
          rastreioCodigo: dados.rastreioCodigo ?? null,
          rastreioUrl: dados.rastreioUrl ?? null,
        },
        headers: { 'x-pedidos-secret': this.segredo },
        // Site fora do ar não pode segurar a rodada: 1 tentativa e segue.
        retries: 1,
        timeoutMs: 8000,
      });
      this.logger.log(`[site] ${dados.numeroSite} → ${dados.status} avisado`);
      return true;
    } catch (err) {
      this.logger.warn(
        `[site] não consegui avisar ${dados.numeroSite}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }
}
