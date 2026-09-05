import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { TinyContasService } from '@integrations/tiny/tiny-contas.service';
import { NotFoundException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { ContratoComissoesService, mesUtc } from './contrato-comissoes.service';
import { vencimentoDia5 } from './fase-comissao.util';

const CATEGORIA = 'Comissões sobre vendas';
const FORMA_PAGAMENTO_PIX = 15;

export interface ResultadoProvisaoLocacao {
  criadas: number;
  /** Beneficiário sem contato no ERP — não há a quem pagar. */
  semContato: string[];
  erros: number;
}

/**
 * Conta a pagar da comissão de LOCAÇÃO — uma por contrato × pessoa × MÊS.
 *
 * É a outra metade do gatilho da locação. `registrarMensalidadeRecebida` marca
 * que o dinheiro do cliente entrou naquele mês; sem isto aqui, a marca não
 * virava nada: `ContratoComissao.contaPagarErpId` não era escrito por ninguém,
 * então a linha ficava presa em AGUARDANDO_MENSALIDADE para sempre e o sync de
 * baixa (que já existe) nunca tinha uma conta pra conferir.
 *
 * Espelha o `PedidoComissaoErpService` de propósito — mesma categoria, mesmo
 * Pix, mesma ocorrência ÚNICA. Recorrente no ERP é só a mensalidade que o
 * cliente paga; a comissão de cada mês é um lançamento próprio, senão o
 * financeiro perde a rastreabilidade de qual mês pagou o quê.
 *
 * Vencimento: dia 05 do mês seguinte à COMPETÊNCIA — a mesma régua que a tela
 * do rep já promete ("A pagar em 05/10"). Se a mensalidade entrar atrasada, a
 * conta nasce vencida, e isso é o retrato certo: o rep deveria ter recebido
 * naquela data. Datar pelo recebimento faria a tela e o ERP discordarem.
 */
@Injectable()
export class ContratoComissaoErpService {
  private readonly logger = new Logger(ContratoComissaoErpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly contas: TinyContasService,
    private readonly comissoes: ContratoComissoesService,
  ) {}

  /**
   * Ponto de entrada do gatilho: a mensalidade daquele mês entrou.
   *
   * Marca o mês como recebido e já provisiona a conta a pagar, para não existir
   * um estado intermediário que depende da rodada da madrugada pra virar
   * dinheiro visível. Idempotente nas duas pontas.
   */
  async mensalidadeRecebida(
    empresaId: string,
    contratoId: string,
    competencia: Date,
    recebidaEm?: Date,
  ): Promise<ResultadoProvisaoLocacao & { liberadas: number }> {
    const contrato = await this.prisma.contrato.findFirst({
      where: { id: contratoId, empresaId },
      select: { id: true },
    });
    if (!contrato) {
      throw new NotFoundException('Contrato não encontrado', ErrorCode.NOT_FOUND);
    }
    const liberadas = await this.comissoes.registrarMensalidadeRecebida(
      contratoId,
      competencia,
      recebidaEm,
    );
    const r = await this.provisionar(empresaId, { contratoId, competencia: mesUtc(competencia) });
    return { liberadas, ...r };
  }

  /**
   * Cria no ERP as contas a pagar de toda mensalidade já recebida que ainda não
   * tem conta. Sem filtro, varre a empresa inteira — é o que a rodada diária
   * usa para recuperar o que falhou ontem.
   */
  async provisionar(
    empresaId: string,
    filtro?: { contratoId?: string; competencia?: Date },
  ): Promise<ResultadoProvisaoLocacao> {
    const r: ResultadoProvisaoLocacao = { criadas: 0, semContato: [], erros: 0 };

    const linhas = await this.prisma.contratoComissao.findMany({
      where: {
        empresaId,
        mensalidadeRecebidaEm: { not: null },
        contaPagarErpId: null,
        valor: { gt: 0 },
        ...(filtro?.contratoId ? { contratoId: filtro.contratoId } : {}),
        ...(filtro?.competencia ? { competencia: filtro.competencia } : {}),
      },
      select: {
        id: true,
        tipo: true,
        percentual: true,
        valor: true,
        competencia: true,
        usuario: { select: { nome: true, contatoErpId: true } },
        contrato: {
          select: {
            status: true,
            cliente: { select: { nome: true } },
            proposta: { select: { numero: true } },
          },
        },
      },
    });
    if (linhas.length === 0) return r;

    const idCategoria = (await this.contas.acharCategoria(empresaId, CATEGORIA)) ?? undefined;

    for (const l of linhas) {
      // Contrato cancelado depois do recebimento: quem zera a linha é o
      // recálculo do contrato. Aqui só não se cria conta nova para ele.
      if (l.contrato?.status === 'CANCELADO') continue;

      const nome = l.usuario?.nome ?? '?';
      const contato = Number(l.usuario?.contatoErpId ?? 0);
      if (!contato) {
        r.semContato.push(nome);
        continue;
      }

      const mes = l.competencia.getUTCMonth() + 1;
      const ano = l.competencia.getUTCFullYear();
      const competencia = `${ano}-${String(mes).padStart(2, '0')}`;
      const contratoRotulo = l.contrato?.proposta?.numero ?? 'contrato';
      const valor = Math.round(Number(l.valor) * 100) / 100;

      try {
        const id = await this.contas.criarContaPagar(empresaId, {
          idContato: contato,
          valor,
          dataVencimento: vencimentoDia5(mes, ano),
          dataCompetencia: competencia,
          numeroDocumento: `${contratoRotulo}/${competencia}`,
          historico:
            `Comissão ${l.tipo} ${l.percentual}% — ${nome} · locação ${contratoRotulo}` +
            `${l.contrato?.cliente?.nome ? ` (${l.contrato.cliente.nome})` : ''}` +
            ` · mensalidade ${competencia}`,
          idCategoria,
          formaPagamento: FORMA_PAGAMENTO_PIX,
          ocorrencia: 'U',
        });
        await this.prisma.contratoComissao.update({
          where: { id: l.id },
          data: { contaPagarErpId: String(id), contaPagarValor: valor },
        });
        r.criadas += 1;
      } catch (err) {
        r.erros += 1;
        this.logger.error(
          `[erp] comissão de locação de ${nome} (${contratoRotulo} ${competencia}) ` +
            `não provisionada: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (r.criadas || r.semContato.length) {
      this.logger.log(
        `[erp] comissão de locação: ${r.criadas} conta(s) a pagar criada(s)` +
          (r.semContato.length ? ` — sem contato no ERP: ${r.semContato.join(', ')}` : ''),
      );
    }
    return r;
  }
}
