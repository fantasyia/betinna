import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { IntegracoesService } from '@modules/integracoes/integracoes.service';
import { OmieClientService } from './omie-client.service';
import { OmieMapper } from './omie.mapper';
import type { OmieSyncModo, OmieSyncOptions } from './omie-produtos.service';

export interface OmieClientesSyncResult {
  empresaId: string;
  modo: OmieSyncModo;
  totalProcessados: number;
  inseridos: number;
  atualizados: number;
  ignorados: number;
  paginas: number;
  duracaoMs: number;
  desde?: Date;
}

/**
 * Sync de clientes do OMIE para nossa base local.
 *
 * Estratégia: pull paginado. Upsert por `(empresaId, codigoOmie)`.
 * OMIE é fonte da verdade — qualquer alteração local é sobrescrita.
 *
 * Modo `incremental` (default): pula clientes cuja `data_alteracao` é anterior
 * ao último sync registrado em `IntegracaoConexao.ultimoSync`.
 * Modo `completo`: força importação de todos. Use após mudanças massivas.
 *
 * Idempotente. Pode ser chamado várias vezes seguidas sem problemas.
 */
@Injectable()
export class OmieClientesService {
  private readonly logger = new Logger(OmieClientesService.name);
  private static readonly REGISTROS_POR_PAGINA = 50;

  constructor(
    private readonly prisma: PrismaService,
    private readonly omie: OmieClientService,
    private readonly integracoes: IntegracoesService,
  ) {}

  async sync(empresaId: string, options: OmieSyncOptions = {}): Promise<OmieClientesSyncResult> {
    const start = Date.now();
    // High-water-mark: carimba o INÍCIO do sync (antes do fetch) — não o fim — pra não
    // perder registros alterados no OMIE durante o processamento.
    const syncStartedAt = new Date();
    const modo: OmieSyncModo = options.modo ?? 'incremental';
    const desde = modo === 'incremental' ? await this.obterUltimoSync(empresaId) : undefined;

    let pagina = 1;
    let totalPaginas = 1;
    let inseridos = 0;
    let atualizados = 0;
    let ignorados = 0;
    let totalProcessados = 0;

    do {
      const response = await this.omie.listarClientes(
        empresaId,
        pagina,
        OmieClientesService.REGISTROS_POR_PAGINA,
      );
      totalPaginas = response.total_de_paginas;

      for (const o of response.clientes_cadastro) {
        if (modo === 'incremental' && desde) {
          const dAlt = o.info?.dAlt ?? o.data_alteracao;
          const hAlt = o.info?.hAlt ?? o.hora_alteracao;
          const alterado = OmieMapper.omieDateTimeToDate(dAlt, hAlt);
          if (alterado && alterado.getTime() <= desde.getTime()) {
            ignorados++;
            continue;
          }
        }

        const payload = OmieMapper.clienteToPrismaUpsert(empresaId, o);
        if (!payload) continue;

        // ALTA-A1: codigoOmie agora é unique composto (empresaId, codigoOmie).
        // Busca apenas dentro desta empresa — sem risco de colisão cross-tenant.
        const codigoOmie = payload.create.codigoOmie;
        const existing = codigoOmie
          ? await this.prisma.cliente.findUnique({
              where: { empresaId_codigoOmie: { empresaId, codigoOmie } },
              select: { id: true },
            })
          : null;

        if (existing) {
          await this.prisma.cliente.update({
            where: { id: existing.id },
            data: payload.update,
          });
          atualizados++;
        } else {
          await this.prisma.cliente.create({ data: payload.create });
          inseridos++;
        }
        totalProcessados++;
      }

      pagina++;
    } while (pagina <= totalPaginas);

    await this.integracoes.registrarSyncOk(empresaId, 'omie', syncStartedAt);

    const result: OmieClientesSyncResult = {
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
      `Sync clientes OMIE empresa ${empresaId} [${modo}]: ${inseridos} novos, ${atualizados} atualizados, ${ignorados} sem alteração (${result.duracaoMs}ms)`,
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
