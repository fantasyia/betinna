import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EnvService } from '@config/env.service';
import { PrismaService } from '@database/prisma.service';
import { RedisService } from '@database/redis.service';
import { NotificacoesService } from '@modules/notificacoes/notificacoes.service';
import { CronLockService } from '@shared/utils/cron-lock.service';
import { PropostaErpService } from './proposta-erp.service';

/** Depois disso, insistir sozinho já não resolve — é gente que tem que olhar. */
const TENTATIVAS_ANTES_DE_AVISAR = 3;

/**
 * Contrato assinado que NÃO chegou no ERP.
 *
 * O processo do Léo só termina quando o contrato assinado aparece no ERP como
 * proposta, pro Leandro analisar. O envio é automático, no retorno da
 * assinatura — mas "automático" não é "garantido": o ERP cai, o token expira, a
 * API devolve 429. E a falha desse envio é silenciosa por natureza, porque o
 * contrato JÁ está assinado e todo o resto do fluxo seguiu certo. Sem esta
 * varredura, o negócio ficaria parado esperando um passo que ninguém sabe que
 * não aconteceu.
 *
 * De 30 em 30 minutos: tenta de novo; depois de três tentativas, para de tentar
 * e AVISA — insistir eternamente esconde o problema em vez de resolver.
 */
@Injectable()
export class ContratoErpPendenteJob {
  /**
   * ⛔ DECISÃO DO LÉO (14/09/2026): a automação vai só ATÉ O APP.
   *
   * O contrato assinado NÃO sobe mais sozinho pro ERP — a subida virou ação
   * MANUAL na tela da proposta, com a trava anti-duplicação (advisory lock por
   * proposta + o guard `Proposta.orcamentoErpId`), porque quem toca dali pra
   * frente é o Leandro. O cron continua vivo, mas só AVISA quem precisa clicar.
   *
   * Pra voltar ao automático: `false` aqui (nada mais muda).
   */
  private static readonly SO_AVISA = true;

  private readonly logger = new Logger(ContratoErpPendenteJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly cronLock: CronLockService,
    private readonly redis: RedisService,
    private readonly erp: PropostaErpService,
    private readonly notificacoes: NotificacoesService,
  ) {}

  @Cron('*/30 * * * *', { name: 'contrato-erp-pendente', timeZone: 'UTC' })
  async reenviarPendentes(): Promise<void> {
    if (this.env.get('NODE_ENV') === 'test') return;
    if (!(await this.cronLock.acquire('contrato-erp-pendente', 10 * 60))) return;

    const pendentes = await this.prisma.contrato.findMany({
      where: { status: 'ASSINADO', proposta: { orcamentoErpId: null } },
      select: {
        id: true,
        empresaId: true,
        representanteId: true,
        proposta: { select: { id: true, numero: true } },
      },
      take: 50,
    });
    if (pendentes.length === 0) return;

    this.logger.warn(`${pendentes.length} contrato(s) assinado(s) sem orçamento no ERP`);

    // SÓ AVISA (decisão do Léo, 14/09): um aviso por contrato, no máximo uma vez
    // por dia — quem sobe é gente, clicando na proposta. Sem isto o cron subiria
    // sozinho, que é exatamente o que ele pediu pra sair.
    if (ContratoErpPendenteJob.SO_AVISA) {
      for (const c of pendentes) {
        const chaveAviso = `contrato-erp-aviso:${c.id}`;
        const primeiroDoDia = await this.reivindicarAvisoDiario(chaveAviso);
        if (!primeiroDoDia) continue;
        await this.avisarParaSubirNaMao(c.empresaId, c.proposta.numero);
      }
      return;
    }

    for (const c of pendentes) {
      const chave = `contrato-erp-tentativas:${c.id}`;
      const tentativas = await this.contarTentativa(chave);
      if (tentativas > TENTATIVAS_ANTES_DE_AVISAR) continue;

      try {
        const r = await this.erp.enviar(c.proposta.id, c.empresaId);
        this.logger.log(
          `Contrato da ${c.proposta.numero} recuperado: orçamento ${r.orcamentoErpId} no ERP`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Contrato da ${c.proposta.numero} segue fora do ERP: ${msg}`);
        if (tentativas === TENTATIVAS_ANTES_DE_AVISAR) {
          await this.avisar(c.empresaId, c.proposta.numero, msg);
        }
      }
    }
  }

  /**
   * Conta a tentativa no Redis (7 dias de validade).
   *
   * Contador em memória se perderia no deploy, e o job voltaria a tentar pra
   * sempre um envio que já falhou três vezes — que é justamente o que faz a
   * falha não aparecer pra ninguém.
   */
  private async contarTentativa(chave: string): Promise<number> {
    try {
      const n = await this.redis.incr(chave);
      if (n === 1) await this.redis.setEx(chave, '1', 7 * 24 * 60 * 60);
      return n;
    } catch {
      // Redis fora do ar não pode impedir a tentativa — só o controle dela.
      return 1;
    }
  }

  /**
   * Primeira vez no dia pra este contrato? (evita 48 avisos/dia — o cron roda de
   * 30 em 30 min e o contrato fica pendente até alguém clicar).
   * Redis fora → devolve `true`: melhor um aviso a mais que nenhum.
   */
  private async reivindicarAvisoDiario(chave: string): Promise<boolean> {
    try {
      const n = await this.redis.incr(chave);
      if (n === 1) await this.redis.setEx(chave, '1', 24 * 60 * 60);
      return n === 1;
    } catch {
      return true;
    }
  }

  private async avisarParaSubirNaMao(empresaId: string, numero: string): Promise<void> {
    await this.notificacoes
      .criarParaRole({
        empresaId,
        roles: ['DIRECTOR', 'ADMIN'],
        tipo: 'GENERICO',
        prioridade: 'NORMAL',
        titulo: `Contrato da ${numero} assinado — subir pro ERP`,
        mensagem:
          'O contrato está assinado e guardado. A subida pro ERP é manual: abra a proposta e ' +
          'use "Enviar pro ERP". Clicar duas vezes não duplica — o segundo envio é recusado.',
        link: '/propostas',
      })
      .catch(() => undefined);
  }

  private async avisar(empresaId: string, numero: string, motivo: string): Promise<void> {
    await this.notificacoes
      .criarParaRole({
        empresaId,
        roles: ['DIRECTOR', 'ADMIN'],
        tipo: 'GENERICO',
        prioridade: 'ALTA',
        titulo: `Contrato da ${numero} assinado, mas NÃO chegou no ERP`,
        mensagem:
          `Três tentativas automáticas falharam (${motivo.slice(0, 160)}). ` +
          'Dá pra forçar a subida pela própria proposta — o contrato está assinado e guardado.',
        link: '/propostas',
      })
      .catch(() => undefined);
  }
}
