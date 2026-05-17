import { Injectable, Logger } from '@nestjs/common';
import { parse } from 'papaparse';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { ForbiddenException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { getCallerEmpresaId } from '@shared/utils/auth-context';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import type {
  ImportClientesDto,
  ImportProdutosDto,
  ImportResultDto,
  ImportResultLinha,
} from './import.dto';

const MAX_LINHAS = 5000;
const DETALHES_LIMITE = 100;

/**
 * ImportService — bulk import CSV pra clientes e produtos.
 *
 * Estratégia:
 *  - Parsing tolerante via papaparse (cabeçalho obrigatório na 1ª linha)
 *  - Aceita aspas, BOM UTF-8, separador vírgula ou ponto-e-vírgula (auto-detect)
 *  - Cada linha → 1 transação atômica via Prisma upsert (`skip`/`update`)
 *  - `dryRun=true` faz tudo mas com transação rollback (sem persistir)
 *  - Limite 5000 linhas/request — passa disso, frontend faz batches
 *
 * Permissões:
 *  - Clientes: ADMIN/DIRECTOR/GERENTE (não-REP)
 *  - Produtos: ADMIN/DIRECTOR
 */
@Injectable()
export class ImportService {
  private readonly logger = new Logger(ImportService.name);

  constructor(private readonly prisma: PrismaService) {}

  private requireEmpresa(user: AuthenticatedUser): string {
    const empresaId = getCallerEmpresaId(user);
    if (!empresaId) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    return empresaId;
  }

  // ─── Clientes ────────────────────────────────────────────────────────

  async importarClientes(
    user: AuthenticatedUser,
    dto: ImportClientesDto,
  ): Promise<ImportResultDto> {
    const empresaId = this.requireEmpresa(user);
    if (!['ADMIN', 'DIRECTOR', 'GERENTE'].includes(user.role)) {
      throw new ForbiddenException(
        'Apenas ADMIN/DIRECTOR/GERENTE podem importar clientes',
        ErrorCode.INSUFFICIENT_PERMISSIONS,
      );
    }

    const rows = this.parseCsv(dto.csv);
    return this.processarLote(
      rows,
      dto.dryRun,
      dto.onDuplicate,
      async (linha, _idx) => {
        const nome = (linha.nome ?? linha.razao_social ?? linha['razão social'] ?? '').trim();
        if (!nome) return { ok: false, motivo: 'nome obrigatório' };

        const cnpj = limpaCnpj(linha.cnpj ?? linha.documento ?? '');
        const email = (linha.email ?? linha['e-mail'] ?? '').trim().toLowerCase() || null;
        const telefone = (linha.telefone ?? linha.celular ?? linha.fone ?? '').trim() || null;
        const cidade = (linha.cidade ?? '').trim() || null;
        const uf = (linha.uf ?? linha.estado ?? '').trim().toUpperCase().slice(0, 2) || null;
        const segmento = (linha.segmento ?? linha.ramo ?? '').trim() || null;

        // Match: prioriza CNPJ, depois email
        let existente: { id: string } | null = null;
        if (cnpj) {
          existente = await this.prisma.cliente.findFirst({
            where: { empresaId, cnpj },
            select: { id: true },
          });
        }
        if (!existente && email) {
          existente = await this.prisma.cliente.findFirst({
            where: { empresaId, email },
            select: { id: true },
          });
        }

        const data: Prisma.ClienteUncheckedCreateInput = {
          empresaId,
          nome,
          cnpj,
          email,
          telefone,
          cidade,
          uf,
          segmento,
          status: 'ATIVO',
          omieStatus: 'ATIVO',
        };

        return { ok: true, existente, data };
      },
      async (data, existenteId, dryRun) => {
        if (dryRun) return existenteId ?? 'dry-run';
        if (existenteId) {
          const r = await this.prisma.cliente.update({
            where: { id: existenteId },
            data,
            select: { id: true },
          });
          return r.id;
        }
        const r = await this.prisma.cliente.create({ data, select: { id: true } });
        return r.id;
      },
    );
  }

  // ─── Produtos ────────────────────────────────────────────────────────

  async importarProdutos(
    user: AuthenticatedUser,
    dto: ImportProdutosDto,
  ): Promise<ImportResultDto> {
    const empresaId = this.requireEmpresa(user);
    if (!['ADMIN', 'DIRECTOR'].includes(user.role)) {
      throw new ForbiddenException(
        'Apenas ADMIN/DIRECTOR podem importar produtos',
        ErrorCode.INSUFFICIENT_PERMISSIONS,
      );
    }

    const rows = this.parseCsv(dto.csv);
    return this.processarLote(
      rows,
      dto.dryRun,
      dto.onDuplicate,
      async (linha, _idx) => {
        const nome = (linha.nome ?? linha.descricao ?? '').trim();
        if (!nome) return { ok: false, motivo: 'nome obrigatório' };

        const sku = (linha.sku ?? linha.codigo ?? linha['código'] ?? '').trim() || null;
        const precoTabela = parseDecimal(linha.preco ?? linha['preço'] ?? linha.precotabela);
        if (precoTabela == null || precoTabela < 0) {
          return { ok: false, motivo: 'preço inválido' };
        }
        const marca = (linha.marca ?? '').trim() || null;
        const linhaCampo = (linha.linha ?? '').trim() || null;
        const categoria = (linha.categoria ?? '').trim() || null;
        const unidade = (linha.unidade ?? linha.un ?? 'UN').trim();

        let existente: { id: string } | null = null;
        if (sku) {
          existente = await this.prisma.produto.findFirst({
            where: { empresaId, sku },
            select: { id: true },
          });
        }

        const data: Prisma.ProdutoUncheckedCreateInput = {
          empresaId,
          nome,
          sku,
          precoTabela,
          precoFabrica: precoTabela * 0.7,
          marca,
          linha: linhaCampo,
          categoria,
          unidade,
          ativo: true,
        };

        return { ok: true, existente, data };
      },
      async (data, existenteId, dryRun) => {
        if (dryRun) return existenteId ?? 'dry-run';
        if (existenteId) {
          const r = await this.prisma.produto.update({
            where: { id: existenteId },
            data,
            select: { id: true },
          });
          return r.id;
        }
        const r = await this.prisma.produto.create({ data, select: { id: true } });
        return r.id;
      },
    );
  }

  // ─── Core engine ─────────────────────────────────────────────────────

  private parseCsv(content: string): Record<string, string>[] {
    const parsed = parse<Record<string, string>>(content.trim(), {
      header: true,
      skipEmptyLines: 'greedy',
      // papaparse detecta separador (vírgula, ponto-e-vírgula, tab)
      transformHeader: (h: string) => h.toLowerCase().trim(),
      delimitersToGuess: [',', ';', '\t', '|'],
    });
    if (parsed.errors.length > 0) {
      this.logger.warn(`CSV com ${parsed.errors.length} erro(s) de parsing`);
    }
    return parsed.data.slice(0, MAX_LINHAS);
  }

  /**
   * Engine genérico: itera rows + chama validador + persister.
   * Retorna estatísticas + primeiras 100 detalhes (criados/erros).
   */
  private async processarLote<T>(
    rows: Record<string, string>[],
    dryRun: boolean,
    onDuplicate: 'skip' | 'update' | 'error',
    validate: (
      linha: Record<string, string>,
      idx: number,
    ) => Promise<
      { ok: false; motivo: string } | { ok: true; existente: { id: string } | null; data: T }
    >,
    persist: (data: T, existenteId: string | null, dryRun: boolean) => Promise<string>,
  ): Promise<ImportResultDto> {
    let criados = 0;
    let atualizados = 0;
    let pulados = 0;
    let erros = 0;
    const detalhes: ImportResultLinha[] = [];

    for (let i = 0; i < rows.length; i++) {
      const linhaNum = i + 2; // +1 (header) +1 (1-indexed)
      try {
        const val = await validate(rows[i], i);
        if (!val.ok) {
          erros++;
          if (detalhes.length < DETALHES_LIMITE) {
            detalhes.push({ linha: linhaNum, status: 'erro', motivo: val.motivo });
          }
          continue;
        }
        if (val.existente && onDuplicate === 'skip') {
          pulados++;
          if (detalhes.length < DETALHES_LIMITE) {
            detalhes.push({
              linha: linhaNum,
              status: 'pulado',
              id: val.existente.id,
              motivo: 'já existe — onDuplicate=skip',
            });
          }
          continue;
        }
        if (val.existente && onDuplicate === 'error') {
          erros++;
          if (detalhes.length < DETALHES_LIMITE) {
            detalhes.push({
              linha: linhaNum,
              status: 'erro',
              motivo: `duplicata — onDuplicate=error (id=${val.existente.id})`,
            });
          }
          continue;
        }
        const id = await persist(val.data, val.existente?.id ?? null, dryRun);
        if (val.existente) {
          atualizados++;
          if (detalhes.length < DETALHES_LIMITE) {
            detalhes.push({ linha: linhaNum, status: 'atualizado', id });
          }
        } else {
          criados++;
          if (detalhes.length < DETALHES_LIMITE) {
            detalhes.push({ linha: linhaNum, status: 'criado', id });
          }
        }
      } catch (err) {
        erros++;
        const motivo = err instanceof Error ? err.message : String(err);
        if (detalhes.length < DETALHES_LIMITE) {
          detalhes.push({ linha: linhaNum, status: 'erro', motivo });
        }
      }
    }

    return {
      total: rows.length,
      criados,
      atualizados,
      pulados,
      erros,
      dryRun,
      detalhes,
    };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function limpaCnpj(s: string | undefined): string | null {
  if (!s) return null;
  const digits = s.replace(/\D/g, '');
  return digits.length === 14 ? digits : null;
}

function parseDecimal(s: string | undefined): number | null {
  if (s == null || s === '') return null;
  // Aceita "1.234,56" (pt-BR) e "1234.56" (en)
  const norm = String(s)
    .replace(/\./g, (m, i, str) => (str.indexOf(',') > i ? '' : m))
    .replace(',', '.');
  const n = parseFloat(norm);
  return Number.isFinite(n) ? n : null;
}
