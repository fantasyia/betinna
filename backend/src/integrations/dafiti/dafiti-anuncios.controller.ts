import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { ForbiddenException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { DafitiClientService } from './dafiti.client';

interface ProductSet {
  id?: number;
  name?: string;
  description?: string;
  attributes?: Record<string, unknown>;
  [k: string]: unknown;
}
interface Imagem {
  id?: number;
  position?: number;
  displayUrl?: string;
  url?: string;
  [k: string]: unknown;
}

const listarSchema = z.object({
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(100).default(50),
  busca: z.string().trim().min(3).max(100).optional(),
  status: z.string().trim().min(1).max(30).optional(),
});
const nomeSchema = z.object({ nome: z.string().trim().min(1).max(255) });
const descricaoSchema = z.object({ descricao: z.string().trim().min(1).max(25_000) });
const atributosSchema = z.object({
  // Chave = id do atributo. Valor: texto, id de opção, lista, ou null pra limpar.
  atributos: z
    .record(
      z.string().regex(/^\d+$/, 'chave é o id numérico do atributo'),
      z.union([
        z.string().max(2000),
        z.number().int(),
        z.array(z.number().int()).max(50),
        z.array(z.string().max(500)).max(50),
        z.null(),
      ]),
    )
    .refine((a) => Object.keys(a).length > 0, { message: 'Nada pra trocar' }),
});
const fotoSchema = z.object({
  url: z.string().trim().url().max(1000),
  posicao: z.number().int().min(1).max(8).optional(),
});
const fotoEditarSchema = z
  .object({
    url: z.string().trim().url().max(1000).optional(),
    posicao: z.number().int().min(1).max(8).optional(),
  })
  .refine((d) => d.url !== undefined || d.posicao !== undefined, {
    message: 'Mande url ou posicao',
  });
const qcSchema = z.object({
  ids: z.string().regex(/^\d+(,\d+){0,99}$/, 'até 100 ids separados por vírgula'),
});

/** A Dafiti devolve id de opção como texto ("11"): compara tudo como texto. */
const texto = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(String) : v === null || v === undefined ? null : String(v);
const iguais = (a: unknown, b: unknown) => JSON.stringify(texto(a)) === JSON.stringify(texto(b));

/**
 * Anúncios da Dafiti (Seller Center v2), Léo 07/11. Product set = o anúncio
 * (nome, descrição, atributos, fotos); preço e estoque são da variação e NÃO
 * passam por aqui. Escritas MEXEM NA LOJA — só com o "pode subir" do Léo pro
 * valor exato. A Dafiti pode mandar pra revisão (qualidade).
 */
@ApiTags('marketplace/dafiti')
@ApiBearerAuth()
@Roles('ADMIN', 'DIRECTOR')
@Controller('marketplace/dafiti/anuncios')
export class DafitiAnunciosController {
  constructor(private readonly dafiti: DafitiClientService) {}

  private empresa(user: AuthenticatedUser): string {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    return user.empresaIdAtiva;
  }

  private ler(empresaId: string, id: number) {
    return this.dafiti.get<ProductSet>(empresaId, `/v2/product-set/${id}`);
  }

  private fotos(empresaId: string, id: number) {
    return this.dafiti.get<Imagem[] | { items?: Imagem[] }>(
      empresaId,
      `/v2/product-set/${id}/images`,
    );
  }

  /** PUT só com o campo pedido, depois relê. Variação (preço, estoque) não vai. */
  private async trocar<T>(
    empresaId: string,
    id: number,
    corpo: Record<string, unknown>,
    campo: (p: ProductSet) => T,
    confere: (depois: T) => boolean,
  ) {
    const antes = campo(await this.ler(empresaId, id));
    await this.dafiti.enviar(empresaId, 'PUT', `/v2/product-set/${id}`, corpo);
    const depois = campo(await this.ler(empresaId, id));
    return { antes, depois, conferido: confere(depois) };
  }

  @Get()
  @ApiOperation({ summary: 'Anúncios (product sets) da Dafiti, 100 por página no máximo' })
  listar(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listarSchema)) q: z.infer<typeof listarSchema>,
  ) {
    return this.dafiti.get<unknown>(this.empresa(user), '/v2/product-sets', {
      limit: q.porPagina,
      offset: (q.pagina - 1) * q.porPagina,
      ...(q.busca ? { 'keyword[]': [q.busca] } : {}),
      ...(q.status ? { status: q.status } : {}),
    });
  }

  @Get('revisao')
  @ApiOperation({ summary: 'Situação da revisão de qualidade: approved, rejected ou pending' })
  revisao(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(qcSchema)) q: z.infer<typeof qcSchema>,
  ) {
    return this.dafiti.get<unknown>(this.empresa(user), '/v2/product-set/quality-control-status', {
      'productSetIds[]': q.ids.split(','),
    });
  }

  @Get('motivos-recusa')
  @ApiOperation({ summary: 'Motivos de recusa da revisão de qualidade' })
  motivos(@CurrentUser() user: AuthenticatedUser) {
    return this.dafiti.get<unknown>(this.empresa(user), '/v2/qc-reject-reasons');
  }

  @Get('atributos/:conjuntoId')
  @ApiOperation({ summary: 'Atributos aceitos num conjunto de atributos (categoria)' })
  atributosDoConjunto(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conjuntoId', ParseIntPipe) conjuntoId: number,
  ) {
    return this.dafiti.get<unknown>(
      this.empresa(user),
      `/v2/attribute-sets/${conjuntoId}/attributes`,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Um anúncio: dados, variações e fotos' })
  async ver(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseIntPipe) id: number) {
    const e = this.empresa(user);
    const [anuncio, variacoes, fotos] = await Promise.all([
      this.ler(e, id),
      this.dafiti.get<unknown>(e, `/v2/product-set/${id}/products`),
      this.fotos(e, id),
    ]);
    return { anuncio, variacoes, fotos };
  }

  @Post(':id/nome')
  @ApiOperation({ summary: 'MEXE NA LOJA — troca só o nome' })
  nome(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(nomeSchema)) dto: z.infer<typeof nomeSchema>,
  ) {
    return this.trocar(
      this.empresa(user),
      id,
      { name: dto.nome },
      (p) => p.name ?? null,
      (d) => d === dto.nome,
    );
  }

  @Post(':id/descricao')
  @ApiOperation({ summary: 'MEXE NA LOJA — troca só a descrição' })
  descricao(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(descricaoSchema)) dto: z.infer<typeof descricaoSchema>,
  ) {
    return this.trocar(
      this.empresa(user),
      id,
      { description: dto.descricao },
      (p) => p.description ?? null,
      (d) => d === dto.descricao,
    );
  }

  @Post(':id/atributos')
  @ApiOperation({ summary: 'MEXE NA LOJA — troca só os atributos mandados (null limpa)' })
  atributos(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(atributosSchema)) dto: z.infer<typeof atributosSchema>,
  ) {
    const ids = Object.keys(dto.atributos);
    return this.trocar(
      this.empresa(user),
      id,
      { attributes: dto.atributos },
      (p) => Object.fromEntries(ids.map((k) => [k, p.attributes?.[k] ?? null])),
      (d) => ids.every((k) => iguais(d[k], dto.atributos[k])),
    );
  }

  @Post(':id/fotos')
  @ApiOperation({ summary: 'MEXE NA LOJA — adiciona uma foto por link (posição 1 = principal)' })
  async adicionarFoto(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(fotoSchema)) dto: z.infer<typeof fotoSchema>,
  ) {
    const e = this.empresa(user);
    const antes = await this.fotos(e, id);
    const resposta = await this.dafiti.enviar(e, 'POST', `/v2/product-set/${id}/images`, {
      displayUrl: dto.url,
      ...(dto.posicao ? { position: dto.posicao } : {}),
    });
    return { antes, depois: await this.fotos(e, id), resposta };
  }

  @Post(':id/fotos/:fotoId')
  @ApiOperation({ summary: 'MEXE NA LOJA — troca a imagem e/ou a posição de uma foto' })
  async editarFoto(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('fotoId', ParseIntPipe) fotoId: number,
    @Body(new ZodValidationPipe(fotoEditarSchema)) dto: z.infer<typeof fotoEditarSchema>,
  ) {
    const e = this.empresa(user);
    const antes = await this.fotos(e, id);
    await this.dafiti.enviar(e, 'PATCH', `/v2/product-set/${id}/images/${fotoId}`, {
      ...(dto.url ? { displayUrl: dto.url } : {}),
      ...(dto.posicao ? { position: dto.posicao } : {}),
    });
    return { antes, depois: await this.fotos(e, id) };
  }

  @Post(':id/fotos/:fotoId/remover')
  @ApiOperation({ summary: 'MEXE NA LOJA — tira uma foto do anúncio' })
  async removerFoto(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('fotoId', ParseIntPipe) fotoId: number,
  ) {
    const e = this.empresa(user);
    const antes = await this.fotos(e, id);
    await this.dafiti.enviar(e, 'DELETE', `/v2/product-set/${id}/images/${fotoId}`);
    return { antes, depois: await this.fotos(e, id) };
  }
}
