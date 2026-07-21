import { Injectable, Logger } from '@nestjs/common';
import { parse } from 'papaparse';
import type { Prisma, LeadEtapa } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { ForbiddenException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { getCallerEmpresaId } from '@shared/utils/auth-context';
import { normalizarTelefoneIntl } from '@shared/validators/br-validators';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import type {
  ImportClientesDto,
  ImportLeadsDto,
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

    const rows = dto.rows ?? this.parseCsv(dto.csv ?? '');
    return this.processarLote(
      rows,
      dto.dryRun,
      dto.onDuplicate,
      async (linha, _idx) => {
        const nome = (linha.nome ?? linha.razao_social ?? linha['razão social'] ?? '').trim();
        if (!nome) return { ok: false, motivo: 'nome obrigatório' };

        const cnpj = limpaCnpj(linha.cnpj ?? linha.documento ?? '');
        const email = (linha.email ?? linha['e-mail'] ?? '').trim().toLowerCase() || null;
        const telefoneRaw = (linha.telefone ?? linha.celular ?? linha.fone ?? '').trim();
        // E.164 (assume BR se vier sem DDI); mantém o cru se não der pra validar.
        const telefone = telefoneRaw ? (normalizarTelefoneIntl(telefoneRaw) ?? telefoneRaw) : null;
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

  // ─── Leads (orquestração — import em lote) ────────────────────────────

  async importarLeads(user: AuthenticatedUser, dto: ImportLeadsDto): Promise<ImportResultDto> {
    const empresaId = this.requireEmpresa(user);
    if (!['ADMIN', 'DIRECTOR', 'GERENTE'].includes(user.role)) {
      throw new ForbiddenException(
        'Apenas ADMIN/DIRECTOR/GERENTE podem importar leads',
        ErrorCode.INSUFFICIENT_PERMISSIONS,
      );
    }

    const rows = (dto.rows ?? this.parseCsv(dto.csv ?? '')).slice(0, MAX_LINHAS);
    const alvo = await this.resolverFunilEtapa(empresaId, dto.funilId, dto.funilEtapaId);

    return this.processarLote(
      rows,
      dto.dryRun,
      dto.onDuplicate,
      async (linha) => {
        const nome = (linha.nome ?? linha.contato ?? linha.razao_social ?? '').trim();
        if (!nome) return { ok: false, motivo: 'nome obrigatório' };

        const telefoneRaw = (
          linha.telefone ??
          linha.whatsapp ??
          linha.celular ??
          linha.fone ??
          ''
        ).trim();
        // E.164 (assume BR se vier sem DDI); mantém o cru se não der pra validar.
        const telefone = telefoneRaw ? (normalizarTelefoneIntl(telefoneRaw) ?? telefoneRaw) : null;
        const email = (linha.email ?? linha['e-mail'] ?? '').trim().toLowerCase() || null;
        const cidade = (linha.cidade ?? '').trim() || null;
        const uf = (linha.uf ?? linha.estado ?? '').trim().toUpperCase().slice(0, 2) || null;
        const segmento = (linha.segmento ?? linha.ramo ?? '').trim() || null;
        const empresaLead =
          (linha.empresa ?? linha.razao_social ?? linha['razão social'] ?? '').trim() || null;
        const valorEstimado =
          parseDecimal(linha.valor ?? linha.valor_estimado ?? linha['valor estimado']) ?? 0;
        // Prioridade pro disparo em lote ("coluna LEO"): menor = libera antes.
        const prioridadeRaw = (linha.prioridade ?? linha.ordem ?? linha.leo ?? '').trim();
        const ordemPrioridade =
          prioridadeRaw && Number.isFinite(Number(prioridadeRaw)) ? Number(prioridadeRaw) : null;

        // Dedup por telefone dentro da empresa.
        let existente: { id: string } | null = null;
        if (telefone) {
          existente = await this.prisma.lead.findFirst({
            where: { empresaId, contatoTelefone: telefone },
            select: { id: true },
          });
        }

        const variaveis: Record<string, string> = { origem: 'importacao_excel' };
        if (empresaLead) variaveis.empresa = empresaLead;

        const data: Prisma.LeadUncheckedCreateInput = {
          empresaId,
          nome,
          contatoNome: nome,
          contatoTelefone: telefone,
          contatoEmail: email,
          cidade,
          uf,
          segmento,
          valorEstimado,
          ordemPrioridade,
          canalOrigem: 'OUTRO',
          etapa: alvo.etapa,
          funilId: alvo.funilId,
          funilEtapaId: alvo.funilEtapaId,
          // Porta de entrada explícita. Este caminho monta o `data` na mão (não
          // passa pelo leads.service.create), então o default "manual_rep" de lá
          // não vale aqui — sem isto o lead nascia com origemCadastro NULO e
          // "sem UTM porque veio de planilha" virava indistinguível de
          // "rastreio quebrado", que é justamente o que o campo existe pra separar.
          origemCadastro: 'importacao',
          variaveis: variaveis as Prisma.InputJsonValue,
        };
        return { ok: true, existente, data };
      },
      async (data, existenteId, dryRun) => {
        if (dryRun) return existenteId ?? 'dry-run';
        if (existenteId) {
          // ⚠️ Lead que JÁ EXISTE: o import não pode destruir o que ele acumulou.
          //
          // 1) `variaveis` é JSON — no Prisma, gravar o campo SUBSTITUI o valor
          //    inteiro. Passar o objetinho do import direto apagava o
          //    `variaveis.atribuicao` (1º e último toque da UTM), junto com
          //    classificação da IA, histórico etc. Por isso: MERGE, não replace.
          // 2) `origemCadastro` fica FORA do update: a porta de entrada é do
          //    PRIMEIRO cadastro. Uma reimportação não transforma retroativamente
          //    um lead que veio do site em lead "de importação".
          const { origemCadastro: _porta, variaveis: novas, ...resto } = data;
          const atual = await this.prisma.lead.findUnique({
            where: { id: existenteId },
            select: { variaveis: true },
          });
          const base =
            atual?.variaveis &&
            typeof atual.variaveis === 'object' &&
            !Array.isArray(atual.variaveis)
              ? (atual.variaveis as Record<string, unknown>)
              : {};
          const mescladas = { ...base, ...((novas ?? {}) as Record<string, unknown>) };
          const r = await this.prisma.lead.update({
            where: { id: existenteId },
            data: { ...resto, variaveis: mescladas as Prisma.InputJsonValue },
            select: { id: true },
          });
          return r.id;
        }
        const r = await this.prisma.lead.create({ data, select: { id: true } });
        return r.id;
      },
    );
  }

  /** Resolve o funil/etapa alvo do import: etapa explícita → funil (ou padrão) → legado. */
  private async resolverFunilEtapa(
    empresaId: string,
    funilId?: string,
    funilEtapaId?: string,
  ): Promise<{ funilId: string | null; funilEtapaId: string | null; etapa: LeadEtapa }> {
    if (funilEtapaId) {
      const et = await this.prisma.funilEtapa.findFirst({
        where: { id: funilEtapaId, funil: { empresaId } },
        select: { id: true, funilId: true, tipo: true },
      });
      if (et) return { funilId: et.funilId, funilEtapaId: et.id, etapa: etapaEnum(et.tipo) };
    }
    const funilAlvo = funilId
      ? await this.prisma.funil.findFirst({
          where: { id: funilId, empresaId },
          select: { id: true },
        })
      : await this.prisma.funil.findFirst({
          where: { empresaId, isPadrao: true },
          select: { id: true },
        });
    if (funilAlvo) {
      const primeira = await this.prisma.funilEtapa.findFirst({
        where: { funilId: funilAlvo.id },
        orderBy: { ordem: 'asc' },
        select: { id: true, tipo: true },
      });
      return {
        funilId: funilAlvo.id,
        funilEtapaId: primeira?.id ?? null,
        etapa: primeira ? etapaEnum(primeira.tipo) : 'NOVO',
      };
    }
    return { funilId: null, funilEtapaId: null, etapa: 'NOVO' };
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

/** Mapeia o tipo da FunilEtapa pro enum legado LeadEtapa (sincronia da coluna `etapa`). */
function etapaEnum(tipo: string): LeadEtapa {
  if (tipo === 'GANHO') return 'GANHO';
  if (tipo === 'PERDIDO') return 'PERDIDO';
  return 'NOVO';
}

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
