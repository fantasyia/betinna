import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { IntegracoesService } from '@modules/integracoes/integracoes.service';
import { OmieClientService } from './omie-client.service';
import { OmieMapper } from './omie.mapper';

export type OmieSyncModo = 'incremental' | 'completo';

export interface OmieProdutosSyncResult {
  empresaId: string;
  modo: OmieSyncModo;
  totalProcessados: number;
  inseridos: number;
  atualizados: number;
  /** Pulados por não terem mudado desde último sync (apenas no modo incremental). */
  ignorados: number;
  paginas: number;
  duracaoMs: number;
  /** Limiar usado no filtro incremental. */
  desde?: Date;
}

export interface OmieSyncOptions {
  /**
   * `incremental` (default): apenas produtos com `data_alteracao` > `IntegracaoConexao.ultimoSync`.
   * `completo`: força importação de todos (ignora ultimoSync). Use após mudanças massivas
   * no OMIE ou pra primeira carga.
   */
  modo?: OmieSyncModo;
}

@Injectable()
export class OmieProdutosService {
  private readonly logger = new Logger(OmieProdutosService.name);
  private static readonly REGISTROS_POR_PAGINA = 50;

  constructor(
    private readonly prisma: PrismaService,
    private readonly omie: OmieClientService,
    private readonly integracoes: IntegracoesService,
  ) {}

  async sync(
    empresaId: string,
    options: OmieSyncOptions = {},
  ): Promise<OmieProdutosSyncResult> {
    const start = Date.now();
    const modo: OmieSyncModo = options.modo ?? 'incremental';
    const desde = modo === 'incremental' ? await this.obterUltimoSync(empresaId) : undefined;

    let pagina = 1;
    let totalPaginas = 1;
    let inseridos = 0;
    let atualizados = 0;
    let ignorados = 0;
    let totalProcessados = 0;

    do {
      const response = await this.omie.listarProdutos(
        empresaId,
        pagina,
        OmieProdutosService.REGISTROS_POR_PAGINA,
      );
      totalPaginas = response.total_de_paginas;

      for (const o of response.produto_servico_cadastro) {
        // Filtro incremental: pula se data_alteracao <= desde
        if (modo === 'incremental' && desde) {
          const alterado = OmieMapper.omieDateTimeToDate(o.data_alteracao, o.hora_alteracao);
          if (alterado && alterado.getTime() <= desde.getTime()) {
            ignorados++;
            continue;
          }
        }

        const payload = OmieMapper.produtoToPrismaUpsert(empresaId, o);
        if (!payload) continue;

        const existing = await this.prisma.produto.findUnique({
          where: payload.where,
          select: { id: true },
        });
        if (existing) {
          await this.prisma.produto.update({
            where: { id: existing.id },
            data: payload.update,
          });
          atualizados++;
        } else {
          await this.prisma.produto.create({ data: payload.create });
          inseridos++;
        }
        totalProcessados++;
      }

      pagina++;
    } while (pagina <= totalPaginas);

    await this.integracoes.registrarSyncOk(empresaId, 'omie');

    const result: OmieProdutosSyncResult = {
      empresaId,
      modo,
      totalProcessados,
      inseridos,
      atualizados,
      ignorados,
      paginas: totalPaginas,
      duracaoMs: Date.now() - start,
      desde,
    };
    this.logger.log(
      `Sync produtos OMIE empresa ${empresaId} [${modo}]: ${inseridos} novos, ${atualizados} atualizados, ${ignorados} sem alteração (${result.duracaoMs}ms)`,
    );
    return result;
  }

  private async obterUltimoSync(empresaId: string): Promise<Date | undefined> {
    const conn = await this.prisma.integracaoConexao.findUnique({
      where: { empresaId_servico: { empresaId, servico: 'omie' } },
      select: { ultimoSync: true },
    });
    return conn?.ultimoSync ?? undefined;
  }
}
