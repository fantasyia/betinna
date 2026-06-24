import { Module } from '@nestjs/common';
import { LeadsModule } from '@modules/leads/leads.module';
import { PermissionsModule } from '@modules/permissions/permissions.module';
import { ContatosController } from './contatos.controller';
import { ContatosService } from './contatos.service';

@Module({
  imports: [LeadsModule, PermissionsModule],
  controllers: [ContatosController],
  providers: [ContatosService],
})
export class ContatosModule {}
