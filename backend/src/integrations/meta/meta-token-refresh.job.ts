import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EnvService } from '@config/env.service';
import { IntegracaoStatusService } from '@modules/integracoes/integracao-status.service';
import { IntegracoesService } from '@modules/integracoes/integracoes.service';
import { BusinessRuleException, IntegrationException } from '@shared/errors/app-exception';
import { CronLockService } from '@shared/utils/cron-lock.service';
import { MetaOAuthService } from './meta-oauth.service';

const SERVICOS = ['facebook', 'instagram'] as const;

/**
 * Classifica a falha de renovação do token Meta.
 *
 * `definitiva` (desconectar + alertar): token revogado/expirado/sem permissão — Meta
 * responde 4xx (OAuthException) ou a página não é mais acessível (BusinessRuleException).
 * `transitoria` (manter conexão, retentar no próximo run): 5xx do Meta, timeout ou rede
 * (HttpClientError vira IntegrationException com upstreamStatus 5xx/0). Erro desconhecido
 * é tratado como transitório — conservador, pra NÃO derrubar a conexão por engano.
 */
export function classificarFalhaToken(err: unknown): 'definitiva' | 'transitoria' {
  if (err instanceof BusinessRuleException) return 'definitiva';
  if (err instanceof IntegrationException) {
    const s = err.upstreamStatus;
    // 4xx = token inválido/revogado/sem permissão (definitivo), EXCETO 408/429 que são
    // transitórios (timeout/rate-limit). 5xx e 0 (rede) também são transitórios.
    const ehAuth4xx = typeof s === 'number' && s >= 400 && s < 500 && s !== 408 && s !== 429;
    return ehAuth4xx ? 'definitiva' : 'transitoria';
  }
  return 'transitoria';
}

/**
 * Renovação proativa do token long-lived do Meta (Facebook/Instagram) — auditoria #15.
 *
 * O token de página do Meta deriva de um user token long-lived (~60 dias). Sem
 * renovar, ele expira e FB/IG desconectam EM SILÊNCIO (diferente dos marketplaces
 * e do WhatsApp, que já renovam). Este cron roda 1x/dia e renova as conexões que
 * estão a menos de ~14 dias de expirar (`MetaOAuthService.renovarTokenSeNecessario`).
 *
 * Se a renovação falhar (token revogado/expirado, página sem permissão), marca a
 * integração como desconectada e alerta o diretor pelo semáforo de integrações
 * (`IntegracaoStatusService`) — assim o cliente fica sabendo em vez de descobrir
 * quando uma mensagem não chega.
 *
 * Falha em uma empresa não derruba o job (try/catch por empresa). `CronLockService`
 * garante execução única em multi-réplica (api + worker).
 */
@Injectable()
export class MetaTokenRefreshJob {
  private readonly logger = new Logger(MetaTokenRefreshJob.name);

  constructor(
    private readonly env: EnvService,
    private readonly integracoes: IntegracoesService,
    private readonly metaOAuth: MetaOAuthService,
    private readonly status: IntegracaoStatusService,
    private readonly cronLock: CronLockService,
  ) {}

  @Cron('30 4 * * *', { name: 'meta-token-refresh', timeZone: 'UTC' })
  async run(): Promise<void> {
    if (this.env.get('NODE_ENV') === 'test') return;
    if (!(await this.cronLock.acquire('meta-token-refresh', 30 * 60))) return;

    for (const servico of SERVICOS) {
      const ativas = await this.integracoes.listarAtivasPorServico(servico);
      for (const { empresaId } of ativas) {
        try {
          const r = await this.metaOAuth.renovarTokenSeNecessario(empresaId, servico);
          if (r === 'renovado') {
            await this.status.registrarSucesso(empresaId, servico);
            this.logger.log(`Token ${servico} renovado (empresa=${empresaId})`);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (classificarFalhaToken(err) === 'transitoria') {
            // 5xx/timeout/rede — NÃO desconecta (senão um flap derrubava FB/IG por engano);
            // o próximo run diário tenta de novo enquanto ainda houver margem de dias.
            this.logger.warn(
              `Falha transitória ao renovar token ${servico} empresa=${empresaId} (mantém conexão): ${msg}`,
            );
            continue;
          }
          this.logger.error(
            `Falha definitiva ao renovar token ${servico} empresa=${empresaId}: ${msg}`,
          );
          await this.status.marcarDesconectado(
            empresaId,
            servico,
            `Falha ao renovar token Meta: ${msg}`,
          );
        }
      }
    }
  }

  /** Disparo manual (admin/diagnóstico) — força a renovação ignorando o limiar de dias. */
  async forcar(
    empresaId: string,
    servico: 'facebook' | 'instagram',
  ): Promise<'renovado' | 'ok' | 'sem-conexao' | 'sem-expiracao'> {
    return this.metaOAuth.renovarTokenSeNecessario(empresaId, servico, Number.POSITIVE_INFINITY);
  }
}
