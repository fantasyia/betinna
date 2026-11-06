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

interface ItemBase {
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
    const depois = this.estadoTabela(await this.itemBase(user, itemId));
    const conferido = dto.modeloId
      ? depois.modelo_id === dto.modeloId
      : !depois.modelo_id && !!depois.imagem && depois.imagem !== antes.imagem;
    return { antes, depois, conferido, aviso };
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
