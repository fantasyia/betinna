import { Injectable } from '@nestjs/common';
import { BusinessRuleException, ForbiddenException } from '@shared/errors/app-exception';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { ShopeeClientService } from './shopee-client.service';

/**
 * Cupons da loja (voucher) — Léo, 31/10. Mesmo molde da Oferta Relâmpago:
 * passa direto pra Shopee, não guarda nada. Criar, editar, encerrar e apagar
 * mexem na loja de verdade — só com o "pode subir" do Léo pro cupom.
 */

export interface CupomDto {
  nome: string;
  /** 1 a 5 letras/números; a Shopee põe o prefixo da loja na frente. */
  codigo: string;
  /** Unix, segundos. */
  inicio: number;
  fim: number;
  /** loja = vale pra loja toda · produtos = só nos item_ids. */
  alcance: 'loja' | 'produtos';
  itemIds?: number[];
  /** valor = R$ fixo · percentual = % (com teto opcional). */
  tipo: 'valor' | 'percentual';
  valor?: number;
  percentual?: number;
  teto?: number;
  minimoCompra: number;
  quantidade: number;
  /** false = cupom escondido (só por código). */
  vitrine?: boolean;
}

const P = '/api/v2/voucher';

@Injectable()
export class ShopeeVoucherService {
  constructor(private readonly shopee: ShopeeClientService) {}

  private empresa(user: AuthenticatedUser): string {
    if (!['ADMIN', 'DIRECTOR'].includes(user.role) || !user.empresaIdAtiva) {
      throw new ForbiddenException('Só diretor ou admin mexe nos cupons');
    }
    return user.empresaIdAtiva;
  }

  /** status: upcoming · ongoing · expired · all. */
  listar(user: AuthenticatedUser, status: string, pagina: number, porPagina: number) {
    return this.shopee.getShop(this.empresa(user), `${P}/get_voucher_list`, {
      status,
      page_no: pagina,
      page_size: porPagina,
    });
  }

  ver(user: AuthenticatedUser, voucherId: number) {
    return this.shopee.getShop(this.empresa(user), `${P}/get_voucher`, { voucher_id: voucherId });
  }

  criar(user: AuthenticatedUser, dto: CupomDto) {
    return this.shopee.postShop(this.empresa(user), `${P}/add_voucher`, corpoDoCupom(dto));
  }

  /** Edição: manda só o que muda (a Shopee recusa mexer em alguns campos depois do início). */
  editar(user: AuthenticatedUser, voucherId: number, dto: Partial<CupomDto>) {
    return this.shopee.postShop(this.empresa(user), `${P}/update_voucher`, {
      voucher_id: voucherId,
      ...corpoDoCupom(dto, true),
    });
  }

  /** Encerra um cupom em andamento. */
  encerrar(user: AuthenticatedUser, voucherId: number) {
    return this.shopee.postShop(this.empresa(user), `${P}/end_voucher`, { voucher_id: voucherId });
  }

  /** Apaga um cupom que ainda não começou. */
  apagar(user: AuthenticatedUser, voucherId: number) {
    return this.shopee.postShop(this.empresa(user), `${P}/delete_voucher`, {
      voucher_id: voucherId,
    });
  }
}

/** Nossos nomes → campos da Shopee. Na edição, só o que veio. */
export function corpoDoCupom(d: Partial<CupomDto>, edicao = false): Record<string, unknown> {
  if (!edicao) {
    if (d.tipo === 'valor' && !d.valor) throw regra('Cupom de valor precisa do valor');
    if (d.tipo === 'percentual' && !d.percentual) throw regra('Cupom percentual precisa do %');
    if (d.alcance === 'produtos' && !d.itemIds?.length) {
      throw regra('Cupom de produtos precisa dos item_ids');
    }
  }
  if (d.inicio !== undefined && d.fim !== undefined && d.fim <= d.inicio) {
    throw regra('O fim tem que ser depois do início');
  }
  const o: Record<string, unknown> = {};
  const poe = (k: string, v: unknown) => {
    if (v !== undefined) o[k] = v;
  };
  poe('voucher_name', d.nome);
  poe('voucher_code', d.codigo);
  poe('start_time', d.inicio);
  poe('end_time', d.fim);
  if (d.alcance) poe('voucher_type', d.alcance === 'loja' ? 1 : 2);
  if (d.tipo) poe('reward_type', d.tipo === 'valor' ? 1 : 2);
  poe('discount_amount', d.tipo === 'percentual' ? undefined : d.valor);
  poe('percentage', d.tipo === 'valor' ? undefined : d.percentual);
  poe('max_price', d.teto);
  poe('min_basket_price', d.minimoCompra);
  poe('usage_quantity', d.quantidade);
  poe('item_id_list', d.alcance === 'loja' ? undefined : d.itemIds);
  // 1 = aparece em todas as vitrines · 0 = escondido (só por código).
  if (d.vitrine !== undefined) poe('display_channel_list', d.vitrine ? [1] : []);
  else if (!edicao) poe('display_channel_list', [1]);
  return o;
}

function regra(msg: string) {
  return new BusinessRuleException(msg);
}
