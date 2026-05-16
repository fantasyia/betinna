import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Public } from '@shared/decorators/public.decorator';

/**
 * GET /version — Sprint 5 FIX 7.
 *
 * Retorna a versão atual rodando, lida do package.json no boot.
 *
 * Útil para:
 *  - Confirmar qual versão está em produção sem precisar SSH
 *  - Releases comparativos ("antes do v1.0.1 estava buggy")
 *  - Monitoring que valida via curl no deploy
 *
 * Cached no boot — leitura única, não dispara fs read a cada request.
 */
@ApiTags('health')
@Controller('version')
export class VersionController {
  private readonly versionInfo = this.loadVersion();

  @Public()
  @Get()
  @ApiOperation({ summary: 'Versão atual do backend (lida de package.json no boot)' })
  version(): {
    version: string;
    name: string;
    nodeEnv: string;
    railwayEnv: string;
    serviceType: string;
    buildTimestamp: string;
  } {
    return this.versionInfo;
  }

  private loadVersion() {
    let pkg: { version?: string; name?: string } = {};
    try {
      // dist/main.js está em /app/dist em produção;
      // package.json fica em /app/package.json (copiado pelo Dockerfile)
      const cwd = process.cwd();
      const pkgPath = join(cwd, 'package.json');
      pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as typeof pkg;
    } catch {
      // Fallback se package.json não encontrado (build atípico)
      pkg = { version: 'unknown', name: 'betinna-backend' };
    }
    return {
      version: pkg.version ?? 'unknown',
      name: pkg.name ?? 'betinna-backend',
      nodeEnv: process.env.NODE_ENV ?? 'development',
      railwayEnv: process.env.RAILWAY_ENVIRONMENT ?? '',
      serviceType: process.env.SERVICE_TYPE ?? 'api',
      // Capturado no boot — útil pra detectar deploys "fantasmas"
      buildTimestamp: new Date().toISOString(),
    };
  }
}
