import { Injectable, Logger } from '@nestjs/common';
import { BusinessRuleException, ForbiddenException } from '@shared/errors/app-exception';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { ShopeeClientService } from './shopee-client.service';
import { ShopeeFlashSaleService } from './shopee-flash-sale.service';

/**
 * Passthrough da Open API v2 da Shopee (Léo, 13/11 — pedido da sessão Shopee).
 * O Betinna assina com o app e o token da loja da empresa; quem chama manda
 * caminho, query e corpo e recebe a resposta crua.
 *
 * Travas (o resto é livre):
 *  - estoque vem do Magis5: rota de estoque é recusada; em criação (add_item,
 *    add_model, init_tier_variation) todo estoque vai ZERO; em qualquer outra
 *    escrita, campo de estoque recusa;
 *  - Full: escrita em anúncio que tem Full é recusada (menos add_item/add_model,
 *    que não tocam no que já existe); rotas `fbs` não escrevem;
 *  - add_item nasce DESLISTADO;
 *  - auth/public/push ficam fora (token e webhook da loja são do Betinna).
 */
export const CAMINHO_SHOPEE = /^\/api\/v2\/[a-z0-9_]+\/[a-z0-9_]+$/;
const RESERVADOS = new Set(['partner_id', 'timestamp', 'access_token', 'shop_id', 'sign']);
const MODULOS_FORA = new Set(['auth', 'public', 'push']);
const CRIACAO = new Set([
  '/api/v2/product/add_item',
  '/api/v2/product/add_model',
  '/api/v2/product/init_tier_variation',
]);
/** Escritas que acrescentam sem tocar no que existe — passam mesmo com Full. */
const SEM_CHECAR_FULL = new Set(['/api/v2/product/add_item', '/api/v2/product/add_model']);
const MAX_ITENS_CHECADOS = 50;

type Valor = string | number | boolean | Array<string | number>;

/** Qualquer chave com "stock", em qualquer nível. */
export function temEstoque(valor: unknown): boolean {
  if (Array.isArray(valor)) return valor.some(temEstoque);
  if (valor === null || typeof valor !== 'object') return false;
  return Object.entries(valor).some(([k, v]) => /stock/i.test(k) || temEstoque(v));
}

/** Cópia com todo estoque em zero: `seller_stock[].stock` e números em chave de estoque. */
export function zerarEstoque(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(zerarEstoque);
  if (valor === null || typeof valor !== 'object') return valor;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(valor)) {
    if (k === 'seller_stock' && Array.isArray(v)) {
      out[k] = v.map((s) =>
        s && typeof s === 'object' ? { ...(s as object), stock: 0 } : { stock: 0 },
      );
    } else if (/stock/i.test(k) && typeof v === 'number') {
      out[k] = 0;
    } else {
      out[k] = zerarEstoque(v);
    }
  }
  return out;
}

/** item_id, item_id_list e item_list[].item_id do corpo. */
export function itensDoCorpo(corpo: Record<string, unknown>): number[] {
  const ids: unknown[] = [];
  if (corpo.item_id !== undefined) ids.push(corpo.item_id);
  if (Array.isArray(corpo.item_id_list)) ids.push(...corpo.item_id_list);
  if (Array.isArray(corpo.item_list)) {
    for (const i of corpo.item_list) {
      if (i && typeof i === 'object') ids.push((i as { item_id?: unknown }).item_id);
    }
  }
  return [...new Set(ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
}

@Injectable()
export class ShopeeApiService {
  private readonly logger = new Logger(ShopeeApiService.name);

  constructor(
    private readonly shopee: ShopeeClientService,
    private readonly anuncios: ShopeeFlashSaleService,
  ) {}

  private empresa(user: AuthenticatedUser): string {
    if (!['ADMIN', 'DIRECTOR'].includes(user.role) || !user.empresaIdAtiva) {
      throw new ForbiddenException('Só diretor ou admin chama a API da Shopee');
    }
    return user.empresaIdAtiva;
  }

  private validarCaminho(caminho: string) {
    if (!CAMINHO_SHOPEE.test(caminho)) {
      throw new BusinessRuleException('Caminho deve ser /api/v2/<modulo>/<acao>');
    }
    const modulo = caminho.split('/')[3];
    if (MODULOS_FORA.has(modulo)) {
      throw new BusinessRuleException(`Módulo ${modulo} fica com o Betinna, não passa aqui`);
    }
    return modulo;
  }

  /** Lista vira parâmetro repetido; quem quer vírgula (item_id_list) manda string. */
  private query(q: Record<string, Valor> = {}) {
    const out: Record<string, Valor> = {};
    for (const [k, v] of Object.entries(q)) {
      if (!RESERVADOS.has(k)) out[k] = v;
    }
    return out;
  }

  /** Leitura (GET). Resposta crua da Shopee. */
  async ler(user: AuthenticatedUser, caminho: string, query?: Record<string, Valor>) {
    const empresaId = this.empresa(user);
    this.validarCaminho(caminho);
    return this.shopee.getShop<unknown>(empresaId, caminho, this.query(query));
  }

  /** Escrita (POST). MEXE NA LOJA. Resposta crua, mais o que a trava mudou. */
  async escrever(
    user: AuthenticatedUser,
    caminho: string,
    corpo: Record<string, unknown> = {},
    query?: Record<string, Valor>,
  ) {
    const empresaId = this.empresa(user);
    const modulo = this.validarCaminho(caminho);
    if (/stock/i.test(caminho)) {
      throw new BusinessRuleException('Estoque vem do Magis5: rota de estoque não passa');
    }
    if (modulo === 'fbs') throw new BusinessRuleException('Full não muda por aqui');

    const ajustes: string[] = [];
    let enviar: Record<string, unknown> = corpo;
    if (CRIACAO.has(caminho)) {
      if (temEstoque(corpo)) {
        enviar = zerarEstoque(corpo) as Record<string, unknown>;
        ajustes.push('estoque zerado (vem do Magis5)');
      }
      if (caminho === '/api/v2/product/add_item' && enviar.item_status !== 'UNLIST') {
        enviar = { ...enviar, item_status: 'UNLIST' };
        ajustes.push('item_status = UNLIST');
      }
    } else if (temEstoque(corpo)) {
      throw new BusinessRuleException('Campo de estoque não passa: estoque vem do Magis5');
    }

    if (modulo === 'product' && !SEM_CHECAR_FULL.has(caminho)) {
      const itens = itensDoCorpo(corpo);
      if (itens.length > MAX_ITENS_CHECADOS) {
        throw new BusinessRuleException(`No máximo ${MAX_ITENS_CHECADOS} anúncios por chamada`);
      }
      // init_tier_variation logo após o add_item: Full "desconhecido" de anúncio novo conta como 0.
      const novo = caminho === '/api/v2/product/init_tier_variation';
      for (const itemId of itens) await this.anuncios.garantirSemFull(user, itemId, { novo });
    }

    this.logger.log(
      `shopee_api escrita empresa=${empresaId} usuario=${user.id} ${caminho} itens=${itensDoCorpo(corpo).join(',') || '-'} ajustes=${ajustes.join('; ') || '-'}`,
    );
    const resposta = await this.shopee.postShop<unknown>(
      empresaId,
      caminho,
      enviar,
      this.query(query),
      { semRepetir: true },
    );
    return { resposta, ajustes };
  }
}
