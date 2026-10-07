import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { BusinessRuleException } from '@shared/errors/app-exception';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { MAX_VIDEO_BYTES, VitrineFotosService } from './vitrine-fotos.service';

interface ArquivoRecebido {
  buffer: Buffer;
  size: number;
}

const ordemSchema = z.object({
  fotoIds: z.array(z.string().min(1)).min(1).max(12),
  /** Grupo cor × linha; ausente/null = as fotos gerais da cor. */
  linhaId: z.string().min(1).nullable().optional(),
});
const linhaIdSchema = z
  .string()
  .trim()
  .max(40)
  .optional()
  .transform((v) => v || null);
const prepararVideoSchema = z.object({
  tamanhoBytes: z.number().int().positive().max(MAX_VIDEO_BYTES),
});
const confirmarVideoSchema = z.object({
  storagePath: z.string().min(1).max(300),
  nomeArquivo: z.string().trim().max(120).optional(),
  tamanhoBytes: z.number().int().positive().max(MAX_VIDEO_BYTES).optional(),
});
const fracao = z.number().min(0).max(1);
const amostraSchema = z.object({ x: fracao, y: fracao }).nullable();
const dimSchema = z.coerce.number().int().min(1).max(10_000).optional();

/** Fotos (por cor do modelo) e vídeos (por modelo) do cadastro da vitrine. */
@ApiTags('vitrine')
@ApiBearerAuth()
@Roles('ADMIN', 'DIRECTOR')
@Controller('vitrine/admin')
export class VitrineMidiaController {
  constructor(private readonly fotos: VitrineFotosService) {}

  @Get('cores-modelo/:modeloCorId/fotos')
  listarFotos(@CurrentUser() user: AuthenticatedUser, @Param('modeloCorId') modeloCorId: string) {
    return this.fotos.listar(user, modeloCorId);
  }

  @Post('cores-modelo/:modeloCorId/fotos')
  @ApiOperation({ summary: 'Envia uma foto (WebP já otimizado no navegador) + miniatura' })
  @ApiConsumes('multipart/form-data')
  // Teto no multer: sem `limits` o corpo inteiro entra na memória antes do service medir.
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'foto', maxCount: 1 },
        { name: 'thumb', maxCount: 1 },
      ],
      { limits: { fileSize: 2 * 1024 * 1024, files: 2 } },
    ),
  )
  enviarFoto(
    @CurrentUser() user: AuthenticatedUser,
    @Param('modeloCorId') modeloCorId: string,
    @UploadedFiles() arquivos: { foto?: ArquivoRecebido[]; thumb?: ArquivoRecebido[] } | undefined,
    @Body() body: { largura?: string; altura?: string; linhaId?: string },
  ) {
    const foto = arquivos?.foto?.[0];
    if (!foto) throw new BusinessRuleException('Nenhuma foto enviada');
    return this.fotos.enviar(
      user,
      modeloCorId,
      foto,
      arquivos?.thumb?.[0],
      { largura: dimSchema.parse(body?.largura), altura: dimSchema.parse(body?.altura) },
      linhaIdSchema.parse(body?.linhaId),
    );
  }

  @Put('cores-modelo/:modeloCorId/fotos/ordem')
  @ApiOperation({ summary: 'Reordena as fotos da cor (a 1ª é a capa)' })
  reordenarFotos(
    @CurrentUser() user: AuthenticatedUser,
    @Param('modeloCorId') modeloCorId: string,
    @Body(new ZodValidationPipe(ordemSchema)) dto: z.infer<typeof ordemSchema>,
  ) {
    return this.fotos.reordenar(user, modeloCorId, dto.fotoIds, dto.linhaId ?? null);
  }

  @Put('cores-modelo/:modeloCorId/amostra')
  @ApiOperation({ summary: 'Ponto da capa que vira a bolinha da cor (null = automático)' })
  definirAmostra(
    @CurrentUser() user: AuthenticatedUser,
    @Param('modeloCorId') modeloCorId: string,
    @Body(new ZodValidationPipe(z.object({ ponto: amostraSchema })))
    dto: { ponto: z.infer<typeof amostraSchema> },
  ) {
    return this.fotos.definirAmostra(user, modeloCorId, dto.ponto);
  }

  @Put('fotos/:id/rodizio')
  @ApiOperation({
    summary: 'Foto no rodízio da abertura (cada cliente vê uma das marcadas primeiro)',
  })
  marcarRodizio(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(z.object({ rodizio: z.boolean() }))) dto: { rodizio: boolean },
  ) {
    return this.fotos.marcarRodizio(user, id, dto.rodizio);
  }

  @Delete('fotos/:id')
  excluirFoto(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.fotos.excluir(user, id);
  }

  @Post('modelos/:id/videos/preparar')
  @ApiOperation({ summary: 'URL assinada pra subir um MP4 direto pro Storage' })
  prepararVideo(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') modeloId: string,
    @Body(new ZodValidationPipe(prepararVideoSchema)) dto: z.infer<typeof prepararVideoSchema>,
  ) {
    return this.fotos.prepararVideo(user, modeloId, dto.tamanhoBytes);
  }

  @Post('modelos/:id/videos')
  @ApiOperation({ summary: 'Registra o vídeo depois que o upload terminou' })
  confirmarVideo(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') modeloId: string,
    @Body(new ZodValidationPipe(confirmarVideoSchema)) dto: z.infer<typeof confirmarVideoSchema>,
  ) {
    return this.fotos.confirmarVideo(user, modeloId, dto);
  }

  @Delete('videos/:id')
  excluirVideo(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.fotos.excluirVideo(user, id);
  }
}
