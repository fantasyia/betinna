import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { TinyContasService } from '@integrations/tiny/tiny-contas.service';
import { TinyContatosService } from '@integrations/tiny/tiny-contatos.service';

export interface ResultadoProvisionamento {
  comissoes: number;
  provisionadas: number;
  semContatoNoErp: string[];
  jaProvisionadas: number;
  /** Já tinham conta no ERP e o valor mudou (reprocessamento) — a conta foi reescrita lá. */
  atualizadas: number;
  originacao: { valor: number; provisionada: boolean; motivo?: string };
  erros: number;
}

/** Categoria padrão no ERP. Não existindo, o lançamento entra sem classificação. */
const CATEGORIA = 'Comissões sobre vendas';
/** Comissão é paga por Pix (enum do Tiny). */
const FORMA_PAGAMENTO_PIX = 15;

/**
 * Config do tenant (`Empresa.config.comissaoOriginacao`).
 *
 * A comissão de ORIGINAÇÃO é a do Léo: ele não vendeu o pedido, trouxe o
 * representante que vendeu. Por isso ela não sai do `Usuario.comissaoPadrao`
 * (que é do rep) e precisa de configuração própria.
 */
interface OriginacaoConfig {
  ativo?: boolean;
  /** Usuário do app que recebe (usamos o `contatoErpId` dele). */
  usuarioId?: string;
  /** Contato no ERP, quando quem recebe não é usuário do app. */
  contatoErpId?: string;
  /** CPF/CNPJ de quem recebe — o provisionamento acha ou cria o contato. */
  cpfCnpj?: string;
  /** Nome usado se o contato ainda não existir no ERP. */
  nome?: string;
  /** % sobre o que veio POR REPRESENTANTE (locação). Léo: 6. */
  pctRep?: number;
  /** % sobre o que veio SEM representante (site). Léo: 12. */
  pctSemRep?: number;
}

/**
 * Leva a folha de comissões pro financeiro do ERP.
 *
 * O Tiny tem **um** vendedor por pedido e não expõe comissão na API — é campo
 * de painel. Então a comissão vira CONTA A PAGAR, que é o que ela é
 * contabilmente. O app calcula e fecha; o ERP paga e contabiliza.
 *
 * **As duas datas não são a mesma coisa** (regra do Léo, 26/08):
 *  - **competência** = mês do faturamento. É onde o custo aparece no resultado.
 *  - **vencimento** = dia 05 do mês SEGUINTE, sempre. Nota de 05/01 e de 29/01
 *    vencem as duas em 05/02.
 * Trocar uma pela outra infla um mês e esvazia o outro — e o erro só aparece no
 * fechamento contábil, meses depois.
 *
 * **Idempotente por construção:** cada comissão guarda o id da conta criada.
 * Re-rodar o fechamento não paga ninguém duas vezes.
 */
@Injectable()
export class ComissaoErpService {
  private readonly logger = new Logger(ComissaoErpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly contas: TinyContasService,
    private readonly contatos: TinyContatosService,
  ) {}

  async provisionar(
    empresaId: string,
    mes: number,
    ano: number,
  ): Promise<ResultadoProvisionamento> {
    const r: ResultadoProvisionamento = {
      comissoes: 0,
      provisionadas: 0,
      semContatoNoErp: [],
      jaProvisionadas: 0,
      atualizadas: 0,
      originacao: { valor: 0, provisionada: false },
      erros: 0,
    };

    const comissoes = await this.prisma.comissao.findMany({
      where: { empresaId, mes, ano },
      select: {
        id: true,
        tipo: true,
        totalVendas: true,
        totalComissao: true,
        contaPagarErpId: true,
        representante: { select: { id: true, nome: true, contatoErpId: true } },
      },
    });
    r.comissoes = comissoes.length;
    // Segue mesmo sem comissão de rep: mês inteiro vendido pelo site tem folha
    // vazia e originação cheia. Sair aqui deixaria essa comissão sem provisão —
    // e ninguém procura o que nunca apareceu.

    const idCategoria = (await this.contas.acharCategoria(empresaId, CATEGORIA)) ?? undefined;
    const vencimento = this.vencimentoDia5(mes, ano);
    const competencia = this.competencia(mes, ano);

    for (const c of comissoes) {
      const contato = Number(c.representante?.contatoErpId ?? 0);
      // De QUAIS pedidos é esta comissão — é o que deixa achar o pedido a
      // partir da conta, e conferir a conta a partir do pedido.
      const pedidos = await this.pedidosDaComissao(empresaId, c, mes, ano);
      const historico = [
        `Comissão ${c.tipo} ${String(mes).padStart(2, '0')}/${ano} — ${c.representante?.nome ?? ''}`.trim(),
        pedidos ? `pedidos: ${pedidos}` : '',
      ]
        .filter(Boolean)
        .join(' · ');
      if (c.contaPagarErpId) {
        // Reprocessar a folha muda o valor aqui — a conta lá precisa acompanhar,
        // senão o financeiro paga o número velho. Idempotente: reescreve o mesmo.
        r.jaProvisionadas += 1;
        if (contato && Number(c.totalComissao) > 0) {
          try {
            await this.contas.atualizarContaPagar(empresaId, Number(c.contaPagarErpId), {
              idContato: contato,
              valor: Number(c.totalComissao),
              dataVencimento: vencimento,
              dataCompetencia: competencia,
              numeroDocumento: `COMISSAO ${String(mes).padStart(2, '0')}/${ano}`,
              historico,
              idCategoria,
            });
            r.atualizadas += 1;
          } catch (err) {
            r.erros += 1;
            this.logger.error(
              `[erp] conta ${c.contaPagarErpId} da comissão ${c.id} não atualizada: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
        continue;
      }
      if (!contato) {
        // Sem contato no ERP não existe a quem pagar. Isso é pendência de
        // cadastro (o rep sobe como contato na rodada diária), não erro — e
        // precisa aparecer com nome, senão vira comissão que "sumiu".
        r.semContatoNoErp.push(c.representante?.nome ?? c.id);
        continue;
      }
      const valor = Number(c.totalComissao);
      if (valor <= 0) continue;
      try {
        const idConta = await this.contas.criarContaPagar(empresaId, {
          idContato: contato,
          valor,
          dataVencimento: vencimento,
          dataCompetencia: competencia,
          numeroDocumento: `COMISSAO ${String(mes).padStart(2, '0')}/${ano}`,
          historico,
          idCategoria,
          formaPagamento: FORMA_PAGAMENTO_PIX,
          // Comissão é lançamento ÚNICO. Recorrência é só da mensalidade de
          // locação do representante — nunca de comissão nem de venda do site.
          ocorrencia: 'U',
        });
        await this.prisma.comissao.update({
          where: { id: c.id },
          data: { contaPagarErpId: String(idConta) },
        });
        r.provisionadas += 1;
      } catch (err) {
        r.erros += 1;
        this.logger.error(
          `[erp] comissão ${c.id} não provisionada: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    await this.provisionarOriginacao(empresaId, mes, ano, {
      vencimento,
      competencia,
      idCategoria,
      resultado: r,
    });

    this.logger.log(
      `[erp] folha ${mes}/${ano}: ${r.provisionadas} provisionada(s), ` +
        `${r.jaProvisionadas} já estavam, ${r.semContatoNoErp.length} sem contato, ${r.erros} erro(s)`,
    );
    return r;
  }

  /**
   * A comissão de ORIGINAÇÃO (a do Léo) — uma conta a pagar por mês.
   *
   * Não é override de gerência sobre volume: é a comissão de quem trouxe o
   * representante. Percentuais diferentes por canal (6% no que veio por rep,
   * 12% no que veio sem rep) porque a origem do negócio é diferente.
   *
   * **Quem decide o percentual é a ORIGEM da venda** (definição do Léo, 29/08):
   * pedido nascido no app é venda por representante → 6%; qualquer outra origem
   * é venda de canal (site) → 12%. Origem é campo do pedido, não inferência:
   * usar "tem representante?" erraria no pedido que o diretor lança pelo app em
   * nome da casa, e acertaria por acidente no resto.
   */
  private async provisionarOriginacao(
    empresaId: string,
    mes: number,
    ano: number,
    ctx: {
      vencimento: string;
      competencia: string;
      idCategoria?: number;
      resultado: ResultadoProvisionamento;
    },
  ): Promise<void> {
    const r = ctx.resultado;
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { config: true },
    });
    const cfg = ((empresa?.config as Record<string, unknown> | null)?.comissaoOriginacao ??
      null) as OriginacaoConfig | null;
    if (!cfg?.ativo) {
      r.originacao.motivo = 'não configurada (Empresa.config.comissaoOriginacao)';
      return;
    }

    const contatoErpId = await this.contatoDoOriginador(empresaId, cfg);
    if (!contatoErpId) {
      r.originacao.motivo = 'quem recebe não tem contato no ERP';
      return;
    }

    // A base é a MESMA janela do fechamento (mês do envio ao ERP), pra os dois
    // lançamentos falarem do mesmo faturamento.
    const OFFSET_BRT_H = 3;
    const inicio = new Date(Date.UTC(ano, mes - 1, 1, OFFSET_BRT_H));
    const fim = new Date(Date.UTC(ano, mes, 1, OFFSET_BRT_H));
    const pedidos = await this.prisma.pedido.groupBy({
      by: ['origem'],
      where: {
        empresaId,
        status: { in: ['ENVIADO_ERP', 'PAGO', 'EM_SEPARACAO', 'ENVIADO', 'ENTREGUE'] as never },
        enviadoErpEm: { gte: inicio, lt: fim },
      },
      _sum: { total: true, valorDevolvido: true },
    });

    const pctRep = cfg.pctRep ?? 6;
    const pctSemRep = cfg.pctSemRep ?? 12;
    let valor = 0;
    for (const linha of pedidos) {
      const liquido = Math.max(
        0,
        Number(linha._sum.total ?? 0) - Number(linha._sum.valorDevolvido ?? 0),
      );
      // REP_APP = nasceu no app, na mão do representante (locação) → 6%.
      // Qualquer outra origem é canal → 12%. Enquanto a ponte com o site não
      // existe, o pedido do site chega como ERP e cai nos 12% — que é o certo.
      valor += liquido * ((linha.origem === 'REP_APP' ? pctRep : pctSemRep) / 100);
    }
    r.originacao.valor = Math.round(valor * 100) / 100;
    if (r.originacao.valor <= 0) {
      r.originacao.motivo = 'sem faturamento no período';
      return;
    }

    // Idempotência: uma linha por mês/empresa (unique no banco). Repetir o
    // fechamento não pode gerar duas contas pro mesmo período — dinheiro
    // duplicado só aparece na conciliação, semanas depois.
    const marca = `ORIGINACAO ${String(mes).padStart(2, '0')}/${ano}`;
    const registro = await this.prisma.comissaoOriginacao
      .findFirst({ where: { empresaId, mes, ano }, select: { id: true, contaPagarErpId: true } })
      .catch(() => null);
    if (registro?.contaPagarErpId) {
      r.originacao.motivo = 'já provisionada';
      return;
    }

    try {
      const idConta = await this.contas.criarContaPagar(empresaId, {
        idContato: Number(contatoErpId),
        valor: r.originacao.valor,
        dataVencimento: ctx.vencimento,
        dataCompetencia: ctx.competencia,
        numeroDocumento: marca,
        historico: `Comissão de originação ${String(mes).padStart(2, '0')}/${ano}`,
        idCategoria: ctx.idCategoria,
      });
      await this.prisma.comissaoOriginacao.upsert({
        where: { empresaId_ano_mes: { empresaId, ano, mes } },
        create: {
          empresaId,
          ano,
          mes,
          valor: r.originacao.valor,
          contaPagarErpId: String(idConta),
        },
        update: { valor: r.originacao.valor, contaPagarErpId: String(idConta) },
      });
      r.originacao.provisionada = true;
    } catch (err) {
      r.erros += 1;
      r.originacao.motivo = err instanceof Error ? err.message : String(err);
      this.logger.error(`[erp] originação ${mes}/${ano} não provisionada: ${r.originacao.motivo}`);
    }
  }

  /**
   * Quem recebe a originação, na ordem: id explícito → usuário do app →
   * CPF/CNPJ.
   *
   * O documento é o caminho que não erra: acha (ou cria) o contato pela MESMA
   * dedup do resto do sistema. Id transcrito à mão do painel é o jeito de pagar
   * a comissão pra outra pessoa em silêncio.
   */
  private async contatoDoOriginador(
    empresaId: string,
    cfg: OriginacaoConfig,
  ): Promise<string | null> {
    if (cfg.contatoErpId) return cfg.contatoErpId;
    if (cfg.usuarioId) {
      const u = await this.prisma.usuario.findUnique({
        where: { id: cfg.usuarioId },
        select: { contatoErpId: true },
      });
      if (u?.contatoErpId) return u.contatoErpId;
    }
    if (cfg.cpfCnpj) {
      const id = await this.contatos.garantir(empresaId, {
        nome: cfg.nome ?? 'Comissão de originação',
        cpfCnpj: cfg.cpfCnpj,
      });
      return String(id);
    }
    return null;
  }

  /**
   * Vencimento: dia 05 do mês SEGUINTE ao da competência. Regra fixa do Léo —
   * "nota faturada em qualquer dia do mês N vence dia 05 do mês N+1".
   */
  /**
   * "SB370658 / PED-0001 / ERP 41; …" — os pedidos que compõem a comissão.
   *
   * Vem das linhas por pedido (`PedidoComissao`) da pessoa no mês. GERENTE não
   * tem linha (comissiona sobre os reps dele) e fica sem lista.
   */
  private async pedidosDaComissao(
    empresaId: string,
    c: { tipo: string; representante: { id: string } | null },
    mes: number,
    ano: number,
  ): Promise<string> {
    if (!c.representante || c.tipo === 'GERENTE') return '';
    const OFFSET_BRT_H = 3;
    const inicio = new Date(Date.UTC(ano, mes - 1, 1, OFFSET_BRT_H));
    const fim = new Date(Date.UTC(ano, mes, 1, OFFSET_BRT_H));
    const MAX = 15;
    const linhas = await this.prisma.pedidoComissao.findMany({
      where: {
        empresaId,
        usuarioId: c.representante.id,
        tipo: c.tipo as never,
        pedido: { enviadoErpEm: { gte: inicio, lt: fim } },
      },
      select: { pedido: { select: { numero: true, numeroSite: true, numeroErp: true } } },
      orderBy: { criadoEm: 'asc' },
      take: MAX + 1,
    });
    const nomes = linhas
      .slice(0, MAX)
      .map(({ pedido: p }) =>
        [p.numeroSite, p.numero, p.numeroErp ? `ERP ${p.numeroErp}` : '']
          .filter(Boolean)
          .join(' / '),
      );
    if (linhas.length > MAX) nomes.push(`+${linhas.length - MAX}`);
    return nomes.join('; ');
  }

  private vencimentoDia5(mes: number, ano: number): string {
    const proximoMes = mes === 12 ? 1 : mes + 1;
    const anoDoVencimento = mes === 12 ? ano + 1 : ano;
    return `${anoDoVencimento}-${String(proximoMes).padStart(2, '0')}-05`;
  }

  /** Competência: o mês do faturamento, 'YYYY-MM'. */
  private competencia(mes: number, ano: number): string {
    return `${ano}-${String(mes).padStart(2, '0')}`;
  }
}
