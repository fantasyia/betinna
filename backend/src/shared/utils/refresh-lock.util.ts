import type { RedisService } from '@database/redis.service';

/**
 * Serializa o REFRESH de token OAuth entre requisições concorrentes.
 *
 * AUDITORIA (média): `getAccessToken` era check-expira → refresh → persistir, sem
 * exclusão mútua. Dois webhooks chegando juntos com o token vencido chamavam o
 * refresh com o MESMO refresh_token — e ML/Shopee/TikTok ROTACIONAM o refresh a
 * cada troca. A 2ª chamada tomava `invalid_grant`, e pior: o que ficou
 * persistido podia ser o token já invalidado. A integração morria até alguém
 * reconectar na mão, sem ninguém entender por quê.
 *
 * Estratégia: quem pega o lock refaz; quem não pega ESPERA o vencedor e relê as
 * credenciais. Se o vencedor demorar demais, o perdedor segue e tenta (fail-open
 * — melhor uma chance de erro do que travar o atendimento).
 */
export async function comLockDeRefresh<T>(
  redis: RedisService,
  chave: string,
  deps: {
    /** Relê a credencial persistida (pra ver se o vencedor já renovou). */
    reler: () => Promise<T | null>;
    /** A credencial relida já serve? (não expirada) */
    valida: (c: T) => boolean;
    /** Faz o refresh de verdade + persiste. Só o dono do lock chama. */
    renovar: () => Promise<T>;
  },
  opts: { ttlSegundos?: number; tentativas?: number; esperaMs?: number } = {},
): Promise<T> {
  const ttl = opts.ttlSegundos ?? 20;
  const tentativas = opts.tentativas ?? 10;
  const espera = opts.esperaMs ?? 300;

  // Redis fora → sem lock, mas o refresh precisa acontecer (degrada gracioso).
  const pegou = await redis.setNxEx(chave, '1', ttl).catch(() => true);
  if (pegou) {
    try {
      return await deps.renovar();
    } finally {
      await redis.del(chave).catch(() => undefined);
    }
  }

  // Perdeu: espera o vencedor publicar a credencial nova.
  for (let i = 0; i < tentativas; i++) {
    await new Promise((r) => setTimeout(r, espera));
    const atual = await deps.reler().catch(() => null);
    if (atual && deps.valida(atual)) return atual;
  }

  // Vencedor travou/morreu: tenta assim mesmo em vez de deixar o caller sem token.
  return deps.renovar();
}
