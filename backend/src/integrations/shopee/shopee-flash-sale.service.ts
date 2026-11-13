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
  model_sku?: string;
  price_info?: Array<{ current_price?: number; original_price?: number }>;
  stock_info_v2?: {
    summary_info?: { total_available_stock?: number };
    seller_stock?: Array<{ location_id?: string; stock?: number }>;
    shopee_stock?: Array<{ location_id?: string; stock?: number }>;
  };
  model_name?: string;
}

const P = '/api/v2/shop_flash_sale';

export interface CampoDescricao {
  field_type: string;
  text?: string;
  image_info?: { image_id?: string };
}

export interface ValorAtributo {
  value_id: number;
  original_value_name?: string;
  value_unit?: string;
}
export interface AtributoFicha {
  attribute_id: number;
  attribute_value_list: ValorAtributo[];
}

export interface MarcaAnuncio {
  brand_id: number;
  original_brand_name?: string;
}

export interface OpcaoPadrao {
  variation_option_id?: number;
  variation_option_name?: string;
  image_id?: string;
  image_url?: string;
}
export interface VariacaoPadrao {
  variation_id?: number;
  variation_name?: string;
  variation_group_id?: number;
  variation_option_list?: OpcaoPadrao[];
}

export interface CanalLogistica {
  logistic_id: number;
  enabled?: boolean;
  shipping_fee?: number;
  size_id?: number;
  is_free?: boolean;
}
export interface Pacote {
  package_height?: number;
  package_length?: number;
  package_width?: number;
}

interface ItemBase {
  item_name?: string;
  item_status?: string;
  has_model?: boolean;
  /** Segundos Unix. */
  create_time?: number;
  /** A Shopee devolve o peso como texto, em kg. */
  weight?: string | number;
  dimension?: Pacote;
  pre_order?: { is_pre_order?: boolean; days_to_ship?: number };
  image?: { image_id_list?: string[]; image_url_list?: string[]; image_ratio?: string };
  video_info?: Array<{ video_url?: string; thumbnail_url?: string; duration?: number }>;
  logistic_info?: CanalLogistica[];
  stock_info_v2?: { shopee_stock?: Array<{ stock?: number }> };
  category_id?: number;
  description?: string;
  description_type?: string;
  description_info?: { extended_description?: { field_list?: CampoDescricao[] } };
  attribute_list?: Array<
    AtributoFicha & { original_attribute_name?: string; is_mandatory?: boolean }
  >;
  /** URL da imagem da tabela de medidas. */
  size_chart?: string;
  /** Modelo de tabela da loja. */
  size_chart_id?: number;
  /** brand_id 0 é "sem marca" na Shopee. */
  brand?: MarcaAnuncio;
}

const iguais = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const RELEITURAS = 3;
export const ESPERA_RELEITURA_MS = { valor: 2000 };
const esperar = (o: { valor: number }) => new Promise((r) => setTimeout(r, o.valor));

/** Só o que está aqui passa. Excluir promoção ou item fora de promoção não existe. */
const PROMO_LEITURA: Record<string, string> = {
  'desconto/lista': '/api/v2/discount/get_discount_list',
  'desconto/ver': '/api/v2/discount/get_discount',
  'combo/lista': '/api/v2/bundle_deal/get_bundle_deal_list',
  'combo/ver': '/api/v2/bundle_deal/get_bundle_deal',
  'combo/itens': '/api/v2/bundle_deal/get_bundle_deal_item',
  'oferta/lista': '/api/v2/add_on_deal/get_add_on_deal_list',
  'oferta/ver': '/api/v2/add_on_deal/get_add_on_deal',
  'oferta/principais': '/api/v2/add_on_deal/get_add_on_deal_main_item',
  'oferta/adicionais': '/api/v2/add_on_deal/get_add_on_deal_sub_item',
};
const PROMO_ESCRITA: Record<string, string> = {
  'desconto/criar': '/api/v2/discount/add_discount',
  'desconto/editar': '/api/v2/discount/update_discount',
  'desconto/encerrar': '/api/v2/discount/end_discount',
  'desconto/itens-adicionar': '/api/v2/discount/add_discount_item',
  'desconto/itens-editar': '/api/v2/discount/update_discount_item',
  'desconto/itens-remover': '/api/v2/discount/delete_discount_item',
  'combo/criar': '/api/v2/bundle_deal/add_bundle_deal',
  'combo/editar': '/api/v2/bundle_deal/update_bundle_deal',
  'combo/encerrar': '/api/v2/bundle_deal/end_bundle_deal',
  'combo/itens-adicionar': '/api/v2/bundle_deal/add_bundle_deal_item',
  'combo/itens-editar': '/api/v2/bundle_deal/update_bundle_deal_item',
  'oferta/criar': '/api/v2/add_on_deal/add_add_on_deal',
  'oferta/editar': '/api/v2/add_on_deal/update_add_on_deal',
  'oferta/encerrar': '/api/v2/add_on_deal/end_add_on_deal',
  'oferta/principais-adicionar': '/api/v2/add_on_deal/add_add_on_deal_main_item',
  'oferta/adicionais-adicionar': '/api/v2/add_on_deal/add_add_on_deal_sub_item',
};

/** Promoção não escreve estoque: chave de estoque em qualquer nível recusa. */
function temEstoque(valor: unknown): boolean {
  if (Array.isArray(valor)) return valor.some(temEstoque);
  if (valor === null || typeof valor !== 'object') return false;
  return Object.entries(valor).some(([k, v]) => /stock/i.test(k) || temEstoque(v));
}

/** Criado nas últimas 24 h, deslistado e sem variação: não pode ter Full ainda. */
export function itemRecemCriado(item: {
  item_status?: string;
  has_model?: boolean;
  create_time?: number;
}): boolean {
  const idade = Date.now() / 1000 - (item.create_time ?? 0);
  return item.item_status === 'UNLIST' && item.has_model !== true && idade >= 0 && idade < 86_400;
}

function somarEstoque(lista?: Array<{ stock?: number }>): number | null {
  return lista ? lista.reduce((soma, l) => soma + (l.stock ?? 0), 0) : null;
}

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
      sku: m.model_sku ?? null,
      preco_atual: m.price_info?.[0]?.current_price ?? null,
      preco_original: m.price_info?.[0]?.original_price ?? null,
      estoque: m.stock_info_v2?.summary_info?.total_available_stock ?? null,
      // Separados pra nunca confundir Full com o estoque do vendedor (04/11).
      // Sem a lista, fica null: desconhecido não pode virar zero.
      estoque_vendedor: somarEstoque(m.stock_info_v2?.seller_stock),
      estoque_full: somarEstoque(m.stock_info_v2?.shopee_stock),
    }));
  }

  /**
   * Troca só o SKU dos models (Léo, 04/11). Lê o estado na hora: recusa se o SKU
   * atual divergir e pula quem tem Full ou estoque desconhecido. MEXE NA LOJA.
   */
  async trocarSku(
    user: AuthenticatedUser,
    itemId: number,
    models: Array<{ model_id: number; sku_atual: string; sku_novo: string }>,
  ) {
    const atuais = new Map((await this.modelos(user, itemId)).map((m) => [m.model_id, m]));
    const pulados: Array<{ model_id: number; motivo: string }> = [];
    const liberados = models.filter((m) => {
      const a = atuais.get(m.model_id);
      const motivo = !a
        ? 'model não existe no anúncio'
        : a.sku !== m.sku_atual
          ? `SKU atual é ${a.sku ?? 'vazio'}`
          : a.estoque_full === null
            ? 'estoque Full desconhecido'
            : a.estoque_full > 0
              ? 'tem estoque Full'
              : null;
      if (motivo) pulados.push({ model_id: m.model_id, motivo });
      return !motivo;
    });
    if (liberados.length === 0) return { aceitos: [], recusados: [], pulados };
    const r = await this.shopee.postShop<{
      response?: {
        success_list?: Array<{ model_id: number; model_sku?: string }>;
        failure_list?: Array<{ model_id: number; failed_reason: string }>;
      };
    }>(this.empresa(user), '/api/v2/product/update_model', {
      item_id: itemId,
      model: liberados.map((m) => ({ model_id: m.model_id, model_sku: m.sku_novo })),
    });
    return {
      aceitos: r.response?.success_list ?? [],
      recusados: r.response?.failure_list ?? [],
      pulados,
    };
  }

  private async itemBase(user: AuthenticatedUser, itemId: number): Promise<ItemBase> {
    const r = await this.shopee.getShop<{ response?: { item_list?: ItemBase[] } }>(
      this.empresa(user),
      '/api/v2/product/get_item_base_info',
      { item_id_list: itemId },
    );
    const item = r.response?.item_list?.[0];
    if (!item) throw new BusinessRuleException(`Anúncio ${itemId} não encontrado na Shopee`);
    return item;
  }

  /** update_item com só o campo pedido. A prova de que mudou é a leitura de volta. */
  private async gravarItem(user: AuthenticatedUser, itemId: number, campo: object) {
    const r = await this.shopee.postShop<{ warning?: string }>(
      this.empresa(user),
      '/api/v2/product/update_item',
      { item_id: itemId, ...campo },
    );
    return r?.warning || null;
  }

  /** Descrição atual, normal ou estendida (com os blocos de imagem). */
  async descricao(user: AuthenticatedUser, itemId: number) {
    const item = await this.itemBase(user, itemId);
    return {
      tipo: item.description_type ?? 'normal',
      descricao: item.description ?? null,
      campos: item.description_info?.extended_description?.field_list ?? null,
    };
  }

  /**
   * Troca SÓ a descrição (Léo, 04/11). MEXE NA LOJA. Mantém o tipo do anúncio. Na
   * estendida com imagem, exige `campos`: texto solto apagaria os blocos de imagem.
   */
  async atualizarDescricao(
    user: AuthenticatedUser,
    itemId: number,
    dto: { descricao?: string; campos?: CampoDescricao[] },
  ) {
    const antes = await this.descricao(user, itemId);
    const estendida = antes.tipo === 'extended';
    const temImagem = antes.campos?.some((c) => c.field_type !== 'text') ?? false;
    if (estendida && temImagem && !dto.campos) {
      throw new BusinessRuleException('Descrição estendida com imagem: mande `campos`, não texto');
    }
    if (!estendida && !dto.descricao) {
      throw new BusinessRuleException('Descrição normal: mande `descricao`');
    }
    const blocos = dto.campos ?? [{ field_type: 'text', text: dto.descricao }];
    const aviso = await this.gravarItem(
      user,
      itemId,
      estendida
        ? {
            description_type: 'extended',
            description_info: { extended_description: { field_list: blocos } },
          }
        : { description: dto.descricao },
    );
    const depois = await this.descricao(user, itemId);
    const conferido = estendida
      ? iguais(depois.campos, blocos)
      : depois.descricao === dto.descricao;
    return { antes, depois, conferido, aviso };
  }

  async titulo(user: AuthenticatedUser, itemId: number) {
    return { titulo: (await this.itemBase(user, itemId)).item_name ?? null };
  }

  /** Troca SÓ o título (Léo, 06/11). MEXE NA LOJA. */
  async atualizarTitulo(user: AuthenticatedUser, itemId: number, titulo: string) {
    const antes = await this.titulo(user, itemId);
    const aviso = await this.gravarItem(user, itemId, { item_name: titulo });
    const depois = await this.titulo(user, itemId);
    return { antes, depois, conferido: depois.titulo === titulo, aviso };
  }

  /** Leitura de promoção, pela lista fechada de caminhos. */
  async promocaoLer(user: AuthenticatedUser, acao: string, query: Record<string, unknown>) {
    const caminho = PROMO_LEITURA[acao];
    if (!caminho) throw new BusinessRuleException(`Leitura desconhecida: ${acao}`);
    const r = await this.shopee.getShop<{ response?: unknown }>(
      this.empresa(user),
      caminho,
      query as never,
    );
    return r.response ?? null;
  }

  /** Escrita de promoção. MEXE NA LOJA. Nunca leva estoque. */
  async promocaoEscrever(user: AuthenticatedUser, acao: string, corpo: Record<string, unknown>) {
    const caminho = PROMO_ESCRITA[acao];
    if (!caminho) throw new BusinessRuleException(`Ação desconhecida: ${acao}`);
    if (temEstoque(corpo)) throw new BusinessRuleException('Promoção não escreve estoque');
    const r = await this.shopee.postShop<{ response?: unknown; warning?: string }>(
      this.empresa(user),
      caminho,
      corpo,
    );
    return { resposta: r.response ?? null, aviso: r.warning || null };
  }

  private async listaModelos(user: AuthenticatedUser, itemId: number) {
    const r = await this.shopee.getShop<{
      response?: {
        tier_variation?: unknown[];
        standardise_tier_variation?: VariacaoPadrao[];
        model?: Array<{ model_id: number; model_sku?: string; tier_index?: number[] }>;
      };
    }>(this.empresa(user), '/api/v2/product/get_model_list', { item_id: itemId });
    return r.response ?? {};
  }

  /**
   * Renomeia uma opção ou troca a imagem dela. MEXE NA LOJA. A Shopee recebe a
   * estrutura inteira, lida na hora, com cada model no mesmo índice: SKU, preço e
   * estoque não vão. Anúncio com Full fica de fora.
   */
  async atualizarOpcao(
    user: AuthenticatedUser,
    itemId: number,
    dto: { nivel: number; indice: number; nome?: string; imagemId?: string },
  ) {
    await this.exigirSemFull(user, itemId, await this.itemBase(user, itemId));
    const atual = await this.listaModelos(user, itemId);
    const estrutura = (atual.standardise_tier_variation ?? []).map((v) => ({
      ...v,
      variation_option_list: (v.variation_option_list ?? []).map(({ image_url: _url, ...o }) => o),
    }));
    const opcao = estrutura[dto.nivel]?.variation_option_list[dto.indice];
    if (!opcao) throw new BusinessRuleException('Opção não existe nesse anúncio');
    const antes = { ...opcao };
    if (dto.nome !== undefined && dto.nome !== opcao.variation_option_name) {
      opcao.variation_option_name = dto.nome;
      // Id de opção padrão só vale pro nome padrão; nome novo vai como texto livre.
      opcao.variation_option_id = 0;
    }
    if (dto.imagemId !== undefined) opcao.image_id = dto.imagemId;
    const r = await this.shopee.postShop<{ warning?: string }>(
      this.empresa(user),
      '/api/v2/product/update_tier_variation',
      {
        item_id: itemId,
        model_list: (atual.model ?? []).map((m) => ({
          model_id: m.model_id,
          tier_index: m.tier_index,
        })),
        standardise_tier_variation: estrutura,
      },
    );
    const lida = (await this.listaModelos(user, itemId)).standardise_tier_variation ?? [];
    const depois = lida[dto.nivel]?.variation_option_list?.[dto.indice] ?? null;
    const conferido =
      lida.flatMap((v) => v.variation_option_list ?? []).length ===
        estrutura.flatMap((v) => v.variation_option_list).length &&
      (dto.nome === undefined || depois?.variation_option_name === dto.nome) &&
      (dto.imagemId === undefined || depois?.image_id === dto.imagemId);
    return { antes, depois, conferido, aviso: r?.warning || null };
  }

  /** Estrutura das variações, com o índice de cada model. */
  async variacoes(user: AuthenticatedUser, itemId: number) {
    const r = { response: await this.listaModelos(user, itemId) };
    return {
      variacoes: r.response?.tier_variation ?? [],
      padronizadas: r.response?.standardise_tier_variation ?? [],
      modelos: (r.response?.model ?? []).map((m) => ({
        model_id: m.model_id,
        sku: m.model_sku ?? null,
        indice: m.tier_index ?? [],
      })),
    };
  }

  subirVideo(user: AuthenticatedUser, video: Buffer) {
    return this.shopee.subirVideo(this.empresa(user), video);
  }

  /** Processamento do vídeo: só depois de SUCCEEDED ele entra em anúncio. */
  async videoResultado(user: AuthenticatedUser, videoId: string) {
    const r = await this.shopee.postShop<{ response?: unknown }>(
      this.empresa(user),
      '/api/v2/media_space/get_video_upload_result',
      { video_upload_id: videoId },
    );
    return r.response ?? null;
  }

  /** Troca ou tira o vídeo do anúncio. MEXE NA LOJA. */
  async atualizarVideo(user: AuthenticatedUser, itemId: number, videoId: string | null) {
    const antes = (await this.itemBase(user, itemId)).video_info ?? [];
    const aviso = await this.gravarItem(user, itemId, {
      video_upload_id: videoId ? [videoId] : [],
    });
    const depois = (await this.itemBase(user, itemId)).video_info ?? [];
    return { antes, depois, conferido: videoId ? depois.length > 0 : depois.length === 0, aviso };
  }

  /** Tudo que as rotas de anúncio trocam, num GET só. */
  async resumo(user: AuthenticatedUser, itemId: number) {
    const i = await this.itemBase(user, itemId);
    return {
      titulo: i.item_name ?? null,
      status: i.item_status ?? null,
      categoria: i.category_id ?? null,
      tem_variacao: i.has_model ?? null,
      peso_kg: i.weight === undefined ? null : Number(i.weight),
      dimensao: i.dimension ?? null,
      preparo: i.pre_order ?? null,
      imagens: i.image?.image_id_list ?? [],
      imagens_url: i.image?.image_url_list ?? [],
      proporcao: i.image?.image_ratio ?? null,
      video: i.video_info ?? [],
      logistica: i.logistic_info ?? [],
    };
  }

  /** Canais de envio da loja, com os ids que a logística do anúncio pede. */
  async canaisLogistica(user: AuthenticatedUser) {
    const r = await this.shopee.getShop<{ response?: { logistics_channel_list?: unknown[] } }>(
      this.empresa(user),
      '/api/v2/logistics/get_channel_list',
      {},
    );
    return r.response?.logistics_channel_list ?? [];
  }

  /** Pro passthrough (shopee_api): recusa escrita em anúncio com Full. */
  async garantirSemFull(user: AuthenticatedUser, itemId: number, opcoes: { novo?: boolean } = {}) {
    const item = await this.itemBase(user, itemId);
    await this.exigirSemFull(user, itemId, item, opcoes.novo === true && itemRecemCriado(item));
  }

  /**
   * Mudança no nível do item alcança todos os models: com Full, não entra.
   * `desconhecidoEhZero`: anúncio recém-criado, deslistado e sem variação
   * ainda não tem a lista do Full (a Shopee demora a preencher) e não pode ter
   * estoque Full — aí "desconhecido" conta como 0 (13/11, ~35 de 210 travavam).
   */
  private async exigirSemFull(
    user: AuthenticatedUser,
    itemId: number,
    item: ItemBase,
    desconhecidoEhZero = false,
  ) {
    const modelos = await this.modelos(user, itemId);
    const fulls = modelos.length
      ? modelos.map((m) => m.estoque_full)
      : [somarEstoque(item.stock_info_v2?.shopee_stock)];
    if (fulls.some((f) => (f === null && !desconhecidoEhZero) || (f ?? 0) > 0)) {
      throw new BusinessRuleException('Anúncio com Full ou estoque Full desconhecido: não mexi');
    }
  }

  /** Troca e reordena as imagens: a primeira da lista é a capa. MEXE NA LOJA. */
  async atualizarImagens(user: AuthenticatedUser, itemId: number, imagens: string[]) {
    const antes = (await this.resumo(user, itemId)).imagens;
    const aviso = await this.gravarItem(user, itemId, { image: { image_id_list: imagens } });
    const depois = (await this.resumo(user, itemId)).imagens;
    return { antes, depois, conferido: iguais(depois, imagens), aviso };
  }

  /**
   * Peso e medidas da embalagem. MEXE NA LOJA. A Shopee sobrescreve os de todos
   * os models, então anúncio com Full fica de fora.
   */
  async atualizarPeso(
    user: AuthenticatedUser,
    itemId: number,
    dto: { pesoKg?: number; altura?: number; largura?: number; comprimento?: number },
  ) {
    const item = await this.itemBase(user, itemId);
    await this.exigirSemFull(user, itemId, item);
    const dimensao =
      dto.altura === undefined
        ? undefined
        : {
            package_height: dto.altura,
            package_width: dto.largura,
            package_length: dto.comprimento,
          };
    const antes = { peso_kg: Number(item.weight), dimensao: item.dimension ?? null };
    const aviso = await this.gravarItem(user, itemId, {
      ...(dto.pesoKg === undefined ? {} : { weight: dto.pesoKg }),
      ...(dimensao ? { dimension: dimensao } : {}),
    });
    const lido = await this.itemBase(user, itemId);
    const depois = { peso_kg: Number(lido.weight), dimensao: lido.dimension ?? null };
    const conferido =
      (dto.pesoKg === undefined || depois.peso_kg === dto.pesoKg) &&
      (!dimensao ||
        (lido.dimension?.package_height === dimensao.package_height &&
          lido.dimension?.package_width === dimensao.package_width &&
          lido.dimension?.package_length === dimensao.package_length));
    return { antes, depois, conferido, aviso };
  }

  /** Dias de preparo. MEXE NA LOJA. */
  async atualizarPreparo(
    user: AuthenticatedUser,
    itemId: number,
    dto: { dias: number; preEncomenda: boolean },
  ) {
    const antes = (await this.itemBase(user, itemId)).pre_order ?? null;
    const aviso = await this.gravarItem(user, itemId, {
      pre_order: { days_to_ship: dto.dias, is_pre_order: dto.preEncomenda },
    });
    const depois = (await this.itemBase(user, itemId)).pre_order ?? null;
    const conferido =
      depois?.days_to_ship === dto.dias && !!depois?.is_pre_order === dto.preEncomenda;
    return { antes, depois, conferido, aviso };
  }

  /**
   * Liga, desliga ou ajusta canais de envio. MEXE NA LOJA. A Shopee recebe a lista
   * inteira, lida na hora: quem não veio no pedido é reenviado igual.
   */
  async atualizarLogistica(user: AuthenticatedUser, itemId: number, canais: CanalLogistica[]) {
    const antes = (await this.itemBase(user, itemId)).logistic_info ?? [];
    const pedidos = new Map(canais.map((c) => [c.logistic_id, c]));
    const lista = [
      ...antes.map((a) => ({ ...a, ...pedidos.get(a.logistic_id) })),
      ...canais.filter((c) => !antes.some((a) => a.logistic_id === c.logistic_id)),
    ].map((c) => ({
      logistic_id: c.logistic_id,
      enabled: c.enabled,
      ...(c.shipping_fee === undefined ? {} : { shipping_fee: c.shipping_fee }),
      ...(c.size_id === undefined ? {} : { size_id: c.size_id }),
      ...(c.is_free === undefined ? {} : { is_free: c.is_free }),
    }));
    const aviso = await this.gravarItem(user, itemId, { logistic_info: lista });
    const depois = (await this.itemBase(user, itemId)).logistic_info ?? [];
    const conferido = canais.every((c) => {
      const lido = depois.find((d) => d.logistic_id === c.logistic_id);
      return !!lido && (c.enabled === undefined || lido.enabled === c.enabled);
    });
    return { antes, depois, conferido, aviso };
  }

  /** Muda a categoria. MEXE NA LOJA. Atributos da nova ficam a cargo de quem pede. */
  async atualizarCategoria(user: AuthenticatedUser, itemId: number, categoriaId: number) {
    const antes = (await this.itemBase(user, itemId)).category_id ?? null;
    const aviso = await this.gravarItem(user, itemId, { category_id: categoriaId });
    const depois = (await this.itemBase(user, itemId)).category_id ?? null;
    return { antes, depois, conferido: depois === categoriaId, aviso };
  }

  /** Lista ou deslista. MEXE NA LOJA. Anúncio com Full fica de fora. */
  async atualizarStatus(user: AuthenticatedUser, itemId: number, listado: boolean) {
    const item = await this.itemBase(user, itemId);
    await this.exigirSemFull(user, itemId, item);
    const r = await this.shopee.postShop<{
      response?: { failure_list?: Array<{ failed_reason?: string }> };
    }>(this.empresa(user), '/api/v2/product/unlist_item', {
      item_list: [{ item_id: itemId, unlist: !listado }],
    });
    const falha = r.response?.failure_list?.[0];
    if (falha) throw new BusinessRuleException(falha.failed_reason ?? 'Shopee recusou');
    const depois = (await this.itemBase(user, itemId)).item_status ?? null;
    return {
      antes: item.item_status ?? null,
      depois,
      conferido: depois === (listado ? 'NORMAL' : 'UNLIST'),
    };
  }

  /** Apaga atributos da ficha. MEXE NA LOJA. Reenvia os demais, lidos na hora. */
  async removerAtributos(user: AuthenticatedUser, itemId: number, atributos: number[]) {
    const antes = (await this.itemBase(user, itemId)).attribute_list ?? [];
    const sai = new Set(atributos);
    const faltando = atributos.filter((a) => !antes.some((x) => x.attribute_id === a));
    if (faltando.length) {
      throw new BusinessRuleException(`Atributo fora da ficha: ${faltando.join(', ')}`);
    }
    const aviso = await this.gravarItem(user, itemId, {
      attribute_list: antes
        .filter((a) => !sai.has(a.attribute_id))
        .map((a) => ({
          attribute_id: a.attribute_id,
          attribute_value_list: a.attribute_value_list,
        })),
    });
    const depois = (await this.itemBase(user, itemId)).attribute_list ?? [];
    return {
      antes,
      depois,
      conferido: !depois.some((d) => sai.has(d.attribute_id)),
      aviso,
    };
  }

  /** Marca atual do anúncio e a categoria, pra buscar as aceitas. */
  async marca(user: AuthenticatedUser, itemId: number) {
    const item = await this.itemBase(user, itemId);
    return { categoria: item.category_id ?? null, marca: item.brand ?? null };
  }

  /** Marcas aceitas na categoria. status 1 = normal, 2 = pendente de registro. */
  async marcasDaCategoria(
    user: AuthenticatedUser,
    categoriaId: number,
    q: { offset?: number; status?: 1 | 2 },
  ) {
    const r = await this.shopee.getShop<{
      response?: {
        brand_list?: Array<{
          brand_id: number;
          original_brand_name?: string;
          display_brand_name?: string;
        }>;
        has_next_page?: boolean;
        next_offset?: number;
        is_mandatory?: boolean;
      };
    }>(this.empresa(user), '/api/v2/product/get_brand_list', {
      category_id: categoriaId,
      offset: q.offset ?? 0,
      page_size: 100,
      status: q.status ?? 1,
      language: 'pt-BR',
    });
    return {
      marcas: r.response?.brand_list ?? [],
      proxima: r.response?.has_next_page ? (r.response.next_offset ?? null) : null,
      obrigatoria: r.response?.is_mandatory ?? null,
    };
  }

  /** Troca SÓ a marca (Léo, 05/11). MEXE NA LOJA. */
  async atualizarMarca(user: AuthenticatedUser, itemId: number, nova: MarcaAnuncio) {
    const antes = (await this.itemBase(user, itemId)).brand ?? null;
    const aviso = await this.gravarItem(user, itemId, { brand: nova });
    const depois = (await this.itemBase(user, itemId)).brand ?? null;
    return { antes, depois, conferido: depois?.brand_id === nova.brand_id, aviso };
  }

  /** Atributos da ficha e, da categoria, os aceitos com seus value_id. */
  async ficha(user: AuthenticatedUser, itemId: number) {
    const item = await this.itemBase(user, itemId);
    const arvore = item.category_id
      ? await this.shopee.getShop<{ response?: { list?: Array<{ attribute_tree?: unknown[] }> } }>(
          this.empresa(user),
          '/api/v2/product/get_attribute_tree',
          { category_id_list: item.category_id, language: 'pt-BR' },
        )
      : null;
    return {
      categoria: item.category_id ?? null,
      atributos: item.attribute_list ?? [],
      opcoes: arvore?.response?.list?.[0]?.attribute_tree ?? [],
    };
  }

  /**
   * Troca SÓ os atributos pedidos. MEXE NA LOJA. A Shopee recebe a lista inteira,
   * lida na hora: mandar só os alterados arriscaria apagar o resto da ficha.
   */
  async atualizarFicha(user: AuthenticatedUser, itemId: number, atributos: AtributoFicha[]) {
    const pedidos = new Set(atributos.map((a) => a.attribute_id));
    if (pedidos.size !== atributos.length) {
      throw new BusinessRuleException('Atributo repetido no pedido');
    }
    const item = await this.itemBase(user, itemId);
    const antes = item.attribute_list ?? [];
    const mantidos = antes
      .filter((a) => !pedidos.has(a.attribute_id))
      .map((a) => ({
        attribute_id: a.attribute_id,
        attribute_value_list: a.attribute_value_list,
      }));
    const aviso = await this.gravarItem(user, itemId, {
      attribute_list: [...mantidos, ...atributos],
    });
    const depois = (await this.itemBase(user, itemId)).attribute_list ?? [];
    const conferido = atributos.every((a) => {
      const lido = depois.find((d) => d.attribute_id === a.attribute_id);
      // Valor livre tem value_id 0: só o nome diferencia um do outro.
      const chaves = (l: ValorAtributo[]) =>
        l.map((v) => v.value_id || `livre:${v.original_value_name}`).sort();
      return !!lido && iguais(chaves(lido.attribute_value_list), chaves(a.attribute_value_list));
    });
    return { antes, depois, conferido, aviso };
  }

  private estadoTabela(item: ItemBase) {
    return { imagem: item.size_chart || null, modelo_id: item.size_chart_id || null };
  }

  /** Tabela ligada ao anúncio, o conteúdo do modelo e o que a categoria aceita. */
  async tabelaMedidas(user: AuthenticatedUser, itemId: number) {
    const e = this.empresa(user);
    const item = await this.itemBase(user, itemId);
    const atual = this.estadoTabela(item);
    let modelo: unknown = null;
    let modeloErro: string | null = null;
    if (atual.modelo_id) {
      // Modelo fechado não pode esconder a imagem e a categoria da resposta.
      try {
        const r = await this.shopee.getShop<{ response?: unknown }>(
          e,
          '/api/v2/product/get_size_chart_detail',
          { size_chart_id: atual.modelo_id },
        );
        modelo = r.response ?? null;
      } catch (err) {
        modeloErro = err instanceof Error ? err.message : String(err);
      }
    }
    return {
      categoria: item.category_id ?? null,
      ...atual,
      modelo,
      modelo_erro: modeloErro,
      limites: await this.limitesTabela(user, item.category_id),
    };
  }

  private async limitesTabela(user: AuthenticatedUser, categoria?: number) {
    if (!categoria) return null;
    const r = await this.shopee.getShop<{
      response?: {
        size_chart_limit?: {
          size_chart_mandatory?: boolean;
          support_image_size_chart?: boolean;
          support_template_size_chart?: boolean;
        };
      };
    }>(this.empresa(user), '/api/v2/product/get_item_limit', { category_id: categoria });
    const limite = r.response?.size_chart_limit;
    return {
      obrigatoria: limite?.size_chart_mandatory ?? null,
      aceita_imagem: limite?.support_image_size_chart ?? null,
      aceita_modelo: limite?.support_template_size_chart ?? null,
    };
  }

  /** Modelos de tabela da loja numa categoria. */
  tabelasDaCategoria(user: AuthenticatedUser, categoria: number, cursor?: string) {
    return this.shopee.getShop(this.empresa(user), '/api/v2/product/get_size_chart_list', {
      category_id: categoria,
      page_size: 50,
      cursor,
    });
  }

  /** Só guarda a imagem no media space da Shopee. Nenhum anúncio muda. */
  subirImagem(
    user: AuthenticatedUser,
    arquivo: { buffer: Buffer; nome: string; tipo: string },
    cena: 'normal' | 'desc',
  ) {
    this.empresa(user);
    return this.shopee.subirImagem(arquivo, cena);
  }

  /**
   * Troca SÓ a tabela de medidas. MEXE NA LOJA. Se o anúncio usa modelo, a imagem
   * vai com `size_chart_id: 0`: pela Shopee, com os dois preenchidos, fica o modelo.
   */
  async atualizarTabelaMedidas(
    user: AuthenticatedUser,
    itemId: number,
    dto: { imagemId?: string; modeloId?: number },
  ) {
    const item = await this.itemBase(user, itemId);
    const antes = this.estadoTabela(item);
    const limites = await this.limitesTabela(user, item.category_id);
    if (dto.imagemId && limites?.aceita_imagem === false) {
      throw new BusinessRuleException('A categoria deste anúncio não aceita tabela em imagem');
    }
    if (dto.modeloId && limites?.aceita_modelo === false) {
      throw new BusinessRuleException('A categoria deste anúncio não aceita modelo de tabela');
    }
    const size_chart_info = dto.modeloId
      ? { size_chart_id: dto.modeloId }
      : { size_chart: dto.imagemId, ...(antes.modelo_id ? { size_chart_id: 0 } : {}) };
    const aviso = await this.gravarItem(user, itemId, { size_chart_info });
    const confere = (d: ReturnType<typeof this.estadoTabela>) =>
      dto.modeloId
        ? d.modelo_id === dto.modeloId
        : !d.modelo_id && !!d.imagem && d.imagem !== antes.imagem;
    // A leitura logo após gravar ainda vem com o valor antigo (#02, 07/11): relê com folga.
    let depois = this.estadoTabela(await this.itemBase(user, itemId));
    for (let i = 0; i < RELEITURAS && !confere(depois); i++) {
      await esperar(ESPERA_RELEITURA_MS);
      depois = this.estadoTabela(await this.itemBase(user, itemId));
    }
    return { antes, depois, conferido: confere(depois), aviso };
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

  /**
   * Preço de anúncio (product/update_price), por model; anúncio sem variação
   * usa model_id 0 — 01/11, pra tabela nova da Shopee. MEXE NA LOJA: só com o
   * "pode subir" do Léo pro plano exato. Devolve o que a Shopee aceitou e recusou.
   */
  async atualizarPreco(
    user: AuthenticatedUser,
    itemId: number,
    models: Array<{ model_id?: number; preco: number }>,
  ) {
    const r = await this.shopee.postShop<{
      response?: {
        success_list?: Array<{ model_id: number; original_price: number }>;
        failure_list?: Array<{ model_id: number; failed_reason: string }>;
      };
    }>(this.empresa(user), '/api/v2/product/update_price', {
      item_id: itemId,
      price_list: models.map((m) => ({ model_id: m.model_id ?? 0, original_price: m.preco })),
    });
    return {
      aceitos: r.response?.success_list ?? [],
      recusados: r.response?.failure_list ?? [],
    };
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
