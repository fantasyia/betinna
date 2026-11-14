import { Injectable, Logger } from '@nestjs/common';
import { IncidentsService } from '@modules/incidents/incidents.service';
import { MagaluClientService } from './magalu-client.service';
import { incidenteDoTicket } from './magalu-sac';
import type { MagaluLista, MagaluTicket } from './magalu.types';

const PAGINA = 50;
const MAX_PAGINAS = 10;

/**
 * SAC do Magalu → incidentes (14/11), só leitura: abre/atualiza o incidente
 * pelo ticket; responder segue no painel do Magalu (ou pelo magalu_api quando
 * a escrita de SAC for liberada). Doc: developers.magalu.com/docs/apis/sac/overview
 */
@Injectable()
export class MagaluSacService {
  private readonly logger = new Logger(MagaluSacService.name);

  constructor(
    private readonly magalu: MagaluClientService,
    private readonly incidents: IncidentsService,
  ) {}

  async sincronizar(empresaId: string, desde: Date): Promise<{ tickets: number }> {
    let n = 0;
    for (let pag = 0; pag < MAX_PAGINAS; pag++) {
      const r = await this.magalu.get<MagaluLista<MagaluTicket>>(empresaId, '/seller/v0/tickets', {
        updated_at_gte: desde.toISOString(),
        _offset: pag * PAGINA,
        _limit: PAGINA,
      });
      const tickets = r.results ?? [];
      for (const t of tickets) {
        try {
          await this.incidents.registrarIncidente(incidenteDoTicket(empresaId, t));
          n++;
        } catch (err) {
          this.logger.warn(`[Magalu] ticket ${t.id} não gravou: ${String(err)}`);
        }
      }
      if (tickets.length < PAGINA) break;
    }
    return { tickets: n };
  }
}
