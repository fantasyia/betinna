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
