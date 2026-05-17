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

    // OMIE em demo mode em produção é red flag (dados mockados).
    if (env === 'production' && this.get('OMIE_DEMO_MODE') === true) {
      issues.push({
        key: 'OMIE_DEMO_MODE',
        severity: 'critical',
        message:
          'OMIE_DEMO_MODE=true em produção — sistema retorna dados mock em vez de ' +
          'integrar com OMIE real. Defina OMIE_DEMO_MODE=false e configure credenciais.',
      });
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
