import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EnvService } from '@config/env.service';
import { PrismaService } from '@database/prisma.service';
import { TinyOrcamentosService } from '@integrations/tiny/tiny-orcamentos.service';
import { CronLockService } from '@shared/utils/cron-lock.service';
import { ContratoErpService } from './contrato-erp.service';

/**
 * Situações do orçamento no Tiny que significam "o Leandro liberou".
 * A lista do ERP é: Aguardando · Aprovado · Concluído · Em aberto · Modelo ·
 * Não aprovado · Pendente · Rascunho.
 */
const APROVADAS = ['aprovado', 'concluído', 'concluido'];

export interface ResultadoVarreduraAprovacao {
  verificados: number;
  criados: number;
  erros: string[];
}

/**
 * O contrato só sobe pro ERP DEPOIS que o orçamento é aprovado lá dentro — e
 * **não existe webhook de orçamento** no Tiny (conferido no spec: os eventos
 * são de pedido, nota e estoque). Sem esta varredura, o processo trava num
 * passo que ninguém sabe que não aconteceu: o cliente assinou, o Leandro
 * aprovou, e a cobrança mensal nunca começa.
 *
 * O conjunto varrido é pequeno e se esvazia sozinho: contrato ASSINADO, com
 * orçamento no ERP e ainda **sem** `contratoErpId`. Assim que o contrato sobe,
 * ele sai da varredura — não há marcador extra pra manter.
 */
@Injectable()
export class ContratoAprovacaoJob {
  private readonly logger = new Logger(ContratoAprovacaoJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly cronLock: CronLockService,
    private readonly orcamentos: TinyOrcamentosService,
    private readonly erp: ContratoErpService,
  ) {}

  @Cron('*/30 * * * *', { name: 'contrato-aprovacao-erp', timeZone: 'UTC' })
  async rodar(): Promise<void> {
    if (this.env.get('NODE_ENV') === 'test') return;
    if (!(await this.cronLock.acquire('contrato-aprovacao-erp', 10 * 60))) return;

    const empresas = await this.prisma.empresa.findMany({
      where: { ativo: true },
      select: { id: true },
    });
    for (const { id } of empresas) {
      try {
        await this.varrer(id);
      } catch (err) {
        this.logger.error(
          `Varredura de aprovação falhou na empresa ${id}: ` +
            `${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /** Também exposto sob demanda — o Léo confere na hora depois de aprovar. */
  async varrer(empresaId: string): Promise<ResultadoVarreduraAprovacao> {
    const pendentes = await this.prisma.contrato.findMany({
      where: {
        empresaId,
        status: 'ASSINADO',
        contratoErpId: null,
        proposta: { orcamentoErpId: { not: null } },
      },
      select: {
        id: true,
        proposta: { select: { numero: true, orcamentoErpId: true } },
      },
      take: 50,
    });

    const res: ResultadoVarreduraAprovacao = {
      verificados: pendentes.length,
      criados: 0,
      erros: [],
    };
    for (const c of pendentes) {
      try {
        const orcamento = await this.orcamentos.obter(empresaId, Number(c.proposta.orcamentoErpId));
        const situacao = String(orcamento?.situacao ?? '').toLowerCase();
        if (!APROVADAS.includes(situacao)) {
          this.logger.debug(
            `Contrato ${c.id} (${c.proposta.numero}): orçamento ainda "${situacao || 'sem situação'}"`,
          );
          continue;
        }
        const { jaExistia } = await this.erp.enviar(c.id, empresaId);
        if (!jaExistia) res.criados += 1;
        this.logger.log(
          `Orçamento de ${c.proposta.numero} aprovado no ERP — contrato de locação criado`,
        );
      } catch (err) {
        // Uma falha não pode parar as outras: cada contrato é um cliente
        // diferente esperando a cobrança começar.
        const msg = `${c.proposta.numero}: ${err instanceof Error ? err.message : String(err)}`;
        res.erros.push(msg);
        this.logger.error(`Aprovação/criação falhou — ${msg}`);
      }
    }
    return res;
  }
}
