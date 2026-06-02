import { Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit } from '@shared/decorators/audit.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { BackupService } from './backup.service';

/**
 * Operações de backup sob demanda (painel admin). O backup é do banco INTEIRO
 * (todos os tenants) → restrito ao ADMIN da plataforma. O backup diário
 * automático continua rodando via cron; estes endpoints são pra rodar/verificar
 * na hora.
 */
@ApiTags('backup')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('backup')
export class BackupController {
  constructor(private readonly backup: BackupService) {}

  @Get('ultimo')
  @ApiOperation({ summary: 'Metadados do último backup (data/tamanho), sem baixar' })
  ultimo() {
    return this.backup.infoUltimo();
  }

  @Post('executar')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'backup_executar', resource: 'backup' })
  @ApiOperation({ summary: 'Roda o backup do banco agora (pg_dump → Supabase Storage)' })
  executar() {
    return this.backup.executar();
  }

  @Post('verificar')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'backup_verificar', resource: 'backup' })
  @ApiOperation({ summary: 'Verifica a integridade do último backup (pg_restore --list)' })
  verificar() {
    return this.backup.verificarUltimoBackup();
  }
}
