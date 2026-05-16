import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { loadAndValidateEnv } from './env.schema';
import { EnvService } from './env.service';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
      validate: loadAndValidateEnv,
      cache: true,
    }),
  ],
  providers: [EnvService],
  exports: [EnvService],
})
export class EnvModule {}
