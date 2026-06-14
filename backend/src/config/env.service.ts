import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from './env.schema';

export interface EnvIssue {
  key: string;
  severity: 'warning' | 'critical';
  message: string;
}

/**
 * Wrapper tipado em torno do ConfigService do Nest.
 * Garante autocomplete e type-safety ao ler env.
 */
@Injectable()
export class EnvService {
  private readonly logger = new Logger(EnvService.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  get<K extends keyof Env>(key: K): Env[K] {
    return this.config.get(key, { infer: true });
  }

  get isProduction(): boolean {
    return this.get('NODE_ENV') === 'production';
  }

  get isDevelopment(): boolean {
    return this.get('NODE_ENV') === 'development';
  }

  get isTest(): boolean {
    return this.get('NODE_ENV') === 'test';
  }

  get corsOrigins(): string[] {
    return this.get('CORS_ORIGINS')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
  }

  /**
   * Audita config pra detectar valores inseguros / placeholder.
   *
   * Em produção, problemas `critical` fazem boot abortar (chamado em main.ts).
   * Em dev, todos viram warnings no log mas o app sobe normalmente.
   */
  auditProductionReadiness(): EnvIssue[] {
    const issues: EnvIssue[] = [];
    const env = this.get('NODE_ENV');

    // ENCRYPTION_KEY: 64 chars hex válido (schema garante), mas ainda pode
    // ser padrão exemplo (tudo zero, sequência óbvia).
    const encKey = this.get('ENCRYPTION_KEY');
    if (this.isWeakHexKey(encKey)) {
      issues.push({
        key: 'ENCRYPTION_KEY',
        severity: env === 'production' ? 'critical' : 'warning',
        message:
          'ENCRYPTION_KEY parece ser valor exemplo (zeros, sequência ou repetição). ' +
          'Gere uma nova com: `openssl rand -hex 32` e configure no Railway.',
      });
    }

    // SUPABASE_JWT_SECRET vazio: cai pro JWKS (funciona em projetos com plano
    // adequado, mas o JWKS pode falhar/lentificar). HS256 com secret é mais
    // estável.
    const jwtSecret = this.get('SUPABASE_JWT_SECRET');
    if (!jwtSecret || jwtSecret.length === 0) {
      issues.push({
        key: 'SUPABASE_JWT_SECRET',
        severity: 'warning',
        message:
          'SUPABASE_JWT_SECRET vazio — auth cai pro JWKS remoto. Funcional mas ' +
          'mais estável com HS256. Copie de Supabase Dashboard → Settings → API → JWT Settings.',
      });
    }

    // REDIS_URL em produção precisa apontar pra um Redis REAL.
    //
    // O schema tem default `redis://localhost:6379` (ótimo em dev), mas em
    // PRODUÇÃO esse default é armadilha: se a env não foi setada no Railway, o
    // app sobe apontando pro localhost — que não existe lá — e BullMQ (fluxos de
    // automação, campanhas) + o anti-spam do bot falham em SILÊNCIO (jobs somem,
    // nenhum erro no boot). Localhost em prod ⇒ crítico (aborta o boot).
    const redisUrl = this.get('REDIS_URL');
    // `([^@/]*@)?` aceita userinfo opcional (ex.: user:pass@localhost) sem
    // criar falso-positivo em hosts reais (default:senha@host.upstash.io não bate
    // porque o host depois do @ não é localhost).
    if (
      env === 'production' &&
      /^rediss?:\/\/([^@/]*@)?(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(redisUrl)
    ) {
      issues.push({
        key: 'REDIS_URL',
        severity: 'critical',
        message:
          'REDIS_URL aponta pra localhost em produção (provavelmente não foi setada no ' +
          'Railway, caindo no default redis://localhost:6379). BullMQ (fluxos/campanhas) e o ' +
          'anti-spam do bot dependem de um Redis real e falhariam em silêncio. Configure ' +
          'REDIS_URL no Railway (api e worker).',
      });
    }

    // OMIE em demo mode em produção.
    //
    // Por padrão é só AVISO (warning) — no bootstrap, antes do primeiro tenant
    // configurar OMIE, o sistema sobe em modo mock, o que é esperado (Railway
    // precisa subir pra você fazer onboarding). Apenas warning preserva o sinal
    // sem bloquear o deploy inicial.
    //
    // TRAVA DE GO-LIVE (dormente): quando você plugar o OMIE REAL e setar
    // `OMIE_REQUIRE_REAL=true` no Railway, demo em produção vira CRÍTICO e
    // ABORTA o boot — protege contra pedidos "fantasma" (parecem enviados ao
    // ERP mas não chegam). Enquanto OMIE_REQUIRE_REAL=false, nada muda.
    if (env === 'production' && this.get('OMIE_DEMO_MODE') === true) {
      const requerReal = this.get('OMIE_REQUIRE_REAL') === true;
      issues.push({
        key: 'OMIE_DEMO_MODE',
        severity: requerReal ? 'critical' : 'warning',
        message: requerReal
          ? 'OMIE_DEMO_MODE=true em produção com OMIE_REQUIRE_REAL=true — você sinalizou ' +
            'que o OMIE real está plugado, mas o modo demo ainda está LIGADO. Pedidos ' +
            'pareceriam enviados ao ERP sem chegar lá. Defina OMIE_DEMO_MODE=false no ' +
            'Railway (ou OMIE_REQUIRE_REAL=false se ainda estiver em demo de propósito).'
          : 'OMIE_DEMO_MODE=true em produção — sistema retorna dados mock em vez de ' +
            'integrar com OMIE real. Quando o primeiro tenant tiver credenciais OMIE, ' +
            'defina OMIE_DEMO_MODE=false no Railway (e OMIE_REQUIRE_REAL=true pra travar).',
      });
    }

    // E-mail transacional (Resend) — provedor ÚNICO. Se faltar config,
    // convites/propostas/aprovações NÃO saem. Aviso destacado (não crítico: o
    // app sobe, mas e-mails ficam mudos até configurar). Não silencioso — vai
    // pro logger.warn no boot.
    if (env === 'production') {
      const faltando = [
        this.get('RESEND_API_KEY') ? null : 'RESEND_API_KEY',
        this.get('RESEND_FROM_EMAIL') ? null : 'RESEND_FROM_EMAIL',
      ].filter((k): k is string => k !== null);
      if (faltando.length > 0) {
        issues.push({
          key: 'RESEND_API_KEY',
          severity: 'warning',
          message:
            `E-mail transacional indisponível: ${faltando.join(' e ')} ausente(s). ` +
            'O Resend é o ÚNICO provedor — convites de usuário, propostas e ' +
            'aprovações NÃO serão enviados até configurar no Railway.',
        });
      }
    }

    // BOOTSTRAP_TOKEN em produção sem ter sido removido após primeiro setup
    // é risco (endpoint privilegiado fica live). Aviso, não crítico — first-run
    // check já desabilita o endpoint quando há usuários.
    const bootstrap = process.env.BOOTSTRAP_TOKEN;
    if (env === 'production' && bootstrap && bootstrap.length > 0) {
      issues.push({
        key: 'BOOTSTRAP_TOKEN',
        severity: 'warning',
        message:
          'BOOTSTRAP_TOKEN está setado em produção. O endpoint /auth/bootstrap é ' +
          'desabilitado automaticamente após o primeiro user (first-run check), ' +
          'mas pode remover a variável depois de validar.',
      });
    }

    return issues;
  }

  /**
   * Boot-time check chamado em main.ts. Loga issues e aborta em prod se
   * houver críticas.
   */
  enforceProductionReadiness(): void {
    const issues = this.auditProductionReadiness();
    if (issues.length === 0) {
      this.logger.log('Env audit: tudo OK ✅');
      return;
    }

    const critical = issues.filter((i) => i.severity === 'critical');
    const warnings = issues.filter((i) => i.severity === 'warning');

    for (const w of warnings) {
      this.logger.warn(`[env] ${w.key}: ${w.message}`);
    }
    for (const c of critical) {
      this.logger.error(`[env] ${c.key}: ${c.message}`);
    }

    if (this.isProduction && critical.length > 0) {
      throw new Error(
        `Configuração de produção tem ${critical.length} problema(s) crítico(s) — ` +
          `corrija antes de fazer deploy. Veja logs acima.`,
      );
    }
  }

  /**
   * Detecta keys hex óbvias: tudo zero, tudo igual, sequências como
   * "0123456789abcdef..." repetidas. Heurística simples mas pega 99% dos
   * "esqueci de trocar o exemplo".
   */
  private isWeakHexKey(key: string): boolean {
    if (!key) return true;
    // Tudo zero
    if (/^0+$/.test(key)) return true;
    // Tudo igual (qualquer char repetido)
    if (/^(.)\1+$/.test(key)) return true;
    // Sequência simples "0123456789abcdef" repetida
    if (/^(0123456789abcdef)+$/i.test(key)) return true;
    // "deadbeef" repetido
    if (/^(deadbeef|cafebabe|feedface)+$/i.test(key)) return true;
    return false;
  }
}
