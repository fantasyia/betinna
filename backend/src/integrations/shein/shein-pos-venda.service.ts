import { Injectable, Logger } from '@nestjs/common';
import { IncidentsService } from '@modules/incidents/incidents.service';
import { horaShein } from './shein-assinatura';
import { incidenteShein, type SheinPosVenda } from './shein-pos-venda';
import { SheinClientService } from './shein.client';

export interface SheinPosVendaResumo {
  aftersalesOrderNo: string;
  aftersalesOrderSubStatus?: number;
  requestTime?: string;
  updateTime?: string;
}

const JANELA_MS = 48 * 3_600_000;
const POR_PAGINA = 30;
const POR_DETALHE = 10;

/**
 * Pós-venda da Shein → Incidentes (Léo, 01/11). Lista em janelas de 48 h
 * (UTC+8), detalhe de 10 em 10, e cada caso vira MarketplaceIncident do canal
 * MARKETPLACE_SHEIN — a rotina de pendências avisa o que espera a loja.
 * A API da Shein não tem chat: o atendimento é este pós-venda.
 */
@Injectable()
export class SheinPosVendaService {
  private readonly logger = new Logger(SheinPosVendaService.name);

  constructor(
    private readonly shein: SheinClientService,
    private readonly incidents: IncidentsService,
  ) {}

  /** Uma janela de até 48 h. tipo 1 = abertos · 2 = atualizados. */
  async listarJanela(empresaId: string, ini: Date, fim: Date, tipo: 1 | 2) {
    const casos: SheinPosVendaResumo[] = [];
    let total = 0;
    for (let page = 1; page <= 334; page++) {
      const r = await this.shein.post<{ count?: number; list?: SheinPosVendaResumo[] }>(
        empresaId,
        '/open-api/after-sales-order/list',
        {
          queryType: tipo,
          startTime: horaShein(ini),
          endTime: horaShein(fim),
          page,
          pageSize: POR_PAGINA,
        },
      );
      total = r?.count ?? 0;
      const lista = r?.list ?? [];
      casos.push(...lista);
      if (lista.length < POR_PAGINA || casos.length >= total) break;
    }
    return { total, casos };
  }

  /** As últimas `horas` (máx. 48), cru — pra conferência. */
  listar(empresaId: string, horas: number, tipo: 1 | 2 = 2) {
    const fim = new Date();
    return this.listarJanela(
      empresaId,
      new Date(fim.getTime() - Math.min(horas, 48) * 3_600_000),
      fim,
      tipo,
    );
  }

  /** Detalhe de até 10 casos. */
  detalhe(empresaId: string, numeros: string[]) {
    return this.shein.post<SheinPosVenda[]>(empresaId, '/open-api/after-sales-order/details', {
      aftersalesOrderNos: numeros.slice(0, POR_DETALHE),
    });
  }

  /** Grava em Incidentes tudo de `desde` até agora, de 48 em 48 h. */
  async sincronizar(
    empresaId: string,
    desde: Date,
    tipo: 1 | 2,
  ): Promise<{ casos: number; falhas: number }> {
    const agora = Date.now();
    let n = 0;
    let falhas = 0;
    for (let ini = desde.getTime(); ini < agora; ini += JANELA_MS) {
      const fim = new Date(Math.min(ini + JANELA_MS, agora));
      const { casos } = await this.listarJanela(empresaId, new Date(ini), fim, tipo);
      const numeros = [...new Set(casos.map((c) => c.aftersalesOrderNo))];
      for (let i = 0; i < numeros.length; i += POR_DETALHE) {
        const detalhes = (await this.detalhe(empresaId, numeros.slice(i, i + POR_DETALHE))) ?? [];
        for (const d of detalhes) {
          try {
            await this.incidents.registrarIncidente({
              empresaId,
              canal: 'MARKETPLACE_SHEIN',
              ...incidenteShein(d),
              metadata: { shein_pos_venda: d },
            });
            n++;
          } catch (err) {
            falhas++;
            this.logger.warn(`[Shein] pós-venda ${d.aftersalesOrderNo} não gravou: ${String(err)}`);
          }
        }
      }
    }
    return { casos: n, falhas };
  }
}
