import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { TinyPedidosService } from '@integrations/tiny/tiny-pedidos.service';
import { ComissoesService } from '@modules/comissoes/comissoes.service';
import { NotificacoesService } from '@modules/notificacoes/notificacoes.service';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { PedidoComissoesService } from './pedido-comissoes.service';

export interface ResultadoCancelamentos {
  /** Pedidos cancelados no app (janela) que foram conferidos no ERP. */
  conferidos: number;
  /** Estavam cancelados aqui e ABERTOS lá — cancelados no ERP nesta passada. */
  canceladosNoErp: number;
  /** Pedido cancelado com nota fiscal AUTORIZADA no ERP — precisa de estorno humano. */
  notasParaEstornar: string[];
  /** Meses de folha já fechada que foram reprocessados por causa do cancelamento. */
  mesesReprocessados: string[];
  avisos: string[];
  erros: number;
}

/** Situações de NOTA no Tiny que ainda valem (não canceladas/rejeitadas/denegadas). */
const NOTA_VIVA = new Set([2, 4, 6, 7, 8, 9]);
const SITUACAO_CANCELADA = 2;
/** Janela padrão: cancelamentos dos últimos N dias. */
const JANELA_PADRAO_DIAS = 7;

/**
 * A passada diária de CANCELAMENTOS — o que sobra depois que o pedido morre.
 *
 * Cancelar um pedido não é só trocar o status. Sobra a nota fiscal (se já saiu,
 * alguém tem que estornar), sobra o pedido de venda aberto do outro lado (o
 * cancelamento daqui pode ter falhado lá, ou vice-versa), e sobra a comissão —
 * a linha por pedido some sozinha, mas a FOLHA de um mês já fechado continua
 * dizendo o valor velho, e a conta a pagar no ERP também.
 *
 * Roda depois do sync diário de pedidos, de propósito: é o sync que traz o
 * cancelamento feito no ERP pra cá (o pedido vira CANCELADO aqui), e esta
 * passada cuida das consequências a partir do que está cancelado no app.
 *
 * O que ela NÃO faz: cancelar nota fiscal. Isso é ato fiscal, com prazo e
 * justificativa — fica com o financeiro. Aqui só se garante que ninguém deixa
 * de saber.
 */
@Injectable()
export class ErpCancelamentosService {
  private readonly logger = new Logger(ErpCancelamentosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tiny: TinyPedidosService,
    private readonly comissoesPedido: PedidoComissoesService,
    private readonly comissoes: ComissoesService,
    private readonly notificacoes: NotificacoesService,
  ) {}

  async varrer(empresaId: string, opcoes: { dias?: number } = {}): Promise<ResultadoCancelamentos> {
    const r: ResultadoCancelamentos = {
      conferidos: 0,
      canceladosNoErp: 0,
      notasParaEstornar: [],
      mesesReprocessados: [],
      avisos: [],
      erros: 0,
    };
    const dias = opcoes.dias && opcoes.dias > 0 ? opcoes.dias : JANELA_PADRAO_DIAS;
    const desde = new Date(Date.now() - dias * 86_400_000);

    const cancelados = await this.prisma.pedido.findMany({
      where: {
        empresaId,
        status: 'CANCELADO',
        numeroErp: { not: null },
        atualizadoEm: { gte: desde },
      },
      select: {
        id: true,
        numero: true,
        numeroSite: true,
        numeroErp: true,
        enviadoErpEm: true,
        observacoes: true,
      },
      take: 500,
    });

    const meses = new Map<string, { mes: number; ano: number }>();

    for (const p of cancelados) {
      r.conferidos += 1;
      try {
        await this.conferirNoErp(empresaId, p, r);
      } catch (err) {
        r.erros += 1;
        this.logger.warn(
          `[erp] cancelamento de ${p.numero} não conferido no ERP: ${this.msg(err)}`,
        );
      }

      // A linha de comissão do pedido cancelado tem que sumir — o recálculo faz
      // isso — e o mês da folha entra na lista pra reprocessar.
      await this.comissoesPedido.recalcular(p.id);
      const ref = p.enviadoErpEm ?? null;
      if (ref) {
        const { mes, ano } = this.mesBrt(ref);
        meses.set(`${ano}-${mes}`, { mes, ano });
      }
    }

    for (const { mes, ano } of meses.values()) {
      await this.reprocessarSeFechado(empresaId, mes, ano, r);
    }

    if (r.notasParaEstornar.length > 0) {
      await this.notificacoes.criarParaRole({
        empresaId,
        roles: ['DIRECTOR', 'ADMIN'],
        tipo: 'GENERICO',
        prioridade: 'ALTA',
        titulo: 'Pedido cancelado com nota fiscal emitida',
        mensagem:
          `${r.notasParaEstornar.length} nota(s) precisam de estorno/cancelamento no ERP: ` +
          r.notasParaEstornar.join('; '),
        link: '/pedidos?status=CANCELADO',
        metadata: { notas: r.notasParaEstornar },
      });
    }

    this.logger.log(
      `[erp] cancelamentos empresa=${empresaId}: ${r.conferidos} conferido(s), ` +
        `${r.canceladosNoErp} cancelado(s) no ERP, ${r.notasParaEstornar.length} nota(s) p/ estorno, ` +
        `folha reprocessada: ${r.mesesReprocessados.join(', ') || 'nenhuma'}` +
        (r.avisos.length ? ` — ${r.avisos.length} aviso(s)` : ''),
    );
    return r;
  }

  /**
   * Do lado do ERP: o pedido de venda ainda está aberto? Tem nota fiscal viva?
   */
  private async conferirNoErp(
    empresaId: string,
    p: { numero: string; numeroSite: string | null; numeroErp: string | null },
    r: ResultadoCancelamentos,
  ): Promise<void> {
    if (!p.numeroErp) return;
    const achado = await this.tiny.listar(empresaId, { numero: p.numeroErp, limit: 5 });
    const exato = achado.itens.find((i) => String(i.numeroPedido ?? i.id) === p.numeroErp);
    if (!exato?.id) {
      r.avisos.push(`${p.numero}: pedido ${p.numeroErp} não existe mais no ERP`);
      return;
    }
    const d = await this.tiny.obter(empresaId, exato.id);
    const rotulo = [p.numeroSite, p.numero, `ERP ${p.numeroErp}`].filter(Boolean).join(' / ');

    // Nota fiscal viva num pedido cancelado: alguém tem que estornar. Isto é o
    // que o financeiro NÃO pode descobrir por acaso.
    if (d.idNotaFiscal) {
      const nota = await this.tiny.obterNota(empresaId, d.idNotaFiscal);
      const sit = Number(nota.situacao ?? 0);
      if (NOTA_VIVA.has(sit)) {
        r.notasParaEstornar.push(
          `NF ${nota.numero ?? nota.id}${nota.serie ? ` série ${nota.serie}` : ''} do pedido ${rotulo}`,
        );
      }
    }

    // Cancelado aqui e ainda aberto lá: o cancelamento na hora pode ter falhado
    // (token vencido, ERP fora) e o aviso ficou só na observação. Fecha agora.
    if (Number(d.situacao) !== SITUACAO_CANCELADA) {
      await this.tiny.cancelar(empresaId, exato.id);
      r.canceladosNoErp += 1;
      this.logger.log(`[erp] ${rotulo}: estava aberto no ERP — cancelado agora`);
    }
  }

  /**
   * Mês de folha já fechada: reprocessa pra tirar o pedido cancelado da conta
   * — e o provisionamento reescreve a conta a pagar no ERP com o valor novo.
   * Folha já PAGA não se reprocessa sozinha: dinheiro que saiu se acerta na mão.
   */
  private async reprocessarSeFechado(
    empresaId: string,
    mes: number,
    ano: number,
    r: ResultadoCancelamentos,
  ): Promise<void> {
    const folha = await this.prisma.comissao.findMany({
      where: { empresaId, mes, ano },
      select: { id: true, pago: true, totalComissao: true, contaPagarErpId: true },
    });
    if (folha.length === 0) return; // mês ainda aberto: o fechamento normal cuida.
    const rotulo = `${String(mes).padStart(2, '0')}/${ano}`;
    if (folha.some((c) => c.pago)) {
      r.avisos.push(`folha ${rotulo} já está PAGA — cancelamento exige acerto manual`);
      return;
    }
    const systemUser: AuthenticatedUser = {
      id: 'system-cron',
      email: 'system@betinna.ai',
      nome: 'Cron Cancelamentos',
      role: 'ADMIN',
      empresaIds: [empresaId],
      empresaIdAtiva: empresaId,
    };
    try {
      await this.comissoes.fecharMes(systemUser, { mes, ano, reprocessar: true });
      r.mesesReprocessados.push(rotulo);
    } catch (err) {
      r.erros += 1;
      r.avisos.push(`folha ${rotulo} não reprocessada: ${this.msg(err)}`);
      return;
    }
    // Comissão que ZEROU mas já tinha conta no ERP: o PUT não zera uma conta —
    // e não existe DELETE na API. Precisa de gente.
    const depois = await this.prisma.comissao.findMany({
      where: { empresaId, mes, ano, contaPagarErpId: { not: null }, totalComissao: { lte: 0 } },
      select: { contaPagarErpId: true, representante: { select: { nome: true } } },
    });
    for (const c of depois) {
      r.avisos.push(
        `conta a pagar ${c.contaPagarErpId} (${c.representante?.nome ?? '?'}, ${rotulo}) ficou sem valor — apagar no ERP`,
      );
    }
  }

  /** Mês/ano no fuso do Brasil (BRT, UTC-3), o mesmo corte da folha. */
  private mesBrt(d: Date): { mes: number; ano: number } {
    const brt = new Date(d.getTime() - 3 * 3_600_000);
    return { mes: brt.getUTCMonth() + 1, ano: brt.getUTCFullYear() };
  }

  private msg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
