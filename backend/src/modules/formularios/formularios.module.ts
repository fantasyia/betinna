import { Module } from '@nestjs/common';
import { FormulariosController, FormulariosPublicoController } from './formularios.controller';
import { FormulariosService } from './formularios.service';

@Module({
  controllers: [FormulariosController, FormulariosPublicoController],
  providers: [FormulariosService],
  exports: [FormulariosService],
})
export class FormulariosModule {}
