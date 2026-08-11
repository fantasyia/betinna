import { Injectable, Logger } from '@nestjs/common';
import { parse } from 'papaparse';
import type { Prisma, LeadEtapa } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { EnvService } from '@config/env.service';
import { FluxoEventBusService } from '@modules/fluxos/fluxo-event-bus.service';
import { BusinessRuleException, ForbiddenException } from '@shared/errors/app-exception';
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
 *  - Cada linha: match (findFirst) + create/update em chamadas SEPARADAS —
 *    não há upsert nem transação por linha (a doc antiga dizia que havia).
 *  - `dryRun=true` retorna antes de qualquer escrita (não é rollback: nada
 *    chega a ser escrito; o validador só lê).
 *  - Limite 5000 linhas/request — acima disso o arquivo é REJEITADO com erro
 *    claro (antes era truncado em silêncio e o total mentia).
 *
 * Permissões:
 *  - Clientes: ADMIN/DIRECTOR/GERENTE (não-REP)
 *  - Produtos: ADMIN/DIRECTOR
 */
@Injectable()
export class ImportService {
  private readonly logger = new Logger(ImportService.name);
  /**
   * Linhas que o papaparse NÃO conseguiu ler no CSV atual. Preenchido por
   * `parseCsv` e consumido por `processarLote` (#69) — antes só iam pro log e
   * sumiam do relatório que o usuário recebe.
   */
  private errosParsing: ImportResultLinha[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: FluxoEventBusService,
    private readonly env: EnvService,
  ) {}

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

        // Match: prioriza CNPJ, depois email.
        // CNPJ compara SÓ DÍGITOS dos dois lados: o sync do OMIE grava formatado
        // ("12.345.678/0001-90") e a igualdade crua nunca casava — re-importar a
        // carteira duplicava a base inteira.
        let existente: { id: string } | null = null;
        if (cnpj) {
          const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
            SELECT id FROM "Cliente"
            WHERE "empresaId" = ${empresaId}
              AND cnpj IS NOT NULL
              AND REGEXP_REPLACE(cnpj, '[^0-9]', '', 'g') = ${cnpj}
            LIMIT 1`;
          existente = rows[0] ?? null;
        }
        if (!existente && email) {
          existente = await this.prisma.cliente.findFirst({
            where: { empresaId, email: { equals: email, mode: 'insensitive' } },
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

        // #71: mesma chave do dedup do banco (CNPJ só-dígitos > e-mail).
        return { ok: true, existente, data, chave: cnpj || email || undefined };
      },
      async (data, existenteId, dryRun) => {
        if (dryRun) return existenteId ?? 'dry-run';
        if (existenteId) {
          // Cliente que JÁ EXISTE: o import não pode reativar quem o financeiro
          // bloqueou no OMIE (D2) nem apagar campo que a planilha não trouxe.
          // status/omieStatus são do OMIE/gestão — só valem no CREATE.
          const { status: _s, omieStatus: _o, empresaId: _e, ...resto } = data;
          void _s;
          void _o;
          void _e;
          const patch = Object.fromEntries(
            Object.entries(resto).filter(([, v]) => v !== null && v !== undefined),
          );
          const r = await this.prisma.cliente.update({
            where: { id: existenteId },
            data: patch,
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
          // AUDITORIA (média): era `* 0.7` cravado, enquanto o env
          // OMIE_PRECO_FABRICA_RATIO existia e não tinha NENHUM consumidor. Duas
          // heurísticas pro mesmo número, e a do import ignorava a configuração
          // do tenant — margem e comissão saíam de bases diferentes conforme o
          // produto tivesse vindo do OMIE ou de planilha.
          precoFabrica: precoTabela * this.env.get('OMIE_PRECO_FABRICA_RATIO'),
          marca,
          linha: linhaCampo,
          categoria,
          unidade,
          ativo: true,
        };

        // #71: o dedup do banco é por SKU — mesma chave aqui.
        return { ok: true, existente, data, chave: sku || undefined };
      },
      async (data, existenteId, dryRun) => {
        if (dryRun) return existenteId ?? 'dry-run';
        if (existenteId) {
          // precoFabrica FICA DE FORA do update: aqui ele é só heurística (70%),
          // enquanto o produto existente pode ter o custo REAL vindo do OMIE.
          // Sobrescrever quebrava margem e comissão da empresa inteira.
          const { precoFabrica: _pf, empresaId: _e, ...resto } = data;
          void _pf;
          void _e;
          const r = await this.prisma.produto.update({
            where: { id: existenteId },
            data: resto,
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

    // Sem slice: o parseCsv já rejeita acima do limite, e o caminho `rows`
    // (xlsx) é barrado pelo .max(5000) do zod. Cortar aqui escondia linhas.
    const rows = dto.rows ?? this.parseCsv(dto.csv ?? '');
    const alvo = await this.resolverFunilEtapa(empresaId, dto.funilId, dto.funilEtapaId);
    // Só faz sentido com destino de funil escolhido: sem funil o lead é contato
    // puro, e disparar régua de nutrição em quem não entrou em pipeline nenhum
    // é justamente o disparo acidental que a regra nova veio evitar.
    const dispararReguas = Boolean(dto.dispararReguas) && Boolean(alvo.funilEtapaId);

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
        // `null` = coluna ausente na planilha (≠ zero informado). O update usa
        // isso pra não zerar o valor de um lead que já está em negociação.
        const valorEstimadoRaw = parseDecimal(
          linha.valor ?? linha.valor_estimado ?? linha['valor estimado'],
        );
        const valorEstimado = valorEstimadoRaw ?? 0;
        // Prioridade pro disparo em lote ("coluna LEO"): menor = libera antes.
        const prioridadeRaw = (linha.prioridade ?? linha.ordem ?? linha.leo ?? '').trim();
        const ordemPrioridade =
          prioridadeRaw && Number.isFinite(Number(prioridadeRaw)) ? Number(prioridadeRaw) : null;

        // Dedup D18: sufixo de 8 dígitos, NUNCA igualdade crua. O lead criado por
        // conversa de WhatsApp guarda o número do JID (sem '+', às vezes sem o 9º
        // dígito) — a igualdade nunca casava e a planilha duplicava a pessoa.
        // Fallback por e-mail: linha sem telefone não tinha chave nenhuma, então
        // todo reenvio da planilha duplicava essas linhas.
        let existente: { id: string } | null = null;
        const digitos = (telefone ?? '').replace(/\D/g, '');
        if (digitos.length >= 8) {
          const sufixo = digitos.slice(-8);
          const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
            SELECT id FROM "Lead"
            WHERE "empresaId" = ${empresaId}
              AND "contatoTelefone" IS NOT NULL
              AND RIGHT(REGEXP_REPLACE("contatoTelefone", '[^0-9]', '', 'g'), 8) = ${sufixo}
            ORDER BY "atualizadoEm" DESC
            LIMIT 1`;
          existente = rows[0] ?? null;
        }
        if (!existente && email) {
          existente = await this.prisma.lead.findFirst({
            where: { empresaId, contatoEmail: { equals: email, mode: 'insensitive' } },
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
        // Marca o que a PLANILHA de fato trouxe — o update só toca nesses campos.
        const _presentes = {
          valorEstimado: valorEstimadoRaw !== null,
          ordemPrioridade: ordemPrioridade !== null,
        };
        // #71: mesma chave do dedup D18 (sufixo de 8 dígitos) com fallback e-mail.
        const chaveLead =
          digitos.length >= 8 ? `tel:${digitos.slice(-8)}` : email ? `em:${email}` : undefined;
        return { ok: true, existente, data: { ...data, _presentes } as never, chave: chaveLead };
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
          // 3) etapa/funil/canalOrigem FICAM DE FORA: re-importar mirando a etapa
          //    de prospecção arrastava de volta um lead que já estava em
          //    Negociação — sem disparar LEAD_ETAPA_MUDOU e sem histórico.
          // 4) Campo ausente na planilha NÃO vira null (apagava e-mail/cidade/uf
          //    já preenchidos), e valorEstimado só muda se a coluna existe.
          const d = data as Prisma.LeadUncheckedCreateInput & {
            _presentes?: { valorEstimado: boolean; ordemPrioridade: boolean };
          };
          const presentes = d._presentes ?? { valorEstimado: false, ordemPrioridade: false };
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
          const mescladas = { ...base, ...((d.variaveis ?? {}) as Record<string, unknown>) };

          const patch: Prisma.LeadUncheckedUpdateInput = {
            variaveis: mescladas as Prisma.InputJsonValue,
          };
          if (d.nome) patch.nome = d.nome;
          if (d.contatoNome) patch.contatoNome = d.contatoNome;
          if (d.contatoTelefone) patch.contatoTelefone = d.contatoTelefone;
          if (d.contatoEmail) patch.contatoEmail = d.contatoEmail;
          if (d.cidade) patch.cidade = d.cidade;
          if (d.uf) patch.uf = d.uf;
          if (d.segmento) patch.segmento = d.segmento;
          if (presentes.valorEstimado) patch.valorEstimado = d.valorEstimado;
          if (presentes.ordemPrioridade) patch.ordemPrioridade = d.ordemPrioridade;

          const r = await this.prisma.lead.update({
            where: { id: existenteId },
            data: patch,
            select: { id: true },
          });
          return r.id;
        }
        const { _presentes: _p, ...dataCreate } = data as Prisma.LeadUncheckedCreateInput & {
          _presentes?: unknown;
        };
        void _p;
        const r = await this.prisma.lead.create({
          data: dataCreate,
          select: { id: true, nome: true, etapa: true, valorEstimado: true },
        });
        // Automação é OPT-IN e só pros leads NOVOS. Um lote de 5000 linhas com
        // isso ligado enfileira 5000 execuções de fluxo — quem importa decide,
        // marcando o checkbox no modal. Lead que já existia NUNCA dispara (não
        // é criação; re-importar a mesma planilha re-disparava a régua inteira).
        if (dispararReguas) {
          // best-effort: o bus já engole erro, mas um throw aqui derrubaria a
          // linha inteira e o lead ficaria criado marcado como falha.
          try {
            void this.bus.disparar(empresaId, 'LEAD_CRIADO', {
              leadId: r.id,
              // Bate com o `origemCadastro` gravado no lead acima — é o que
              // permite a régua filtrar "não quero lote importado".
              origemCadastro: 'importacao',
              lead: {
                id: r.id,
                nome: r.nome,
                etapa: r.etapa,
                valorEstimado: Number(r.valorEstimado),
              },
              clienteId: null,
              representanteId: null,
            });
          } catch (e) {
            this.logger.warn(
              `Falha ao disparar LEAD_CRIADO do import (lead ${r.id}): ${String(e)}`,
            );
          }
        }
        return r.id;
      },
    );
  }

  /** Resolve o funil/etapa alvo do import: etapa explícita → funil (ou padrão) → legado. */
  /**
   * Destino do lote importado.
   *
   * REGRA DE PRODUTO: lead importado só ENTRA NO FUNIL quando o import diz
   * explicitamente em qual funil E em qual etapa. Sem essa escolha, ele entra
   * como CONTATO (sem funil) — aparece em Contatos, não polui o kanban.
   *
   * Antes havia um fallback pro "funil padrão da empresa" + "primeira etapa":
   * QUALQUER importação (inclusive base de e-mail marketing, lista de reps,
   * planilha de prospecção fria) despejava tudo no pipeline principal, e depois
   * era trabalho manual tirar. O fallback SUMIU de propósito.
   */
  private async resolverFunilEtapa(
    empresaId: string,
    funilId?: string,
    funilEtapaId?: string,
  ): Promise<{ funilId: string | null; funilEtapaId: string | null; etapa: LeadEtapa }> {
    // Sem etapa escolhida = contato sem funil. Escolher só o funil não basta:
    // "em qual etapa entra" é decisão de quem importa, não default nosso.
    if (!funilEtapaId) {
      if (funilId) {
        throw new BusinessRuleException(
          'Escolha também a ETAPA do funil — sem ela os leads entram como contato, sem funil.',
        );
      }
      return { funilId: null, funilEtapaId: null, etapa: 'NOVO' };
    }

    const et = await this.prisma.funilEtapa.findFirst({
      where: { id: funilEtapaId, funil: { empresaId } },
      select: { id: true, funilId: true, tipo: true },
    });
    if (!et) {
      throw new BusinessRuleException('Etapa de destino inválida (não pertence a esta empresa).');
    }
    // Coerência: se o funil também veio, a etapa TEM que ser dele — senão o lead
    // fica com funil de um e etapa de outro e some do kanban.
    if (funilId && et.funilId !== funilId) {
      throw new BusinessRuleException('A etapa informada não pertence ao funil informado.');
    }
    return { funilId: et.funilId, funilEtapaId: et.id, etapa: etapaEnum(et.tipo) };
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
      // AUDITORIA (média): os erros do papaparse só iam pro log do servidor —
      // quem importava recebia o resultado sem nenhuma menção às linhas que o
      // parser não conseguiu ler (aspas não fechadas, coluna a mais). O total
      // batia com o que foi PARSEADO, então parecia que tudo entrou.
      // Guardados pra virar linhas de "erro" no relatório do import.
      this.logger.warn(`CSV com ${parsed.errors.length} erro(s) de parsing`);
      this.errosParsing = parsed.errors.slice(0, DETALHES_LIMITE).map((e) => ({
        // papaparse é 0-indexed e não conta o header: +2 pra bater com o que a
        // pessoa vê aberto no Excel.
        linha: typeof e.row === 'number' ? e.row + 2 : 0,
        status: 'erro' as const,
        motivo: `linha ilegível no CSV: ${e.message}`,
      }));
    } else {
      this.errosParsing = [];
    }
    // Falha ALTO em vez de truncar: o slice silencioso descartava as linhas
    // excedentes e o `total` reportava o tamanho já cortado — o usuário achava
    // que importou tudo. (O caminho `rows`/xlsx já falha no .max(5000) do zod.)
    if (parsed.data.length > MAX_LINHAS) {
      throw new BusinessRuleException(
        `O arquivo tem ${parsed.data.length} linhas e o limite é ${MAX_LINHAS} por importação. Divida em arquivos menores.`,
        ErrorCode.BUSINESS_RULE_VIOLATION,
      );
    }
    return parsed.data;
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
      | { ok: false; motivo: string }
      | {
          ok: true;
          existente: { id: string } | null;
          data: T;
          /**
           * Chave natural de dedup DA LINHA (cnpj, sku, sufixo de telefone…).
           * Usada pra detectar repetição DENTRO DO PRÓPRIO ARQUIVO — ver #71.
           */
          chave?: string;
        }
    >,
    persist: (data: T, existenteId: string | null, dryRun: boolean) => Promise<string>,
  ): Promise<ImportResultDto> {
    let criados = 0;
    let atualizados = 0;
    let pulados = 0;
    // #69: linhas ilegíveis do CSV entram como erro no relatório, não só no log.
    let erros = this.errosParsing.length;
    const detalhes: ImportResultLinha[] = [...this.errosParsing];
    this.errosParsing = [];

    // AUDITORIA (média): o `existente` é calculado ANTES de qualquer escrita, uma
    // linha por vez. Duas linhas IGUAIS no mesmo arquivo viam as duas
    // `existente = null` e criavam DOIS registros — e no dryRun o preview dizia
    // "a criar: 100" pra um arquivo com 20 repetidas. Aqui guardamos o id que a
    // 1ª ocorrência produziu; da 2ª em diante a linha é tratada como duplicata e
    // obedece o `onDuplicate` (skip/update/error), igual a uma duplicata do banco.
    const vistasNoArquivo = new Map<string, { id: string; linha: number }>();

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
        // Repetição no próprio arquivo tem a mesma semântica de duplicata.
        const repetida = val.chave ? vistasNoArquivo.get(val.chave) : undefined;
        const existenteEfetivo = val.existente ?? (repetida ? { id: repetida.id } : null);
        const motivoDup = repetida
          ? `duplicada no próprio arquivo (1ª ocorrência na linha ${repetida.linha})`
          : 'já existe';

        if (existenteEfetivo && onDuplicate === 'skip') {
          pulados++;
          if (detalhes.length < DETALHES_LIMITE) {
            detalhes.push({
              linha: linhaNum,
              status: 'pulado',
              id: existenteEfetivo.id,
              motivo: `${motivoDup} — onDuplicate=skip`,
            });
          }
          continue;
        }
        if (existenteEfetivo && onDuplicate === 'error') {
          erros++;
          if (detalhes.length < DETALHES_LIMITE) {
            detalhes.push({
              linha: linhaNum,
              status: 'erro',
              motivo: `${motivoDup} — onDuplicate=error (id=${existenteEfetivo.id})`,
            });
          }
          continue;
        }
        const id = await persist(val.data, existenteEfetivo?.id ?? null, dryRun);
        if (val.chave && !vistasNoArquivo.has(val.chave)) {
          vistasNoArquivo.set(val.chave, { id, linha: linhaNum });
        }
        if (existenteEfetivo) {
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
