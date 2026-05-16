import { Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { Audit } from '@shared/decorators/audit.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { CAMPANHA_ENVIO_QUEUE } from '@modules/campanhas/campanha-envio.types';
import { FLUXO_QUEUE } from '@modules/fluxos/fluxo-executor.types';
import { DeadLetterService } from './dead-letter.service';

/**
 * Admin endpoint pra visualizar e retentar jobs no dead-letter (Sprint 3 FIX 3).
 *
 * Acesso restrito ADMIN — operação delicada (retry pode amplificar bug se
 * causa raiz não foi resolvida).
 */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/dead-letter')
export class DeadLetterController {
  constructor(
    private readonly deadLetter: DeadLetterService,
    @InjectQueue(CAMPANHA_ENVIO_QUEUE) private readonly campanhaQueue: Queue,
    @InjectQueue(FLUXO_QUEUE) private readonly fluxoQueue: Queue,
  ) {}

  @Get()
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Lista os últimos 50 jobs no dead-letter (admin only)' })
  async list() {
    return this.deadLetter.list(50);
  }

  @Post(':id/retry')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'dead_letter_retry', resource: 'job', resourceIdFrom: 'params.id' })
  @ApiOperation({
    summary: 'Reenvia um job dead-letter pra queue original (ADMIN only)',
  })
  async retry(@Param('id') id: string) {
    // Registry dinâmico — adicione novas queues aqui conforme criar
    const registry = new Map<string, Queue>([
      [CAMPANHA_ENVIO_QUEUE, this.campanhaQueue],
      [FLUXO_QUEUE, this.fluxoQueue],
    ]);
    return this.deadLetter.retry(id, registry);
  }
}
