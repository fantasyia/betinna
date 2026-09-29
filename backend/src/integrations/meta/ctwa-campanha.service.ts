import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@database/redis.service';
import { IntegracoesService } from '@modules/integracoes/integracoes.service';
import { MetaGraphClientService } from './meta-graph-client.service';
import type { FacebookCredenciais } from './meta.types';

/** O anúncio muda pouco de campanha; o nome fica 7 dias em cache. */
const TTL_S = 7 * 86_400;
/** Resposta negativa (sem acesso / anúncio sumiu) fica 1h: não martela a Graph. */
const TTL_NEG_S = 3600;

/**
 * Click-to-WhatsApp → NOME da campanha no Meta (item 9 do card 📣, 29/09).
 *
 * O referral do WhatsApp traz o `sourceId` (id do anúncio) e a manchete do
 * criativo. A campanha que soma no relatório com Lead Ads e site é o NOME da
 * campanha — o mesmo que o Lead Ads resolve pelo `ad_id`. Aqui resolvemos pelo
 * `sourceId`, com o token da Página conectada DA EMPRESA (precisa `ads_read`).
 *
 * Sem conexão Meta, sem permissão ou sem resposta → `null`, e quem chama cai
 * na manchete MARCADA como tal (`campanhaFonte: 'manchete'`). Nunca estoura:
 * isto roda no caminho da mensagem entrante.
 */
@Injectable()
export class CtwaCampanhaService {
  private readonly logger = new Logger(CtwaCampanhaService.name);

  constructor(
    private readonly graph: MetaGraphClientService,
    private readonly integracoes: IntegracoesService,
    private readonly redis: RedisService,
  ) {}

  async nomeDaCampanha(empresaId: string, sourceId?: string | null): Promise<string | null> {
    if (!sourceId || !/^\d{5,30}$/.test(sourceId)) return null;
    const chave = `ctwa:campanha:${empresaId}:${sourceId}`;
    try {
      const hit = await this.redis.get(chave);
      if (hit !== null) return hit || null;
    } catch {
      // sem cache, segue
    }
    let nome: string | null = null;
    try {
      const conn = await this.integracoes.obterCredenciaisInternas(empresaId, 'facebook');
      const cred = conn.credenciais as unknown as FacebookCredenciais;
      const ad = await this.graph.obterAnuncio(sourceId, cred.pageAccessToken);
      nome = ad.campaign?.name?.trim() || null;
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `CTWA: não resolveu a campanha do anúncio ${sourceId} (empresa ${empresaId}): ${m}`,
      );
    }
    try {
      await this.redis.setEx(chave, nome ?? '', nome ? TTL_S : TTL_NEG_S);
    } catch {
      // cache é otimização
    }
    return nome;
  }
}
