import { timingSafeEqual } from 'node:crypto';
import { assinarShein, decifrarSecretKey } from './shein-assinatura';

/**
 * Webhook da Shein (Open Platform → "Instruções de acesso de retorno de
 * chamada de evento", lida em 02/11) — regras PURAS.
 *
 * POST form-data com `eventData` (cifrado) e os cabeçalhos x-lt-appid,
 * x-lt-openKeyId, x-lt-eventCode, x-lt-timestamp e x-lt-signature. A
 * assinatura é a MESMA da API, mas com o par do APLICATIVO (appid + segredo do
 * app) e o caminho do callback; os 5 primeiros caracteres são o aleatório.
 * O `eventData` é AES-128-CBC, chave = 16 primeiros bytes do segredo do app,
 * IV fixo "space-station-de" — o mesmo esquema do secretKey da loja.
 */

/** Confere a assinatura do callback (comparação em tempo constante). */
export function assinaturaWebhookValida(
  assinatura: string,
  appId: string,
  appSecret: string,
  caminho: string,
  timestamp: string,
): boolean {
  if (!assinatura || assinatura.length <= 5 || !/^\d+$/.test(timestamp)) return false;
  const esperada = assinarShein(
    appId,
    appSecret,
    caminho,
    Number(timestamp),
    assinatura.slice(0, 5),
  ).assinatura;
  const a = Buffer.from(assinatura);
  const b = Buffer.from(esperada);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Decifra o `eventData` e devolve o objeto do evento. */
export function eventoShein(eventData: string, appSecret: string): Record<string, unknown> {
  const texto = decifrarSecretKey(eventData, appSecret);
  const j: unknown = JSON.parse(texto);
  if (!j || typeof j !== 'object' || Array.isArray(j)) {
    throw new Error('eventData da Shein não é um objeto');
  }
  return j as Record<string, unknown>;
}
