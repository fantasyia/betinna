import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { BusinessRuleException } from '@shared/errors/app-exception';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { FichaCosturaService } from './ficha-costura.service';
import { type CosturaDto, costuraSchema } from './fichas.dto';
import type { ArquivoFoto } from './insumo-fotos.service';

/** Ficha de costura da grade (#03 Modelista, 01/11). Sai na via da facção da OP. */
@ApiTags('erp')
@ApiBearerAuth()
@Roles('ADMIN', 'DIRECTOR')
@Controller('erp/fichas/:modeloLinhaId/costura')
export class FichaCosturaController {
  constructor(private readonly svc: FichaCosturaService) {}

  @Get()
  @ApiOperation({ summary: 'Ficha de costura da grade (null = ainda não tem)' })
  ver(@CurrentUser() user: AuthenticatedUser, @Param('modeloLinhaId') id: string) {
    return this.svc.ver(user, id);
  }

  @Put()
  @ApiOperation({ summary: 'Grava a ficha de costura (substitui a ficha inteira)' })
  salvar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('modeloLinhaId') id: string,
    @Body(new ZodValidationPipe(costuraSchema)) dto: CosturaDto,
  ) {
    return this.svc.salvar(user, id, dto);
  }

  @Post('imagens')
  @ApiOperation({ summary: 'Acrescenta uma imagem (WebP até 2 MB) à ficha de costura' })
  @UseInterceptors(FileInterceptor('imagem', { limits: { fileSize: 2 * 1024 * 1024, files: 1 } }))
  subirImagem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('modeloLinhaId') id: string,
    @UploadedFile() imagem: ArquivoFoto | undefined,
    @Body() body: { legenda?: string },
  ) {
    if (!imagem) throw new BusinessRuleException('Nenhuma imagem enviada');
    return this.svc.subirImagem(user, id, imagem, body?.legenda ?? null);
  }

  @Delete('imagens/:imagemId')
  @ApiOperation({ summary: 'Apaga uma imagem da ficha de costura' })
  excluirImagem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('modeloLinhaId') id: string,
    @Param('imagemId') imagemId: string,
  ) {
    return this.svc.excluirImagem(user, id, imagemId);
  }
}
