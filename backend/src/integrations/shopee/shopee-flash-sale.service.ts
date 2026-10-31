import { Injectable } from '@nestjs/common';
import { BusinessRuleException, ForbiddenException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { ShopeeClientService } from './shopee-client.service';

/**
 * Oferta Relâmpago da loja (shop_flash_sale) — Léo, 31/10.
 *
 * Passa direto pra Shopee com o app do Betinna (o único com o módulo
 * shop_flash_sale). Não guarda nada: a verdade é a Shopee. Criar, pôr item e
 * ativar mexem na loja de verdade — só com o "pode subir" do Léo pra oferta.
 */

export interface ModeloOferta {
  model_id?: number;
  /** Preço promocional final, em reais. */
  preco?: number;
  /** Desconto em % sobre o preço atual do model (alternativa ao preço). */
  desconto?: number;
  estoque: number;
  /** Só na edição: 1 ativo · 0 desativado. */
  status?: number;
}
export interface ItemOferta {
  item_id: number;
  purchase_limit?: number;
  models: ModeloOferta[];
}

interface Model {
  model_id: number;
  price_info?: Array<{ current_price?: number; original_price?: number }>;
  stock_info_v2?: { summary_info?: { total_available_stock?: number } };
  model_name?: string;
}

const P = '/api/v2/shop_flash_sale';

@Injectable()
export class ShopeeFlashSaleService {
  constructor(private readonly shopee: ShopeeClientService) {}

  private empresa(user: AuthenticatedUser): string {
    if (!['ADMIN', 'DIRECTOR'].includes(user.role) || !user.empresaIdAtiva) {
      throw new ForbiddenException('Só diretor ou admin mexe na Oferta Relâmpago');
    }
    return user.empresaIdAtiva;
  }

  /** type: 0 todas · 1 próximas · 2 em andamento · 3 encerradas. */
  listar(user: AuthenticatedUser, type: number, offset: number, limit: number) {
    return this.shopee.getShop(this.empresa(user), `${P}/get_shop_flash_sale_list`, {
      type,
      offset,
      limit,
    });
  }

  async ver(user: AuthenticatedUser, flashSaleId: number) {
    const e = this.empresa(user);
    const [oferta, itens] = await Promise.all([
      this.shopee.getShop(e, `${P}/get_shop_flash_sale`, { flash_sale_id: flashSaleId }),
      this.shopee.getShop(e, `${P}/get_shop_flash_sale_items`, {
        flash_sale_id: flashSaleId,
        offset: 0,
        limit: 100,
      }),
    ]);
    return { oferta, itens };
  }

  /** Horários (timeslot) disponíveis entre start e end, em segundos Unix. */
  horarios(user: AuthenticatedUser, startTime: number, endTime: number) {
    return this.shopee.getShop(this.empresa(user), `${P}/get_time_slot_id`, {
      start_time: startTime,
      end_time: endTime,
    });
  }

  criar(user: AuthenticatedUser, timeslotId: number) {
    return this.shopee.postShop(this.empresa(user), `${P}/create_shop_flash_sale`, {
      timeslot_id: timeslotId,
    });
  }

  /** Estoque e preço atuais dos models de um anúncio (regra: campanha = min(10, estoque)). */
  async modelos(user: AuthenticatedUser, itemId: number) {
    const r = await this.shopee.getShop<{ response?: { model?: Model[] } }>(
      this.empresa(user),
      '/api/v2/product/get_model_list',
      { item_id: itemId },
    );
    return (r.response?.model ?? []).map((m) => ({
      model_id: m.model_id,
      nome: m.model_name ?? null,
      preco_atual: m.price_info?.[0]?.current_price ?? null,
      preco_original: m.price_info?.[0]?.original_price ?? null,
      estoque: m.stock_info_v2?.summary_info?.total_available_stock ?? null,
    }));
  }

  async adicionarItens(user: AuthenticatedUser, flashSaleId: number, itens: ItemOferta[]) {
    const e = this.empresa(user);
    const items = await this.montarItens(user, itens, false);
    return this.shopee.postShop(e, `${P}/add_shop_flash_sale_items`, {
      flash_sale_id: flashSaleId,
      items,
    });
  }

  /** status do model: 1 ativo · 0 desativado (Shopee). */
  async editarItens(user: AuthenticatedUser, flashSaleId: number, itens: ItemOferta[]) {
    const e = this.empresa(user);
    const items = await this.montarItens(user, itens, true);
    return this.shopee.postShop(e, `${P}/update_shop_flash_sale_items`, {
      flash_sale_id: flashSaleId,
      items,
    });
  }

  /** 1 = ativa · 2 = desativa. */
  status(user: AuthenticatedUser, flashSaleId: number, status: 1 | 2) {
    return this.shopee.postShop(this.empresa(user), `${P}/update_shop_flash_sale`, {
      flash_sale_id: flashSaleId,
      status,
    });
  }

  /**
   * Item com variação manda `models`; sem variação (model_id ausente) manda
   * item_input_promo_price/item_stock. Desconto vira preço sobre o preço ATUAL
   * do model, lido na hora — nunca chute.
   */
  private async montarItens(user: AuthenticatedUser, itens: ItemOferta[], edicao: boolean) {
    const out: Record<string, unknown>[] = [];
    for (const it of itens) {
      const precisaPreco = it.models.some((m) => m.preco === undefined && m.desconto !== undefined);
      const atuais = precisaPreco ? await this.modelos(user, it.item_id) : [];
      const precoDe = (m: ModeloOferta): number | undefined => {
        if (m.preco !== undefined) return m.preco;
        if (m.desconto === undefined) return undefined;
        const base = atuais.find((a) => a.model_id === (m.model_id ?? 0))?.preco_atual;
        if (base == null) {
          throw new BusinessRuleException(
            `Sem preço atual pro model ${m.model_id ?? '(sem variação)'} do item ${it.item_id} — mande o preço`,
            ErrorCode.VALIDATION_ERROR,
          );
        }
        return Math.round(base * (1 - m.desconto / 100) * 100) / 100;
      };
      const semVariacao = it.models.length === 1 && it.models[0].model_id === undefined;
      if (semVariacao) {
        const m = it.models[0];
        out.push({
          item_id: it.item_id,
          purchase_limit: it.purchase_limit ?? 0,
          item_input_promo_price: precoDe(m),
          item_stock: m.estoque,
          ...(edicao && m.status !== undefined ? { item_status: m.status } : {}),
        });
        continue;
      }
      out.push({
        item_id: it.item_id,
        purchase_limit: it.purchase_limit ?? 0,
        models: it.models.map((m) => ({
          model_id: m.model_id,
          input_promo_price: precoDe(m),
          stock: m.estoque,
          ...(edicao && m.status !== undefined ? { status: m.status } : {}),
        })),
      });
    }
    return out;
  }
}
