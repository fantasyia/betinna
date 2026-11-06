import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { BusinessRuleException } from '@shared/errors/app-exception';
import { Roles } from '@shared/decorators/roles.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { ShopeeFlashSaleService } from './shopee-flash-sale.service';

const id = z.coerce.number().int().positive();
const modelo = z
  .object({
    model_id: z.number().int().positive().optional(),
    preco: z.number().positive().max(100_000).optional(),
    desconto: z.number().gt(0).lt(100).optional(),
    estoque: z.number().int().min(1).max(100_000),
    status: z.union([z.literal(0), z.literal(1)]).optional(),
  })
  .refine((m) => (m.preco === undefined) !== (m.desconto === undefined), {
    message: 'Mande preco OU desconto (um dos dois)',
  });
const item = z.object({
  item_id: z.number().int().positive(),
  purchase_limit: z.number().int().min(0).max(1000).optional(),
  models: z.array(modelo).min(1).max(50),
});
const itensSchema = z.object({ itens: z.array(item).min(1).max(50) });
const criarSchema = z.object({ timeslot_id: z.number().int().positive() });
const statusSchema = z.object({ status: z.union([z.literal(1), z.literal(2)]) });
const listarSchema = z.object({
  type: z.coerce.number().int().min(0).max(3).default(0),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const horariosSchema = z.object({ start_time: id, end_time: id });
const skuSchema = z.object({
  models: z
    .array(
      z.object({
        model_id: z.number().int().positive(),
        sku_atual: z.string().trim().min(1).max(100),
        sku_novo: z.string().trim().min(1).max(100),
      }),
    )
    .min(1)
    .max(50),
});
const descricaoSchema = z
  .object({
    descricao: z.string().trim().min(1).max(5000).optional(),
    campos: z
      .array(
        z.object({
          field_type: z.enum(['text', 'image']),
          text: z.string().min(1).max(5000).optional(),
          image_info: z.object({ image_id: z.string().min(1) }).optional(),
        }),
      )
      .min(1)
      .max(50)
      .optional(),
  })
  .refine((d) => !d.descricao !== !d.campos, { message: 'Mande descricao OU campos' });
const fichaSchema = z.object({
  atributos: z
    .array(
      z.object({
        attribute_id: z.number().int().positive(),
        attribute_value_list: z
          .array(
            z
              .object({
                value_id: z.number().int().min(0),
                original_value_name: z.string().trim().min(1).max(200).optional(),
                value_unit: z.string().trim().min(1).max(20).optional(),
              })
              .refine((v) => v.value_id > 0 || !!v.original_value_name, {
                message: 'value_id 0 exige original_value_name',
              }),
          )
          .min(1)
          .max(50),
      }),
    )
    .min(1)
    .max(50),
});
const tabelaSchema = z
  .object({
    imagemId: z.string().trim().min(1).max(100).optional(),
    modeloId: z.number().int().positive().optional(),
  })
  .refine((d) => !d.imagemId !== !d.modeloId, { message: 'Mande imagemId OU modeloId' });
const tituloSchema = z.object({ titulo: z.string().trim().min(1).max(255) });
const videoSchema = z.object({ videoId: z.string().trim().min(1).max(100).nullable() });
const promocaoSchema = z.record(z.string(), z.unknown());
const imagensSchema = z.object({
  imagens: z.array(z.string().trim().min(1).max(100)).min(1).max(12),
});
const pesoSchema = z
  .object({
    pesoKg: z.number().positive().max(1000).optional(),
    altura: z.number().int().positive().max(1000).optional(),
    largura: z.number().int().positive().max(1000).optional(),
    comprimento: z.number().int().positive().max(1000).optional(),
  })
  .refine((d) => d.pesoKg !== undefined || d.altura !== undefined, {
    message: 'Mande pesoKg ou as medidas',
  })
  .refine(
    (d) =>
      (d.altura === undefined) === (d.largura === undefined) &&
      (d.altura === undefined) === (d.comprimento === undefined),
    { message: 'Medidas vão juntas: altura, largura e comprimento' },
  );
const preparoSchema = z.object({
  dias: z.number().int().min(1).max(60),
  preEncomenda: z.boolean(),
});
const logisticaSchema = z.object({
  canais: z
    .array(
      z.object({
        logistic_id: z.number().int().positive(),
        enabled: z.boolean().optional(),
        shipping_fee: z.number().min(0).optional(),
        size_id: z.number().int().min(0).optional(),
        is_free: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(30),
});
const categoriaSchema = z.object({ categoriaId: z.number().int().positive() });
const listadoSchema = z.object({ listado: z.boolean() });
const atributosRemoverSchema = z.object({
  atributos: z.array(z.number().int().positive()).min(1).max(50),
});
const marcaSchema = z.object({
  brand_id: z.number().int().min(0),
  original_brand_name: z.string().trim().min(1).max(200).optional(),
});
const marcasQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).optional(),
  status: z.union([z.literal('1'), z.literal('2')]).optional(),
});
const TIPOS_IMAGEM = ['image/jpeg', 'image/png'];
const precoSchema = z.object({
  models: z
    .array(
      z.object({
        model_id: z.number().int().min(0).optional(),
        preco: z.number().positive().max(100_000),
      }),
    )
    .min(1)
    .max(50),
});

/**
 * Oferta Relâmpago da Shopee (Léo, 31/10). Escopo de token `shopee-promocoes`.
 * Criar, pôr item e ativar mexem na loja de verdade — só com o OK do Léo.
 */
@ApiTags('shopee-promocoes')
@ApiBearerAuth()
@Roles('ADMIN', 'DIRECTOR')
@Controller('shopee-promocoes')
export class ShopeeFlashSaleController {
  constructor(private readonly svc: ShopeeFlashSaleService) {}

  @Get('flash-sale')
  @ApiOperation({
    summary: 'Ofertas relâmpago (type 0 todas, 1 próximas, 2 em andamento, 3 encerradas)',
  })
  listar(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listarSchema)) q: z.infer<typeof listarSchema>,
  ) {
    return this.svc.listar(user, q.type, q.offset, q.limit);
  }

  @Get('flash-sale/horarios')
  @ApiOperation({ summary: 'Horários (timeslot) entre start_time e end_time (Unix, segundos)' })
  horarios(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(horariosSchema)) q: z.infer<typeof horariosSchema>,
  ) {
    return this.svc.horarios(user, q.start_time, q.end_time);
  }

  @Get('flash-sale/:id')
  @ApiOperation({ summary: 'Uma oferta com os itens' })
  ver(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseIntPipe) fsId: number) {
    return this.svc.ver(user, fsId);
  }

  @Post('flash-sale')
  @ApiOperation({ summary: 'Cria a oferta num timeslot (nasce sem itens)' })
  criar(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(criarSchema)) dto: z.infer<typeof criarSchema>,
  ) {
    return this.svc.criar(user, dto.timeslot_id);
  }

  @Post('flash-sale/:id/itens')
  @ApiOperation({ summary: 'Põe itens na oferta (preço final ou desconto %, estoque, limite)' })
  adicionar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) fsId: number,
    @Body(new ZodValidationPipe(itensSchema)) dto: z.infer<typeof itensSchema>,
  ) {
    return this.svc.adicionarItens(user, fsId, dto.itens);
  }

  @Post('flash-sale/:id/itens/editar')
  @ApiOperation({ summary: 'Edita itens da oferta (preço, estoque, limite, status 1/0)' })
  editar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) fsId: number,
    @Body(new ZodValidationPipe(itensSchema)) dto: z.infer<typeof itensSchema>,
  ) {
    return this.svc.editarItens(user, fsId, dto.itens);
  }

  @Post('flash-sale/:id/status')
  @ApiOperation({ summary: 'Ativa (1) ou desativa (2) a oferta' })
  status(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) fsId: number,
    @Body(new ZodValidationPipe(statusSchema)) dto: z.infer<typeof statusSchema>,
  ) {
    return this.svc.status(user, fsId, dto.status);
  }

  @Post('anuncios/:itemId/preco')
  @ApiOperation({ summary: 'Muda o preço do anúncio por model (sem variação = model_id 0)' })
  preco(
    @CurrentUser() user: AuthenticatedUser,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body(new ZodValidationPipe(precoSchema)) dto: z.infer<typeof precoSchema>,
  ) {
    return this.svc.atualizarPreco(user, itemId, dto.models);
  }

  @Post('anuncios/:itemId/skus')
  @ApiOperation({ summary: 'MEXE NA LOJA: troca só o SKU dos models, pulando Full' })
  skus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body(new ZodValidationPipe(skuSchema)) dto: z.infer<typeof skuSchema>,
  ) {
    return this.svc.trocarSku(user, itemId, dto.models);
  }

  @Get('anuncios/:itemId/descricao')
  @ApiOperation({ summary: 'Descrição atual do anúncio, normal ou estendida' })
  descricao(@CurrentUser() user: AuthenticatedUser, @Param('itemId', ParseIntPipe) itemId: number) {
    return this.svc.descricao(user, itemId);
  }

  @Post('anuncios/:itemId/descricao')
  @ApiOperation({ summary: 'MEXE NA LOJA: troca só a descrição do anúncio' })
  atualizarDescricao(
    @CurrentUser() user: AuthenticatedUser,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body(new ZodValidationPipe(descricaoSchema)) dto: z.infer<typeof descricaoSchema>,
  ) {
    return this.svc.atualizarDescricao(user, itemId, dto);
  }

  @Get('anuncios/:itemId/ficha')
  @ApiOperation({ summary: 'Atributos da ficha e os valores aceitos pela categoria' })
  ficha(@CurrentUser() user: AuthenticatedUser, @Param('itemId', ParseIntPipe) itemId: number) {
    return this.svc.ficha(user, itemId);
  }

  @Post('anuncios/:itemId/ficha')
  @ApiOperation({ summary: 'Troca só os atributos pedidos — MEXE NA LOJA' })
  atualizarFicha(
    @CurrentUser() user: AuthenticatedUser,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body(new ZodValidationPipe(fichaSchema)) dto: z.infer<typeof fichaSchema>,
  ) {
    return this.svc.atualizarFicha(user, itemId, dto.atributos);
  }

  @Get('promocoes/:tipo/:acao')
  @ApiOperation({ summary: 'Lê desconto, combo ou oferta' })
  promocaoLer(
    @CurrentUser() user: AuthenticatedUser,
    @Param('tipo') tipo: string,
    @Param('acao') acao: string,
    @Query() query: Record<string, unknown>,
  ) {
    return this.svc.promocaoLer(user, `${tipo}/${acao}`, query);
  }

  @Post('promocoes/:tipo/:acao')
  @ApiOperation({ summary: 'Cria, edita ou encerra promoção, sem estoque — MEXE NA LOJA' })
  promocaoEscrever(
    @CurrentUser() user: AuthenticatedUser,
    @Param('tipo') tipo: string,
    @Param('acao') acao: string,
    @Body(new ZodValidationPipe(promocaoSchema)) corpo: z.infer<typeof promocaoSchema>,
  ) {
    return this.svc.promocaoEscrever(user, `${tipo}/${acao}`, corpo);
  }

  @Get('anuncios/:itemId/variacoes')
  @ApiOperation({ summary: 'Estrutura das variações e índice de cada model' })
  variacoes(@CurrentUser() user: AuthenticatedUser, @Param('itemId', ParseIntPipe) itemId: number) {
    return this.svc.variacoes(user, itemId);
  }

  @Post('videos')
  @ApiOperation({ summary: 'Sobe vídeo no media space; nenhum anúncio muda' })
  @UseInterceptors(FileInterceptor('video', { limits: { fileSize: 30 * 1024 * 1024, files: 1 } }))
  async subirVideo(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() video: { buffer: Buffer; mimetype: string } | undefined,
  ) {
    if (!video) throw new BusinessRuleException('Nenhum vídeo enviado');
    if (video.mimetype !== 'video/mp4') throw new BusinessRuleException('A Shopee pede MP4');
    return { videoId: await this.svc.subirVideo(user, video.buffer) };
  }

  @Get('videos/:videoId')
  @ApiOperation({ summary: 'Situação do processamento do vídeo' })
  videoResultado(@CurrentUser() user: AuthenticatedUser, @Param('videoId') videoId: string) {
    return this.svc.videoResultado(user, videoId);
  }

  @Post('anuncios/:itemId/video')
  @ApiOperation({ summary: 'Troca o vídeo; videoId null tira — MEXE NA LOJA' })
  atualizarVideo(
    @CurrentUser() user: AuthenticatedUser,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body(new ZodValidationPipe(videoSchema)) dto: z.infer<typeof videoSchema>,
  ) {
    return this.svc.atualizarVideo(user, itemId, dto.videoId);
  }

  @Get('logistica/canais')
  @ApiOperation({ summary: 'Canais de envio da loja' })
  canaisLogistica(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.canaisLogistica(user);
  }

  @Get('anuncios/:itemId/resumo')
  @ApiOperation({ summary: 'Título, status, peso, preparo, imagens, vídeo e logística' })
  resumo(@CurrentUser() user: AuthenticatedUser, @Param('itemId', ParseIntPipe) itemId: number) {
    return this.svc.resumo(user, itemId);
  }

  @Post('anuncios/:itemId/imagens')
  @ApiOperation({ summary: 'Troca e ordena as imagens — MEXE NA LOJA' })
  atualizarImagens(
    @CurrentUser() user: AuthenticatedUser,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body(new ZodValidationPipe(imagensSchema)) dto: z.infer<typeof imagensSchema>,
  ) {
    return this.svc.atualizarImagens(user, itemId, dto.imagens);
  }

  @Post('anuncios/:itemId/peso')
  @ApiOperation({ summary: 'Troca peso e medidas, recusa Full — MEXE NA LOJA' })
  atualizarPeso(
    @CurrentUser() user: AuthenticatedUser,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body(new ZodValidationPipe(pesoSchema)) dto: z.infer<typeof pesoSchema>,
  ) {
    return this.svc.atualizarPeso(user, itemId, dto);
  }

  @Post('anuncios/:itemId/preparo')
  @ApiOperation({ summary: 'Troca os dias de preparo — MEXE NA LOJA' })
  atualizarPreparo(
    @CurrentUser() user: AuthenticatedUser,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body(new ZodValidationPipe(preparoSchema)) dto: z.infer<typeof preparoSchema>,
  ) {
    return this.svc.atualizarPreparo(user, itemId, dto);
  }

  @Post('anuncios/:itemId/logistica')
  @ApiOperation({ summary: 'Ajusta canais de envio — MEXE NA LOJA' })
  atualizarLogistica(
    @CurrentUser() user: AuthenticatedUser,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body(new ZodValidationPipe(logisticaSchema)) dto: z.infer<typeof logisticaSchema>,
  ) {
    return this.svc.atualizarLogistica(user, itemId, dto.canais);
  }

  @Post('anuncios/:itemId/categoria')
  @ApiOperation({ summary: 'Troca a categoria — MEXE NA LOJA' })
  atualizarCategoria(
    @CurrentUser() user: AuthenticatedUser,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body(new ZodValidationPipe(categoriaSchema)) dto: z.infer<typeof categoriaSchema>,
  ) {
    return this.svc.atualizarCategoria(user, itemId, dto.categoriaId);
  }

  @Post('anuncios/:itemId/status')
  @ApiOperation({ summary: 'Lista ou deslista, recusa Full — MEXE NA LOJA' })
  atualizarStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body(new ZodValidationPipe(listadoSchema)) dto: z.infer<typeof listadoSchema>,
  ) {
    return this.svc.atualizarStatus(user, itemId, dto.listado);
  }

  @Post('anuncios/:itemId/ficha/remover')
  @ApiOperation({ summary: 'Apaga atributos da ficha — MEXE NA LOJA' })
  removerAtributos(
    @CurrentUser() user: AuthenticatedUser,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body(new ZodValidationPipe(atributosRemoverSchema))
    dto: z.infer<typeof atributosRemoverSchema>,
  ) {
    return this.svc.removerAtributos(user, itemId, dto.atributos);
  }

  @Get('anuncios/:itemId/titulo')
  @ApiOperation({ summary: 'Título atual do anúncio' })
  titulo(@CurrentUser() user: AuthenticatedUser, @Param('itemId', ParseIntPipe) itemId: number) {
    return this.svc.titulo(user, itemId);
  }

  @Post('anuncios/:itemId/titulo')
  @ApiOperation({ summary: 'Troca só o título — MEXE NA LOJA' })
  atualizarTitulo(
    @CurrentUser() user: AuthenticatedUser,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body(new ZodValidationPipe(tituloSchema)) dto: z.infer<typeof tituloSchema>,
  ) {
    return this.svc.atualizarTitulo(user, itemId, dto.titulo);
  }

  @Get('anuncios/:itemId/marca')
  @ApiOperation({ summary: 'Marca atual do anúncio' })
  marca(@CurrentUser() user: AuthenticatedUser, @Param('itemId', ParseIntPipe) itemId: number) {
    return this.svc.marca(user, itemId);
  }

  @Post('anuncios/:itemId/marca')
  @ApiOperation({ summary: 'Troca só a marca — MEXE NA LOJA' })
  atualizarMarca(
    @CurrentUser() user: AuthenticatedUser,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body(new ZodValidationPipe(marcaSchema)) dto: z.infer<typeof marcaSchema>,
  ) {
    return this.svc.atualizarMarca(user, itemId, dto);
  }

  @Get('categorias/:categoriaId/marcas')
  @ApiOperation({ summary: 'Marcas aceitas na categoria' })
  marcasDaCategoria(
    @CurrentUser() user: AuthenticatedUser,
    @Param('categoriaId', ParseIntPipe) categoriaId: number,
    @Query(new ZodValidationPipe(marcasQuerySchema)) q: z.infer<typeof marcasQuerySchema>,
  ) {
    return this.svc.marcasDaCategoria(user, categoriaId, {
      offset: q.offset,
      status: q.status === '2' ? 2 : 1,
    });
  }

  @Get('anuncios/:itemId/tabela-medidas')
  @ApiOperation({ summary: 'Tabela de medidas ligada e o que a categoria aceita' })
  tabelaMedidas(
    @CurrentUser() user: AuthenticatedUser,
    @Param('itemId', ParseIntPipe) itemId: number,
  ) {
    return this.svc.tabelaMedidas(user, itemId);
  }

  @Post('anuncios/:itemId/tabela-medidas')
  @ApiOperation({ summary: 'Troca só a tabela de medidas — MEXE NA LOJA' })
  atualizarTabelaMedidas(
    @CurrentUser() user: AuthenticatedUser,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body(new ZodValidationPipe(tabelaSchema)) dto: z.infer<typeof tabelaSchema>,
  ) {
    return this.svc.atualizarTabelaMedidas(user, itemId, dto);
  }

  @Get('categorias/:categoriaId/tabelas-medidas')
  @ApiOperation({ summary: 'Modelos de tabela da loja na categoria' })
  tabelasDaCategoria(
    @CurrentUser() user: AuthenticatedUser,
    @Param('categoriaId', ParseIntPipe) categoriaId: number,
    @Query('cursor') cursor?: string,
  ) {
    return this.svc.tabelasDaCategoria(user, categoriaId, cursor);
  }

  @Post('imagens')
  @ApiOperation({ summary: 'Sobe imagem no media space; nenhum anúncio muda' })
  @UseInterceptors(FileInterceptor('imagem', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  async subirImagem(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() imagem: { buffer: Buffer; originalname: string; mimetype: string } | undefined,
    @Body('cena') cena?: string,
  ) {
    if (!imagem) throw new BusinessRuleException('Nenhuma imagem enviada');
    if (!TIPOS_IMAGEM.includes(imagem.mimetype)) {
      throw new BusinessRuleException('A Shopee só aceita JPG ou PNG');
    }
    const imagemId = await this.svc.subirImagem(
      user,
      { buffer: imagem.buffer, nome: imagem.originalname, tipo: imagem.mimetype },
      cena === 'normal' ? 'normal' : 'desc',
    );
    return { imagemId };
  }

  @Get('anuncios/:itemId/modelos')
  @ApiOperation({ summary: 'Preço e estoque atuais de cada model, com vendedor e Full separados' })
  modelos(@CurrentUser() user: AuthenticatedUser, @Param('itemId', ParseIntPipe) itemId: number) {
    return this.svc.modelos(user, itemId);
  }
}
