import { Injectable, OnModuleInit, RequestMethod } from '@nestjs/common';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { catalogo, juntarCaminho, type RotaApi } from './rotas-api';

/** Chave do @ApiOperation (API_OPERATION do @nestjs/swagger, não exportada). */
const API_OPERATION = 'swagger/apiOperation';

/**
 * Lista as rotas da API lendo os controllers no boot — o catálogo nunca fica
 * velho: rota nova entra sozinha no MCP (escopo `tudo`, 26/10).
 */
@Injectable()
export class RotasApiService implements OnModuleInit {
  private rotas: RotaApi[] = [];

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
  ) {}

  onModuleInit(): void {
    const out: RotaApi[] = [];
    for (const w of this.discovery.getControllers()) {
      const tipo = w.metatype as (new (...a: unknown[]) => unknown) | undefined;
      const inst = w.instance as Record<string, unknown> | undefined;
      if (!tipo || !inst) continue;
      const bases = [this.reflector.get<string | string[]>(PATH_METADATA, tipo) ?? ''].flat();
      const proto = Object.getPrototypeOf(inst) as Record<string, unknown>;
      for (const nome of this.scanner.getAllMethodNames(proto)) {
        const fn = proto[nome] as (...a: unknown[]) => unknown;
        const caminhos = this.reflector.get<string | string[] | undefined>(PATH_METADATA, fn);
        const verbo = this.reflector.get<RequestMethod | undefined>(METHOD_METADATA, fn);
        if (caminhos === undefined || verbo === undefined) continue;
        const op = this.reflector.get<{ summary?: string } | undefined>(API_OPERATION, fn);
        for (const base of bases)
          for (const c of [caminhos].flat())
            out.push({
              metodo: RequestMethod[verbo],
              caminho: juntarCaminho(base, c),
              resumo: op?.summary ?? null,
            });
      }
    }
    this.rotas = out;
  }

  listar(filtro?: string): RotaApi[] {
    return catalogo(this.rotas, filtro);
  }
}
