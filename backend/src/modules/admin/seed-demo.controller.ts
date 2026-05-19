import { Body, Controller, Delete, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Audit } from '@shared/decorators/audit.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import { SeedDemoService } from './seed-demo.service';

/**
 * SeedDemoController — gerenciamento do dataset de demonstração.
 *
 * Endpoints (todos `@Roles('ADMIN', 'DIRECTOR')`):
 *  - GET    /admin/seed-demo/status?empresaId=...   contagens atuais
 *  - POST   /admin/seed-demo                        popula (idempotente, limpa antes)
 *  - DELETE /admin/seed-demo                        limpa (só isDemo=true)
 *
 * Por que ADMIN **e** DIRECTOR (D48): ADMIN é master da plataforma e usa
 * isso em onboarding de tenant novo; DIRECTOR é o mandatário do próprio
 * tenant e pode querer popular seu workspace pra demo interna sem ter que
 * pedir ajuda. Audit log registra quem fez.
 */

const runSchema = z.object({
  empresaId: z.string().min(1),
  multiplier: z.number().min(0.1).max(5).default(1),
});

const wipeSchema = z.object({
  empresaId: z.string().min(1),
});

const statusSchema = z.object({
  empresaId: z.string().min(1),
});

@ApiTags('admin')
@ApiBearerAuth()
@Roles('ADMIN', 'DIRECTOR')
@Controller('admin/seed-demo')
export class SeedDemoController {
  constructor(private readonly svc: SeedDemoService) {}

  @Get('status')
  @ApiOperation({
    summary: 'Contagens atuais de records isDemo=true por modelo da empresa',
  })
  status(@Query(new ZodValidationPipe(statusSchema)) params: z.infer<typeof statusSchema>) {
    return this.svc.status(params.empresaId);
  }

  @Post()
  @HttpCode(200)
  @Audit({ action: 'seed_demo_run', resource: 'admin', resourceIdFrom: 'body.empresaId' })
  @ApiOperation({
    summary:
      'Popula dataset de demonstração na empresa (idempotente — limpa antes). multiplier escala em [0.1, 5].',
  })
  run(@Body(new ZodValidationPipe(runSchema)) body: z.infer<typeof runSchema>) {
    return this.svc.run(body.empresaId, body.multiplier);
  }

  @Delete()
  @HttpCode(200)
  @Audit({ action: 'seed_demo_wipe', resource: 'admin', resourceIdFrom: 'body.empresaId' })
  @ApiOperation({
    summary: 'Remove TODOS os records isDemo=true da empresa (não afeta dados reais).',
  })
  wipe(@Body(new ZodValidationPipe(wipeSchema)) body: z.infer<typeof wipeSchema>) {
    return this.svc.wipe(body.empresaId);
  }
}
