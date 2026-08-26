import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { IntegracoesService } from '@modules/integracoes/integracoes.service';
import { TinyClientService } from './tiny-client.service';

interface ProdutoTiny {
  id: number;
  sku?: string;
  descricao?: string;
  situacao?: string;
  unidade?: string;
  dataAlteracao?: string;
  precos?: { preco?: number; precoCusto?: number };
}

interface EstoqueTiny {
  id: number;
  saldo?: number;
  disponivel?: number;
}

export interface ResultadoSync {
  lidos: number;
  criados: number;
  atualizados: number;
  estoqueAtualizado: number;
  erros: number;
}

const PAGINA = 100;

/**
 * Traz o catálogo do Tiny PRA CÁ — o sentido normal do dia a dia.
 *
 * A importação (`TinyProdutosService`) foi o bootstrap: a conta do ERP nasceu
 * vazia e alguém tinha que popular. Daqui em diante o Tiny é a fonte da verdade
 * (preço, custo, estoque, situação) e o app espelha.
 *
 * **Incremental por `dataAlteracao`**, igual ao que o OMIE fazia (D21c): o sync
 * diário não re-baixa catálogo inteiro, só o que mudou desde o último. O modo
 * completo existe pra quando alguém precisa forçar.
 *
 * **O custo agora é REAL.** O `precoFabrica` deixou de ser o chute de 70% que
 * vinha do OMIE: `precos.precoCusto` chega na API. Quando o Tiny não tem custo
 * cadastrado, fica `null` — "não informado" é uma resposta honesta; 70% do
 * preço de tabela não era.
 */
@Injectable()
export class TinyProdutosSyncService {
  private readonly logger = new Logger(TinyProdutosSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: TinyClientService,
    private readonly integracoes: IntegracoesService,
  ) {}

  async sync(
    empresaId: string,
    opcoes: { modo?: 'incremental' | 'completo'; comEstoque?: boolean } = {},
  ): Promise<ResultadoSync> {
    const modo = opcoes.modo ?? 'incremental';
    // Carimbo do INÍCIO, não do fim: produto alterado no ERP enquanto o sync
    // roda cairia entre o cutoff e o carimbo final, e a próxima rodada
    // incremental o pularia — perda silenciosa. Com o início há um pequeno
    // overlap reprocessado, que é idempotente. (Regra já documentada no
    // registrarSyncOk.)
    const inicio = new Date();
    const desde = modo === 'incremental' ? await this.ultimoSync(empresaId) : null;
    const r: ResultadoSync = {
      lidos: 0,
      criados: 0,
      atualizados: 0,
      estoqueAtualizado: 0,
      erros: 0,
    };

    let offset = 0;
    for (;;) {
      const pagina = await this.client.get<{
        itens?: ProdutoTiny[];
        paginacao?: { total: number };
      }>(empresaId, '/produtos', {
        situacao: 'A',
        limit: PAGINA,
        offset,
        // Formato do Tiny: 'YYYY-MM-DD HH:mm:ss'.
        ...(desde ? { dataAlteracao: this.formatarData(desde) } : {}),
      });
      const itens = pagina.itens ?? [];
      if (itens.length === 0) break;
      r.lidos += itens.length;

      for (const p of itens) {
        try {
          const novo = await this.upsert(empresaId, p);
          if (novo) r.criados += 1;
          else r.atualizados += 1;
          if (opcoes.comEstoque !== false) {
            if (await this.sincronizarEstoque(empresaId, p)) r.estoqueAtualizado += 1;
          }
        } catch (err) {
          // Produto que falha não interrompe o catálogo: um SKU problemático não
          // pode deixar os outros 300 desatualizados.
          r.erros += 1;
          this.logger.warn(
            `[tiny] sync do produto ${p.sku ?? p.id} falhou: ` +
              `${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      offset += PAGINA;
      if (itens.length < PAGINA) break;
    }

    // Só marca o relógio quando a rodada inteira passou: marcar no meio faria a
    // próxima rodada pular o que ficou pra trás — e a falta seria silenciosa.
    if (r.erros === 0) {
      await this.integracoes.registrarSyncOk(empresaId, 'tiny', inicio).catch(() => undefined);
    }

    this.logger.log(
      `[tiny] sync de produtos (${modo}): ${r.lidos} lidos, ${r.criados} criados, ` +
        `${r.atualizados} atualizados, ${r.estoqueAtualizado} com estoque, ${r.erros} erros`,
    );
    return r;
  }

  /** Devolve `true` quando o produto foi CRIADO (era novo por aqui). */
  private async upsert(empresaId: string, p: ProdutoTiny): Promise<boolean> {
    const codigoErp = String(p.id);
    const existente = await this.prisma.produto.findFirst({
      // Casa pelo id do ERP e, na falta dele, pelo SKU — é o caso do produto que
      // nasceu aqui antes da integração e ainda não tem o vínculo.
      where: { empresaId, OR: [{ codigoErp }, ...(p.sku ? [{ sku: p.sku }] : [])] },
      select: { id: true },
    });

    const dados = {
      codigoErp,
      sku: p.sku ?? null,
      nome: p.descricao ?? p.sku ?? `Produto ${p.id}`,
      unidade: p.unidade ?? null,
      precoTabela: new Prisma.Decimal(p.precos?.preco ?? 0),
      // Custo REAL do ERP. Sem custo lá, fica null — "não informado" é honesto;
      // o chute de 70% do OMIE não era.
      precoFabrica:
        typeof p.precos?.precoCusto === 'number' && p.precos.precoCusto > 0
          ? new Prisma.Decimal(p.precos.precoCusto)
          : null,
      ativo: (p.situacao ?? 'A') === 'A',
    };

    if (existente) {
      await this.prisma.produto.update({ where: { id: existente.id }, data: dados });
      return false;
    }
    await this.prisma.produto.create({ data: { ...dados, empresaId } });
    return true;
  }

  /**
   * Estoque é chamada SEPARADA por produto no Tiny (`GET /estoque/{id}`) — não
   * vem na listagem. Com catálogo pequeno isso é trivial; se um tenant passar
   * de algumas centenas de SKUs, vale trocar pelo endpoint de atualizações em
   * lote da API v2 antes de estourar o rate limit.
   */
  private async sincronizarEstoque(empresaId: string, p: ProdutoTiny): Promise<boolean> {
    const e = await this.client.get<EstoqueTiny>(empresaId, `/estoque/${p.id}`).catch(() => null);
    if (!e) return false;
    // `disponivel` (saldo − reservado) é o que o rep pode prometer; `saldo` cru
    // incluiria peça já comprometida com outro pedido.
    const disponivel = Math.trunc(e.disponivel ?? e.saldo ?? 0);
    const { count } = await this.prisma.produto.updateMany({
      where: { empresaId, codigoErp: String(p.id) },
      data: { estoque: disponivel, estoqueAtualizadoEm: new Date() },
    });
    return count > 0;
  }

  private async ultimoSync(empresaId: string): Promise<Date | null> {
    const conn = await this.prisma.integracaoConexao.findFirst({
      where: { empresaId, servico: 'tiny' },
      select: { ultimoSync: true },
    });
    return conn?.ultimoSync ?? null;
  }

  private formatarData(d: Date): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
  }
}
