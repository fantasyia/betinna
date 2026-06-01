import { Injectable, Logger } from '@nestjs/common';
import type { IntegracaoStatus, IntegracaoStatusValor } from '@prisma/client';
import { EnvService } from '@config/env.service';
import { PrismaService } from '@database/prisma.service';
import { TransactionalEmailService } from '@integrations/email/transactional-email.service';
import { SERVICO_METADATA, type ServicoIntegracao } from './integracoes.constants';

/**
 * Semáforo de saúde das integrações (Sprint 2.1).
 *
 * Mantém, por empresa × serviço, um status com 4 valores:
 *  - ATIVA        — funcionando
 *  - DEGRADADA    — algumas falhas recentes, ainda responde
 *  - CAIDA        — falhou várias vezes seguidas (LIMIAR_CAIDA)
 *  - DESCONECTADA — token expirou / sessão caiu / credencial inválida (imediato)
 *
 * É alimentado pelos hooks de sucesso/erro das integrações (registrarSucesso/
 * registrarErro). Quando uma integração entra em CAIDA ou DESCONECTADA, dispara
 * **e-mail de alerta** ao DIRETOR — com throttle de 1 por integração por hora.
 *
 * Tudo é best-effort: falha aqui nunca derruba a operação principal.
 */
@Injectable()
export class IntegracaoStatusService {
  private readonly logger = new Logger(IntegracaoStatusService.name);
  /** Quantas falhas seguidas até marcar como CAÍDA. */
  private static readonly LIMIAR_CAIDA = 3;
  /** Intervalo mínimo entre e-mails de alerta da mesma integração (1h). */
  private static readonly ALERTA_THROTTLE_MS = 60 * 60 * 1000;
  /** Tamanho máximo da mensagem de erro persistida. */
  private static readonly ERRO_MAX = 500;

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: TransactionalEmailService,
    private readonly env: EnvService,
  ) {}

  /** Marca a integração como saudável (zera contador de erros). */
  async registrarSucesso(empresaId: string, servico: string): Promise<void> {
    try {
      await this.prisma.integracaoStatus.upsert({
        where: { empresaId_servico: { empresaId, servico } },
        update: {
          status: 'ATIVA',
          errosSeguidos: 0,
          ultimaVerificacaoEm: new Date(),
          ultimoErro: null,
          ultimoErroEm: null,
        },
        create: { empresaId, servico, status: 'ATIVA' },
      });
    } catch (err) {
      this.logger.warn(
        `[status] falha registrando sucesso de ${servico}/${empresaId}: ${this.msg(err)}`,
      );
    }
  }

  /**
   * Marca uma falha. Calcula o novo status e, se entrar em CAIDA/DESCONECTADA,
   * dispara o alerta (respeitando o throttle).
   *
   * @param opts.desconectado true quando o erro indica desconexão definitiva
   *        (401, refresh de token falhou, WhatsApp deslogado) → DESCONECTADA imediato.
   */
  async registrarErro(
    empresaId: string,
    servico: string,
    erro?: string,
    opts?: { desconectado?: boolean },
  ): Promise<void> {
    try {
      const atual = await this.prisma.integracaoStatus.findUnique({
        where: { empresaId_servico: { empresaId, servico } },
      });
      const errosSeguidos = (atual?.errosSeguidos ?? 0) + 1;
      const desconectado = opts?.desconectado === true;
      const status: IntegracaoStatusValor = desconectado
        ? 'DESCONECTADA'
        : errosSeguidos >= IntegracaoStatusService.LIMIAR_CAIDA
          ? 'CAIDA'
          : 'DEGRADADA';

      const agora = new Date();
      const ruim = status === 'CAIDA' || status === 'DESCONECTADA';
      const podeAlertar =
        ruim &&
        (!atual?.ultimoAlertaEm ||
          agora.getTime() - atual.ultimoAlertaEm.getTime() >
            IntegracaoStatusService.ALERTA_THROTTLE_MS);

      const erroCurto = erro ? erro.slice(0, IntegracaoStatusService.ERRO_MAX) : null;

      await this.prisma.integracaoStatus.upsert({
        where: { empresaId_servico: { empresaId, servico } },
        update: {
          status,
          errosSeguidos,
          ultimoErro: erroCurto,
          ultimoErroEm: agora,
          ultimaVerificacaoEm: agora,
          ...(podeAlertar ? { ultimoAlertaEm: agora } : {}),
        },
        create: {
          empresaId,
          servico,
          status,
          errosSeguidos,
          ultimoErro: erroCurto,
          ultimoErroEm: agora,
          ...(podeAlertar ? { ultimoAlertaEm: agora } : {}),
        },
      });

      if (podeAlertar) {
        await this.alertar(empresaId, servico, status, erroCurto);
      }
    } catch (err) {
      this.logger.warn(
        `[status] falha registrando erro de ${servico}/${empresaId}: ${this.msg(err)}`,
      );
    }
  }

  /** Atalho: marca desconexão definitiva (token/sessão caiu). */
  marcarDesconectado(empresaId: string, servico: string, erro?: string): Promise<void> {
    return this.registrarErro(empresaId, servico, erro, { desconectado: true });
  }

  /** Lista o status de todas as integrações de uma empresa. */
  listar(empresaId: string): Promise<IntegracaoStatus[]> {
    return this.prisma.integracaoStatus.findMany({
      where: { empresaId },
      orderBy: { servico: 'asc' },
    });
  }

  // ─── internos ──────────────────────────────────────────────────────────

  private async alertar(
    empresaId: string,
    servico: string,
    status: IntegracaoStatusValor,
    erro: string | null,
  ): Promise<void> {
    const para = await this.resolverDestinatario(empresaId);
    if (!para) {
      this.logger.warn(
        `[status] ${servico} caiu mas não há destinatário de alerta (empresa ${empresaId}).`,
      );
      return;
    }
    const nomeServico = SERVICO_METADATA[servico as ServicoIntegracao]?.nome ?? servico;
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { nome: true },
    });
    const nomeEmpresa = empresa?.nome ?? empresaId;
    const rotulo = status === 'DESCONECTADA' ? 'desconectou' : 'caiu';

    await this.email.enviarAlertaSistema({
      para,
      assunto: `⚠ Integração ${nomeServico} ${rotulo} na empresa ${nomeEmpresa}`,
      titulo: `Integração ${nomeServico} ${rotulo}`,
      mensagem:
        `A integração <strong>${nomeServico}</strong> da empresa <strong>${nomeEmpresa}</strong> ` +
        `está <strong>${status}</strong> e parou de funcionar.<br><br>` +
        (erro ? `<strong>Último erro:</strong> ${this.escapeHtml(erro)}<br><br>` : '') +
        `Acesse <em>Integrações</em> no betinna.ai e reconecte para voltar a receber mensagens/sincronizar. ` +
        `Você não receberá outro aviso desta integração na próxima hora.`,
    });
    this.logger.log(`[status] alerta de "${nomeServico} ${rotulo}" enviado para ${para}`);
  }

  /** Prioridade: DIRETOR da empresa → ADMIN ativo → BACKUP_ALERT_EMAIL. */
  private async resolverDestinatario(empresaId: string): Promise<string | null> {
    const director = await this.prisma.usuario.findFirst({
      where: { role: 'DIRECTOR', status: 'ATIVO', empresas: { some: { empresaId } } },
      orderBy: { criadoEm: 'asc' },
      select: { email: true },
    });
    if (director?.email) return director.email;

    const admin = await this.prisma.usuario.findFirst({
      where: { role: 'ADMIN', status: 'ATIVO' },
      orderBy: { criadoEm: 'asc' },
      select: { email: true },
    });
    if (admin?.email) return admin.email;

    const fallback = this.env.get('BACKUP_ALERT_EMAIL');
    return fallback && fallback.length > 0 ? fallback : null;
  }

  private msg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }

  private escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}
