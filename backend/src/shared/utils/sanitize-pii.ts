/**
 * Sanitização de PII (Personally Identifiable Information) antes de logar/enviar a Sentry.
 *
 * Sprint 3 FIX 4 + FIX 5 (Sentry beforeSend).
 *
 * Estratégia:
 *  1. Chaves com nomes "sensíveis" (email, telefone, cpf, cnpj, senha, token, api*key)
 *     → substituídas por '[REDACTED]'
 *  2. Chaves de credenciais (apiKey, accessToken, refreshToken, password)
 *     → idem
 *  3. Strings que parecem email/telefone/cpf/cnpj em qualquer valor
 *     → mascaradas parcialmente (preserva primeiro/último char pra debug)
 *  4. URLs com query string contendo `?token=` ou `?code=` → strip
 *
 * NÃO é cripto-secure (não pretende ser); é um best-effort pra reduzir vazamento
 * em logs e erros enviados a Sentry. Use Pino redact (em app.module) como
 * primeira linha.
 */

const SENSITIVE_KEYS = new Set([
  'email',
  'emails',
  'phone',
  'phones',
  'telefone',
  'cpf',
  'cnpj',
  'password',
  'senha',
  'token',
  'access_token',
  'refresh_token',
  'apiKey',
  'api_key',
  'authorization',
  'cookie',
  'creditCard',
  'cardNumber',
  'cvv',
  'secret',
  'partnerKey',
  'partner_key',
  'appSecret',
  'app_secret',
  'clientSecret',
  'client_secret',
  'encryptionKey',
  'sessionId',
]);

const REDACTED = '[REDACTED]';

/**
 * Mascara CPF/CNPJ — retorna `***-XX` preservando últimos 2 dígitos.
 */
function maskDoc(s: string): string {
  // CPF
  const cpf = s.match(/^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$/);
  if (cpf) return `***-${s.slice(-2)}`;
  // CNPJ
  const cnpj = s.match(/^\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}$/);
  if (cnpj) return `***-${s.slice(-2)}`;
  return s;
}

function maskEmail(s: string): string {
  const i = s.indexOf('@');
  if (i < 1) return s;
  const local = s.slice(0, i);
  const domain = s.slice(i);
  const visible =
    local.length <= 2
      ? local[0]
      : `${local[0]}${'*'.repeat(local.length - 2)}${local[local.length - 1]}`;
  return `${visible}${domain}`;
}

function maskPhone(s: string): string {
  // Mantém primeiro e últimos 4 dígitos
  const digits = s.replace(/\D/g, '');
  if (digits.length < 6) return s;
  return `${digits.slice(0, 2)}****${digits.slice(-4)}`;
}

const RX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RX_PHONE = /^\+?\d[\d\s().-]{7,}$/;
const RX_CPF = /^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$/;
const RX_CNPJ = /^\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}$/;

/**
 * Sanitiza um valor. Profundidade máxima 5 (evita loop em circular refs).
 */
export function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[depth-cut]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    if (RX_EMAIL.test(value)) return maskEmail(value);
    if (RX_CPF.test(value) || RX_CNPJ.test(value)) return maskDoc(value);
    if (RX_PHONE.test(value)) return maskPhone(value);
    // URL com query sensível → strip
    if (/^https?:\/\/.+\?(.*?(token|code|secret|key)=[^&]+)/i.test(value)) {
      try {
        const u = new URL(value);
        ['token', 'code', 'secret', 'key', 'apiKey'].forEach((p) => u.searchParams.delete(p));
        return u.toString() + (u.searchParams.toString() ? '' : '');
      } catch {
        return REDACTED;
      }
    }
    return value;
  }
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => sanitize(v, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const lowerKey = k.toLowerCase();
    if (SENSITIVE_KEYS.has(k) || SENSITIVE_KEYS.has(lowerKey)) {
      out[k] = REDACTED;
      continue;
    }
    out[k] = sanitize(v, depth + 1);
  }
  return out;
}
