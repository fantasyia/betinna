import { Module } from '@nestjs/common';
import { LeadsModule } from '@modules/leads/leads.module';
import { ContatosController } from './contatos.controller';
import { ContatosService } from './contatos.service';

@Module({
  imports: [LeadsModule],
  controllers: [ContatosController],
  providers: [ContatosService],
})
export class ContatosModule {}
