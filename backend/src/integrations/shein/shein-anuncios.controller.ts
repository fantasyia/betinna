import { Body, Controller, Get, Logger, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Audit } from '@shared/decorators/audit.decorator';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { BusinessRuleException, ForbiddenException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { horaShein } from './shein-assinatura';
import {
  atributosProduto,
  consultaPermitida,
  corpoPreco,
  corpoPublicacao,
  escritaPermitida,
  fichaSpu,
  fotoDaShein,
  mesclarAtributos,
  resultadoEdicao,
  resultadoPreco,
  resultadoPublicacao,
  resumoSpu,
  temEstoqueOuPreco,
  type SheinSpuInfo,
} from './shein-anuncios';
import { SheinClientService } from './shein.client';

interface SheinSkcLista {
  spuName?: string;
  skcName?: string;
  skuCodeList?: string[];
}

const listarSchema = z.object({
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(100).default(50),
  /** Só os atualizados nas últimas N horas (ausente = todos). */
  horas: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 365)
    .optional(),
  /** Todas as páginas de uma vez (02/11, #02): a Shein não devolve o total. */
  todas: z.enum(['1', 'true']).optional(),
});

const precoSchema = z.object({
  itens: z
    .array(
      z.object({
        skuCode: z.string().trim().min(1).max(60),
        preco: z.number().positive().max(100_000),
        // Shein BR (02/11, #02): o especial vira o preço de venda e o cheio é
        // descartado — o normal é mandar só o preco. Ausente = sem promocional.
        precoPromocional: z.number().positive().max(100_000).nullable().default(null),
        site: z.string().trim().min(1).max(40).optional(),
        moeda: z.string().trim().length(3).optional(),
        motivoAumento: z.number().int().min(1).max(5).optional(),
      }),
    )
    .min(1)
    .max(100),
});

const IDIOMA = 'pt-br';
const tituloSchema = z.object({ titulo: z.string().trim().min(1).max(1000) });
const descricaoSchema = z.object({ descricao: z.string().trim().min(1).max(5000) });
const atributoSchema = z
  .object({
    attribute_id: z.number().int().positive(),
    attribute_value_id: z.number().int().positive().optional(),
    attribute_extra_value: z.string().trim().min(1).max(200).optional(),
  })
  .refine((a) => a.attribute_value_id !== undefined || a.attribute_extra_value !== undefined, {
    message: 'Mande attribute_value_id ou attribute_extra_value',
  });
const atributosSchema = z
  .object({
    trocar: z.array(atributoSchema).max(100).default([]),
    remover: z.array(z.number().int().positive()).max(100).default([]),
  })
  .refine((d) => d.trocar.length + d.remover.length > 0, { message: 'Nada pra trocar' });
const tabelaSchema = z.object({
  tabela: z.array(z.record(z.unknown())).min(1).max(2000),
});
const planoSchema = z
  .object({
    titulo: z.string().trim().min(1).max(1000).optional(),
    descricao: z.string().trim().min(1).max(5000).optional(),
    atributos: z
      .object({
        trocar: z.array(atributoSchema).max(100).default([]),
        remover: z.array(z.number().int().positive()).max(100).default([]),
      })
      .optional(),
    tabela: z.array(z.record(z.unknown())).min(1).max(2000).optional(),
  })
  .refine(
    (d) =>
      d.titulo !== undefined ||
      d.descricao !== undefined ||
      d.tabela !== undefined ||
      (d.atributos && d.atributos.trocar.length + d.atributos.remover.length > 0),
    { message: 'Nada pra trocar' },
  );
const fotosSchema = z.object({
  cor: z.string().trim().min(1).max(60).optional(),
  imagens: z
    .array(
      z.object({
        url: z.string().trim().url().max(1000),
        tipo: z.union([z.literal(1), z.literal(2), z.literal(5), z.literal(6), z.literal(7)]),
        ordem: z.number().int().min(1).max(50),
      }),
    )
    .min(1)
    .max(50),
});

// Vídeo (07/11): só MP4 de link público e baixável, até 100 MB (regra da Shein).
const videoConverterSchema = z.object({
  url: z
    .string()
    .trim()
    .url()
    .max(1000)
    .regex(/\.mp4(\?.*)?$/i, 'O link tem que terminar em .mp4 (arquivo, não página de vídeo)'),
});
const videoSchema = z.object({
  url: z.string().trim().url().max(1000),
  sites: z.array(z.string().trim().min(1).max(30)).min(1).max(10).default(['shein-br']),
});
/** Vídeo já convertido pela Shein (o partialEdit só aceita esse). */
export const videoDaShein = (url: string) => {
  try {
    return /(^|\.)ltwebstatic\.com$/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
};
const SITUACAO_VIDEO: Record<number, 'pendente' | 'pronto' | 'falhou'> = {
  0: 'pendente',
  1: 'pronto',
  2: 'falhou',
};

const editarSchema = z.object({ spu_name: z.string().trim().min(1).max(60) }).passthrough();
const publicarSchema = z
  .object({ skc_list: z.array(z.record(z.unknown())).min(1).max(50) })
  .passthrough();

const consultarSchema = z.object({
  caminho: z.string().trim().min(1).max(120),
  corpo: z.record(z.unknown()).default({}),
});

/**
 * Anúncios da Shein (#05, Léo 01/11): listar, ver, mudar preço e editar
 * variações. Mudar preço e editar MEXEM NA LOJA (a Shein revisa a edição) —
 * só com o OK do Léo. Fica em /marketplace (escrita em /integracoes é barrada
 * pro token "tudo"). Roda na api, cujo IP está na lista branca da Shein.
 */
@ApiTags('marketplace/anuncios')
@ApiBearerAuth()
@Roles('ADMIN', 'DIRECTOR')
@Controller('marketplace/anuncios/shein')
export class SheinAnunciosController {
  private readonly logger = new Logger(SheinAnunciosController.name);

  constructor(private readonly shein: SheinClientService) {}

  private empresa(user: AuthenticatedUser): string {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    return user.empresaIdAtiva;
  }

  @Get()
  @ApiOperation({ summary: 'Anúncios aprovados da Shein: SPU → SKC (cor) → SKU (códigos)' })
  async listar(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listarSchema)) q: z.infer<typeof listarSchema>,
  ) {
    const empresaId = this.empresa(user);
    const desde = q.horas ? new Date(Date.now() - q.horas * 3_600_000) : null;
    const pagina = (n: number, tamanho: number) =>
      this.shein.post<{ data?: SheinSkcLista[] } | SheinSkcLista[]>(
        empresaId,
        '/open-api/openapi-business-backend/product/query',
        {
          pageNum: n,
          pageSize: tamanho,
          ...(desde
            ? { updateTimeStart: horaShein(desde), updateTimeEnd: horaShein(new Date()) }
            : {}),
        },
      );
    if (q.todas === undefined) return pagina(q.pagina, q.porPagina);
    // Até a página vir incompleta (teto de 100 páginas × 50 = 5.000 cores).
    const todos: SheinSkcLista[] = [];
    for (let n = 1; n <= 100; n++) {
      const r = await pagina(n, 50);
      const lista = Array.isArray(r) ? r : (r?.data ?? []);
      todos.push(...lista);
      if (lista.length < 50) break;
    }
    return {
      totalCores: todos.length,
      totalAnuncios: new Set(todos.map((x) => x.spuName)).size,
      data: todos,
    };
  }

  @Get(':spuName')
  @ApiOperation({
    summary: 'Um anúncio: cores, tamanhos, SKU do vendedor, preço e status (cru com ?cru=1)',
  })
  async ver(
    @CurrentUser() user: AuthenticatedUser,
    @Param('spuName') spuName: string,
    @Query('cru') cru?: string,
  ) {
    const info = await this.shein.post<SheinSpuInfo>(
      this.empresa(user),
      '/open-api/goods/spu-info',
      {
        languageList: ['pt-br'],
        spuName,
      },
    );
    return cru === '1' ? info : resumoSpu(info ?? {});
  }

  private async lerSpu(empresaId: string, spuName: string) {
    return (
      (await this.shein.post<SheinSpuInfo>(empresaId, '/open-api/goods/spu-info', {
        languageList: [IDIOMA],
        spuName,
      })) ?? {}
    );
  }

  /**
   * Manda só o campo pedido pelo partialEdit e relê. A Shein REVISA: enquanto a
   * revisão não aprova, a leitura pode seguir com o valor antigo — acompanhe em
   * GET :spuName/revisao com a versão devolvida.
   */
  private async editarCampo<T>(
    empresaId: string,
    spuName: string,
    campo: Record<string, unknown>,
    ler: (s: SheinSpuInfo) => T,
    confere: (depois: T) => boolean,
  ) {
    if (temEstoqueOuPreco(campo)) {
      throw new BusinessRuleException(
        'Edição de anúncio não leva estoque nem preço',
        ErrorCode.BUSINESS_RULE_VIOLATION,
      );
    }
    await this.exigirSemRevisao(empresaId, spuName);
    const antes = ler(await this.lerSpu(empresaId, spuName));
    const r = await this.shein.post<Parameters<typeof resultadoEdicao>[0]>(
      empresaId,
      '/open-api/goods/product/partialEdit',
      { spu_name: spuName, ...campo },
    );
    const envio = resultadoEdicao(r);
    const depois = ler(await this.lerSpu(empresaId, spuName));
    return { antes, depois, conferido: confere(depois), ...envio };
  }

  /**
   * Enquanto uma edição está em revisão, a Shein trava o SPU (erro 20100, que
   * chegava como 502 — #02, 08/11). Lê a revisão antes e recusa com o motivo.
   */
  private async exigirSemRevisao(empresaId: string, spuName: string) {
    const r = await this.shein.post<{
      data?: Array<{ version?: string; skcList?: Array<{ documentState?: number }> }>;
    }>(empresaId, '/open-api/goods/query-document-state', { spuList: [{ spuName }] });
    const doc = r?.data?.[0];
    if (doc?.skcList?.some((s) => s.documentState === 1)) {
      throw new BusinessRuleException(
        `Anúncio ${spuName} em revisão na Shein (versão ${doc.version ?? '?'}): espere aprovar antes de editar de novo`,
        ErrorCode.BUSINESS_RULE_VIOLATION,
      );
    }
  }

  @Post(':spuName/plano')
  @ApiOperation({
    summary:
      'MEXE NA LOJA — título, descrição, atributos e tabela numa edição só (uma revisão da Shein)',
  })
  async plano(
    @CurrentUser() user: AuthenticatedUser,
    @Param('spuName') spuName: string,
    @Body(new ZodValidationPipe(planoSchema)) dto: z.infer<typeof planoSchema>,
  ) {
    const empresaId = this.empresa(user);
    const campo: Record<string, unknown> = {};
    if (dto.titulo !== undefined) {
      campo.multi_language_name_list = [{ language: IDIOMA, name: dto.titulo }];
    }
    if (dto.descricao !== undefined) {
      campo.multi_language_desc_list = [{ language: IDIOMA, name: dto.descricao }];
    }
    const trocar = dto.atributos?.trocar ?? [];
    const remover = dto.atributos?.remover ?? [];
    if (trocar.length + remover.length > 0) {
      try {
        campo.product_attribute_list = mesclarAtributos(
          atributosProduto(await this.lerSpu(empresaId, spuName)),
          trocar,
          remover,
        );
      } catch (err) {
        throw new BusinessRuleException((err as Error).message, ErrorCode.BUSINESS_RULE_VIOLATION);
      }
    }
    if (dto.tabela !== undefined) campo.size_attribute_list = dto.tabela;
    const chave = (a: { attribute_id: number; attribute_value_id?: number }) =>
      `${a.attribute_id}:${a.attribute_value_id ?? ''}`;
    return this.editarCampo(
      empresaId,
      spuName,
      campo,
      (s) => {
        const f = fichaSpu(s);
        return {
          titulo: f.titulo,
          descricao: f.descricao,
          atributos: f.atributos,
          tabela: f.tabela,
        };
      },
      (d) =>
        (dto.titulo === undefined || d.titulo === dto.titulo) &&
        (dto.descricao === undefined || d.descricao === dto.descricao) &&
        !d.atributos.some((a) => remover.includes(a.attribute_id)) &&
        trocar.every((t) => d.atributos.some((a) => chave(a) === chave(t))) &&
        (dto.tabela === undefined || d.tabela.length > 0),
    );
  }

  @Get(':spuName/ficha')
  @ApiOperation({ summary: 'Título, descrição, atributos do produto, tabela e fotos' })
  async ficha(@CurrentUser() user: AuthenticatedUser, @Param('spuName') spuName: string) {
    return fichaSpu(await this.lerSpu(this.empresa(user), spuName));
  }

  @Post(':spuName/titulo')
  @ApiOperation({ summary: 'MEXE NA LOJA — troca só o título (a Shein revisa)' })
  titulo(
    @CurrentUser() user: AuthenticatedUser,
    @Param('spuName') spuName: string,
    @Body(new ZodValidationPipe(tituloSchema)) dto: z.infer<typeof tituloSchema>,
  ) {
    return this.editarCampo(
      this.empresa(user),
      spuName,
      { multi_language_name_list: [{ language: IDIOMA, name: dto.titulo }] },
      (s) => fichaSpu(s).titulo,
      (d) => d === dto.titulo,
    );
  }

  @Post(':spuName/descricao')
  @ApiOperation({ summary: 'MEXE NA LOJA — troca só a descrição (a Shein revisa)' })
  descricao(
    @CurrentUser() user: AuthenticatedUser,
    @Param('spuName') spuName: string,
    @Body(new ZodValidationPipe(descricaoSchema)) dto: z.infer<typeof descricaoSchema>,
  ) {
    return this.editarCampo(
      this.empresa(user),
      spuName,
      { multi_language_desc_list: [{ language: IDIOMA, name: dto.descricao }] },
      (s) => fichaSpu(s).descricao,
      (d) => d === dto.descricao,
    );
  }

  @Post(':spuName/atributos')
  @ApiOperation({
    summary: 'MEXE NA LOJA — troca ou remove atributos; o resto vai igual (a Shein revisa)',
  })
  async atributos(
    @CurrentUser() user: AuthenticatedUser,
    @Param('spuName') spuName: string,
    @Body(new ZodValidationPipe(atributosSchema)) dto: z.infer<typeof atributosSchema>,
  ) {
    const empresaId = this.empresa(user);
    let lista: ReturnType<typeof mesclarAtributos>;
    try {
      lista = mesclarAtributos(
        atributosProduto(await this.lerSpu(empresaId, spuName)),
        dto.trocar,
        dto.remover,
      );
    } catch (err) {
      throw new BusinessRuleException((err as Error).message, ErrorCode.BUSINESS_RULE_VIOLATION);
    }
    const chave = (a: { attribute_id: number; attribute_value_id?: number }) =>
      `${a.attribute_id}:${a.attribute_value_id ?? ''}`;
    return this.editarCampo(
      empresaId,
      spuName,
      { product_attribute_list: lista },
      atributosProduto,
      (d) =>
        !d.some((a) => dto.remover.includes(a.attribute_id)) &&
        dto.trocar.every((t) => d.some((a) => chave(a) === chave(t))),
    );
  }

  @Post(':spuName/tabela')
  @ApiOperation({
    summary: 'MEXE NA LOJA — troca a tabela de medidas inteira (size_attribute_list)',
  })
  tabela(
    @CurrentUser() user: AuthenticatedUser,
    @Param('spuName') spuName: string,
    @Body(new ZodValidationPipe(tabelaSchema)) dto: z.infer<typeof tabelaSchema>,
  ) {
    return this.editarCampo(
      this.empresa(user),
      spuName,
      { size_attribute_list: dto.tabela },
      (s) => s.dimensionAttributeInfoList ?? [],
      (d) => d.length > 0,
    );
  }

  // ─── Vídeo (Léo, 07/11) ──────────────────────────────────────────────
  // Ordem da Shein: converter → esperar a conversão → gravar a URL convertida.

  @Post('video/converter')
  @ApiOperation({
    summary:
      'Manda um MP4 (link público) pra Shein converter. Não mexe no anúncio. Devolve a tarefa (e a URL, se já convertido na semana)',
  })
  async videoConverter(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(videoConverterSchema)) dto: z.infer<typeof videoConverterSchema>,
  ) {
    const r = await this.shein.post<{ task_id?: string; transformed_url?: string | null }>(
      this.empresa(user),
      '/open-api/goods/product/create-video-transform-task',
      { video_url: dto.url },
    );
    return { tarefa: r?.task_id ?? null, url: r?.transformed_url ?? null };
  }

  @Get('video/tarefa/:tarefa')
  @ApiOperation({
    summary: 'Situação da conversão do vídeo: pendente, pronto (com a URL) ou falhou',
  })
  async videoTarefa(@CurrentUser() user: AuthenticatedUser, @Param('tarefa') tarefa: string) {
    if (!/^[A-Za-z0-9_-]{6,80}$/.test(tarefa)) {
      throw new BusinessRuleException('Tarefa inválida', ErrorCode.BUSINESS_RULE_VIOLATION);
    }
    const r = await this.shein.post<{
      data?: Array<{
        task_status?: number;
        transformed_url?: string | null;
        fail_reason?: unknown;
      }>;
    }>(this.empresa(user), '/open-api/goods/product/query-video-transform-task', {
      task_ids: [tarefa],
    });
    const t = r?.data?.[0];
    if (!t) return { tarefa, situacao: 'desconhecida', url: null, motivo: null };
    const situacao = SITUACAO_VIDEO[t.task_status ?? -1];
    if (!situacao) {
      // Situação nova da Shein: não chutar "pronto" nem "falhou".
      throw new BusinessRuleException(
        `Situação de vídeo desconhecida da Shein: ${String(t.task_status)}`,
        ErrorCode.BUSINESS_RULE_VIOLATION,
      );
    }
    return {
      tarefa,
      situacao,
      url: t.transformed_url ?? null,
      motivo: t.fail_reason ? JSON.stringify(t.fail_reason) : null,
    };
  }

  @Post(':spuName/video')
  @ApiOperation({
    summary:
      'MEXE NA LOJA — grava o vídeo JÁ CONVERTIDO no anúncio (um vídeo por site; a Shein revisa)',
  })
  video(
    @CurrentUser() user: AuthenticatedUser,
    @Param('spuName') spuName: string,
    @Body(new ZodValidationPipe(videoSchema)) dto: z.infer<typeof videoSchema>,
  ) {
    if (!videoDaShein(dto.url)) {
      throw new BusinessRuleException(
        'Use a URL convertida pela Shein (video/converter → video/tarefa), não o link original',
        ErrorCode.BUSINESS_RULE_VIOLATION,
      );
    }
    return this.editarCampo(
      this.empresa(user),
      spuName,
      { product_video_list: [{ sites: dto.sites, video_url: dto.url }] },
      // A leitura não tem campo documentado pro vídeo: confere se a URL aparece no anúncio.
      (s) => JSON.stringify(s).includes(dto.url),
      (tem) => tem,
    );
  }

  @Post(':spuName/fotos')
  @ApiOperation({
    summary:
      'MEXE NA LOJA — troca as fotos do anúncio ou de uma cor; converte link de fora antes (a Shein revisa)',
  })
  async fotos(
    @CurrentUser() user: AuthenticatedUser,
    @Param('spuName') spuName: string,
    @Body(new ZodValidationPipe(fotosSchema)) dto: z.infer<typeof fotosSchema>,
  ) {
    const empresaId = this.empresa(user);
    const lista: Array<{ image_url: string; image_type: number; image_sort: number }> = [];
    for (const f of dto.imagens) {
      let url = f.url;
      if (!fotoDaShein(url)) {
        const t = await this.shein.post<{ transformed?: string; failure_reason?: string }>(
          empresaId,
          '/open-api/goods/transform-pic',
          { image_type: f.tipo, original_url: url },
        );
        if (!t?.transformed) {
          throw new BusinessRuleException(
            `Foto ${f.ordem} recusada pela Shein: ${t?.failure_reason || 'sem motivo'}`,
            ErrorCode.BUSINESS_RULE_VIOLATION,
          );
        }
        url = t.transformed;
      }
      lista.push({ image_url: url, image_type: f.tipo, image_sort: f.ordem });
    }
    const imagens = { image_info: { image_info_list: lista } };
    return this.editarCampo(
      empresaId,
      spuName,
      dto.cor ? { skc_list: [{ skc_name: dto.cor, ...imagens }] } : imagens,
      (s) => {
        const ficha = fichaSpu(s);
        return dto.cor
          ? (ficha.cores.find((c) => c.skcName === dto.cor)?.fotos ?? [])
          : ficha.fotos;
      },
      (d) => d.length === lista.length,
    );
  }

  @Get(':spuName/revisao')
  @ApiOperation({ summary: 'Situação da revisão da Shein, com o motivo da recusa' })
  revisao(
    @CurrentUser() user: AuthenticatedUser,
    @Param('spuName') spuName: string,
    @Query('versao') versao?: string,
  ) {
    return this.shein.post(this.empresa(user), '/open-api/goods/query-document-state', {
      spuList: [{ spuName, ...(versao ? { version: versao } : {}) }],
    });
  }

  @Post('preco')
  @ApiOperation({
    summary: 'MEXE NA LOJA — muda o preço por SKU (até 100), devolve aceitos/em revisão/recusados',
  })
  async preco(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(precoSchema)) dto: z.infer<typeof precoSchema>,
  ) {
    let corpo: ReturnType<typeof corpoPreco>;
    try {
      corpo = corpoPreco(dto.itens);
    } catch (err) {
      throw new BusinessRuleException((err as Error).message, ErrorCode.BUSINESS_RULE_VIOLATION);
    }
    const r = await this.shein.post<{ data?: Parameters<typeof resultadoPreco>[0] }>(
      this.empresa(user),
      '/open-api/openapi-business-backend/product/price/save',
      corpo,
    );
    return resultadoPreco(r?.data ?? []);
  }

  @Post('publicar')
  @Audit({ action: 'PUBLICAR', resource: 'shein_anuncio' })
  @ApiOperation({
    summary:
      'MEXE NA LOJA — cria SPU novo (/goods/product/publishOrEdit) sempre FORA DE VENDA e com estoque 0. A Shein revisa.',
  })
  async publicar(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(publicarSchema)) dto: z.infer<typeof publicarSchema>,
  ) {
    let pronto: { corpo: Record<string, unknown>; ajustes: string[] };
    try {
      pronto = corpoPublicacao(dto);
    } catch (e) {
      throw new BusinessRuleException((e as Error).message, ErrorCode.BUSINESS_RULE_VIOLATION);
    }
    // Sem repetir: postRastreado faz uma tentativa só — criar duas vezes dá SPU duplicado.
    const { info, rastreio } = await this.shein.postRastreado<Record<string, unknown>>(
      this.empresa(user),
      '/open-api/goods/product/publishOrEdit',
      pronto.corpo,
    );
    const r = resultadoPublicacao(info);
    this.logger.log(
      `Shein publicar: criado=${r.criado} spu=${r.spu_name ?? '-'} versao=${r.versao ?? '-'} rastreio ${JSON.stringify(rastreio)}`,
    );
    return { ...r, ajustes: pronto.ajustes, rastreio };
  }

  @Post('editar')
  @ApiOperation({
    summary:
      'MEXE NA LOJA — edição parcial (/goods/product/partialEdit): criar cor/tamanho, SKU do vendedor, fotos. A Shein revisa.',
  })
  editar(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(editarSchema)) dto: z.infer<typeof editarSchema>,
  ) {
    return this.shein.post(this.empresa(user), '/open-api/goods/product/partialEdit', dto);
  }

  @Post('escrever')
  @ApiOperation({
    summary:
      'MEXE NA LOJA — inscrever/cancelar em campanha e enviar preço de varejo sugerido (só os caminhos liberados)',
  })
  async escrever(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(consultarSchema)) dto: z.infer<typeof consultarSchema>,
  ) {
    if (!escritaPermitida(dto.caminho)) {
      throw new BusinessRuleException(
        `Caminho não liberado pra escrita: ${dto.caminho}`,
        ErrorCode.BUSINESS_RULE_VIOLATION,
      );
    }
    // O rastreio vai na resposta e no log: é o que o suporte da Shein pede
    // quando ela recusa com corpo certo (3011 da 60614, 07/11).
    const { info, rastreio } = await this.shein.postRastreado<Record<string, unknown>>(
      this.empresa(user),
      dto.caminho,
      dto.corpo,
    );
    this.logger.log(`Shein escrita ${dto.caminho}: rastreio ${JSON.stringify(rastreio)}`);
    return { ...(info ?? {}), rastreio };
  }

  @Post('consultar')
  @ApiOperation({ summary: 'Consulta de leitura da Open API (só os caminhos liberados)' })
  consultar(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(consultarSchema)) dto: z.infer<typeof consultarSchema>,
  ) {
    if (!consultaPermitida(dto.caminho)) {
      throw new BusinessRuleException(
        `Caminho não liberado pra consulta: ${dto.caminho}`,
        ErrorCode.BUSINESS_RULE_VIOLATION,
      );
    }
    return this.shein.post(this.empresa(user), dto.caminho, dto.corpo);
  }
}
