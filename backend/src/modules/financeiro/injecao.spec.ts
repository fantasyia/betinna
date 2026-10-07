import { describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { Global, Module } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { SequenceService } from '@shared/utils/sequence.service';
import { CronLockService } from '@shared/utils/cron-lock.service';
import { EnvService } from '@config/env.service';
import { ErpModule } from '@modules/erp/erp.module';
import { EstoqueService } from '@modules/erp/estoque.service';
import { OrdensService } from '@modules/erp/ordens.service';
import { InsumosService } from '@modules/erp/insumos.service';

@Global()
@Module({
  providers: [
    { provide: PrismaService, useValue: {} },
    { provide: SequenceService, useValue: {} },
    { provide: CronLockService, useValue: {} },
    { provide: EnvService, useValue: { get: () => undefined } },
  ],
  exports: [PrismaService, SequenceService, CronLockService, EnvService],
})
class BancoFalso {}

describe('DI: ERP recebe o financeiro automático', () => {
  it('EstoqueService, OrdensService e InsumosService montam com o fin injetado', async () => {
    const m = await Test.createTestingModule({ imports: [BancoFalso, ErpModule] }).compile();
    for (const S of [EstoqueService, OrdensService, InsumosService]) {
      expect((m.get(S) as unknown as { fin?: unknown }).fin).toBeDefined();
    }
  });
});
