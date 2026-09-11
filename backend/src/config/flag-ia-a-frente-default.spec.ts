import { describe, expect, it } from 'vitest';
import { envSchema } from './env.schema';

/**
 * O DEFAULT da `FLUXO_IA_A_FRENTE` é ligado — e isso é decisão, não acidente.
 *
 * 🔴 O caso medido em 11/09:
 *
 * ```
 * com a flag   RT encerra sem mover      → 1 execução do C1
 * sem a flag   RT move o lead 3×         → o cliente recebe a MESMA pergunta
 *                                          três vezes
 * ```
 *
 * ⚠️ Com default `false`, ambiente novo / variável removida / serviço recriado
 * **nasciam com o defeito** — e defeito que vem do default não aparece em lugar
 * nenhum até um cliente reclamar. É o oposto de uma flag de rollback, que só
 * deve mudar comportamento quando alguém a liga de propósito.
 *
 * Este teste existe pra que voltar o default seja uma escolha visível, e não um
 * efeito colateral de mexer no schema.
 */
describe('FLUXO_IA_A_FRENTE — o default', () => {
  /** Só o obrigatório; o resto do schema tem default próprio. */
  const MINIMO = {
    ENCRYPTION_KEY: '725aaf917ef6af281973ea43f8436aefa367a665d0bc7791c65f45398644edfb',
    DATABASE_URL: 'postgresql://u:p@host:5432/db',
    DIRECT_URL: 'postgresql://u:p@host:5432/db',
    SUPABASE_URL: 'https://exemplo.supabase.co',
    SUPABASE_ANON_KEY: 'anon',
    SUPABASE_SERVICE_ROLE_KEY: 'service',
  };

  it('vem LIGADA quando a variável não é informada', () => {
    const env = envSchema.parse({ ...MINIMO });
    expect(env.FLUXO_IA_A_FRENTE).toBe(true);
  });

  /** O rollback continua sendo uma variável, não um deploy. */
  it('a string "false" ainda desliga — o rollback não depende de deploy', () => {
    expect(envSchema.parse({ ...MINIMO, FLUXO_IA_A_FRENTE: 'false' }).FLUXO_IA_A_FRENTE).toBe(
      false,
    );
  });

  it('a string "true" liga', () => {
    expect(envSchema.parse({ ...MINIMO, FLUXO_IA_A_FRENTE: 'true' }).FLUXO_IA_A_FRENTE).toBe(true);
  });
});
