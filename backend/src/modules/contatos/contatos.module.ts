import { Module } from '@nestjs/common';
import { LeadsModule } from '@modules/leads/leads.module';
import { PermissionsModule } from '@modules/permissions/permissions.module';
import { ContatosController } from './contatos.controller';
import { ContatosService } from './contatos.service';
import { ContatosMesclagemService } from './contatos-mesclagem.service';

@Module({
  imports: [LeadsModule, PermissionsModule],
  controllers: [ContatosController],
  providers: [ContatosService, ContatosMesclagemService],
})
export class ContatosModule {}
