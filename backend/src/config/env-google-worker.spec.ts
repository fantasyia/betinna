import { describe, expect, it } from 'vitest';
import { EnvService } from './env.service';

/**
 * P7 da Bateria 3 (14/09/2026) — credencial do Google no WORKER.
 *
 * O worker não sobe servidor HTTP, então o callback do OAuth nunca chega nele:
 * toda conexão com o Google nasce e renova na api. Ter `GOOGLE_*` no worker é
 * configuração morta — e em 14/09 ela DIVERGIA (CLIENT_ID de outro projeto,
 * REDIRECT_URI do host anterior ao cutover de 07/09).
 *
 * Não quebra nada hoje. Quebra no dia em que alguém mover a sincronização de
 * agenda pra um job do worker: o refresh sai com a credencial errada, o Google
 * responde `invalid_grant` e o app derruba a conexão — sem nada no log ligando
 * a causa ao efeito. O aviso no boot troca a armadilha por uma frase.
 */
function env(vars: Record<string, string>): EnvService {
  return new EnvService({ get: (k: string) => vars[k] ?? '' } as never);
}

describe('auditProductionReadiness — GOOGLE_* no worker (P7)', () => {
  it('worker COM credencial do Google → avisa que é configuração morta', () => {
    const issues = env({
      SERVICE_TYPE: 'worker',
      GOOGLE_CLIENT_ID: '146875196181-ifblsac.apps.googleusercontent.com',
      NODE_ENV: 'production',
    }).auditProductionReadiness();

    const google = issues.find((i) => i.key === 'GOOGLE_CLIENT_ID');
    expect(google).toBeDefined();
    expect(google?.message).toMatch(/worker/i);
  });

  it('worker SEM credencial → silêncio (é o estado desejado)', () => {
    const issues = env({
      SERVICE_TYPE: 'worker',
      NODE_ENV: 'production',
    }).auditProductionReadiness();
    expect(issues.find((i) => i.key === 'GOOGLE_CLIENT_ID')).toBeUndefined();
  });

  it('API com credencial → silêncio: é lá que o OAuth acontece', () => {
    const issues = env({
      SERVICE_TYPE: 'api',
      GOOGLE_CLIENT_ID: '887501717738-mai5p8m.apps.googleusercontent.com',
      NODE_ENV: 'production',
    }).auditProductionReadiness();
    expect(issues.find((i) => i.key === 'GOOGLE_CLIENT_ID')).toBeUndefined();
  });
});
