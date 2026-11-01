import { createDecipheriv, createHmac, randomBytes } from 'node:crypto';

/**
 * Assinatura da Open API da Shein (PURO, 01/11).
 *
 * VALOR = `<id>&<timestamp ms>&<path>`; CHAVE = segredo + 5 caracteres
 * aleatórios; HMAC-SHA256 em hex → base64; assinatura final = aleatório +
 * base64. O mesmo algoritmo serve pro aplicativo (id = appid, cabeçalho
 * x-lt-appid — só na troca do token) e pra loja (id = openKeyId, cabeçalho
 * x-lt-openKeyId — em todo o resto). Conferido contra a Shein em 01/11: com
 * o par do aplicativo no cabeçalho de loja a resposta é openapi00007.
 */
const ALFANUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function aleatorio5(): string {
  return Array.from(randomBytes(5), (b) => ALFANUM[b % ALFANUM.length]).join('');
}

export function assinarShein(
  id: string,
  segredo: string,
  path: string,
  timestamp = Date.now(),
  rnd = aleatorio5(),
): { timestamp: string; assinatura: string } {
  const hex = createHmac('sha256', `${segredo}${rnd}`)
    .update(`${id}&${timestamp}&${path}`)
    .digest('hex');
  return { timestamp: String(timestamp), assinatura: rnd + Buffer.from(hex).toString('base64') };
}

/**
 * O secretKey da loja volta CIFRADO do get-by-token: AES-128-CBC, chave = os
 * 16 primeiros bytes do segredo do aplicativo, IV fixo da Shein, entrada em base64.
 */
export function decifrarSecretKey(cifrado: string, appSecret: string): string {
  const chave = Buffer.from(appSecret, 'utf8').subarray(0, 16);
  const d = createDecipheriv('aes-128-cbc', chave, Buffer.from('space-station-de', 'utf8'));
  return Buffer.concat([d.update(Buffer.from(cifrado, 'base64')), d.final()]).toString('utf8');
}

/** Hora da Shein (UTC+8) no formato que a API pede: "2026-11-01 08:00:00". */
export function horaShein(d: Date): string {
  return new Date(d.getTime() + 8 * 3_600_000).toISOString().replace('T', ' ').slice(0, 19);
}
