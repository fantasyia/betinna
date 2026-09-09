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
  // PII de terceiros (contato do Lead prospectado) — o nome não casa nenhum regex de valor
  // e vazava em erro/log. contatoEmail/Telefone já são mascarados por valor, mas cobrimos a chave.
  'contatoNome',
  'contatoEmail',
  'contatoTelefone',
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

// =============================================================================
// TELEFONE ESCRITO NO MEIO DE UMA FRASE — e por que a FORMA é obrigatória.
//
// O `RX_PHONE` acima só vale quando a string INTEIRA é um telefone. Não alcança
// a frase que o nosso código escreve à mão:
//
//   "Falha ao enviar para (11) 99999-0000"
//   "Cliente pediu retorno no 11 99999-0000"
//
// E telefone é o dado pessoal dominante deste app — base de reps e conversa de
// WhatsApp. Mensagem de erro de envio é exatamente onde ele aparece solto.
//
// ⚠️ EXIGIR FORMA (parênteses, separador ou DDI) NÃO É DETALHE — é o que separa
// esta regra de um vazamento de utilidade. Sequência de 10-11 dígitos solta é id,
// número de pedido ou timestamp muito mais vezes que telefone. No site isso foi
// pago em produção: um padrão genérico de 10-11 dígitos comeu o trace id e o
// `sample_rand` DO PRÓPRIO SENTRY, e o evento chegava sem rastro.
//
// Limpar demais é o outro jeito de errar aqui, e é o mais silencioso: erro sem
// pilha parece um erro normal até o dia de precisar dele.
//
// Portado de `somatec_web/src/lib/observabilidade/sentry-limpeza.ts`, onde os
// dois já rodam em produção. Mesma definição de propósito: duas definições
// diferentes pro mesmo risco dariam duas respostas.
// =============================================================================

/** (11) 99999-0000 · +55 (11) 99999 0000 */
const RX_TELEFONE_COM_PARENTESES = /(?:\+?55[\s.-]?)?\(\d{2}\)[\s.-]?\d{4,5}[\s.-]?\d{4}\b/g;
/** 11 99999-0000 · 11.99999.0000 · +55 11 99999-0000 */
const RX_TELEFONE_COM_SEPARADOR = /(?:\+?55[\s.-])?\b\d{2}[\s.-]\d{4,5}[\s.-]\d{4}\b/g;
const RX_CPF = /^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$/;
const RX_CNPJ = /^\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}$/;

/**
 * PII DENTRO DE TEXTO CORRIDO — a mensagem de erro, o log, a exceção.
 *
 * O `sanitize` acima cuida de VALORES: ele mascara quando a string INTEIRA é um
 * e-mail, um telefone, um documento. Mas o nosso código escreve frases:
 *
 *   "Falha ao entregar lead joao@empresa.com.br"
 *   "Destinatário inválido: {"jid":"5511999990000@s.whatsapp.net","exists":false}"
 *
 * Nenhuma das duas casa os regex ancorados, e as duas viajavam inteiras pro
 * Sentry — que é um terceiro. Numa base com conversa de WhatsApp e telefone em
 * quase todo payload, isso é exportação de base, não observabilidade.
 *
 * ⚠️ CONSERVADOR DE PROPÓSITO. Limpar demais é o outro jeito de estragar isto:
 * a sessão do site perdeu tempo com um filtro que comia a própria exceção
 * (`exCEPtion` contém `cep`) e o evento chegava sem mensagem e sem pilha —
 * compilando e com teste verde. Aqui só entram padrões que não confundem com
 * id, número de pedido, timestamp ou trace: e-mail, documento COM pontuação,
 * jid do WhatsApp e valor de chave sensível em JSON embutido.
 *
 * Sequência de dígitos solta NÃO é tocada — ela é id, número de pedido ou
 * timestamp com muito mais frequência do que telefone.
 */
export function sanitizarTexto(texto: string): string {
  return (
    texto
      // e-mail em qualquer posição
      .replace(/[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}/gi, (m) => maskEmail(m))
      // CPF/CNPJ COM pontuação (sem pontuação seria indistinguível de id)
      .replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, (m) => `***-${m.slice(-2)}`)
      .replace(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g, (m) => `***-${m.slice(-2)}`)
      // jid do WhatsApp: o "@s.whatsapp.net" é o que torna os dígitos um telefone
      .replace(
        /\b(\d{8,15})@(s\.whatsapp\.net|c\.us|g\.us)/g,
        (_m, d: string, dom: string) => `${maskPhone(d)}@${dom}`,
      )
      // valor de chave sensível em JSON embutido na mensagem
      .replace(
        /"(telefone|phone|number|email|cpf|cnpj|senha|password|token|secret)"\s*:\s*"([^"]*)"/gi,
        (_m, chave: string) => `"${chave}":"${REDACTED}"`,
      )
      // TELEFONE COM FORMA, solto na frase — ver o bloco abaixo pro porquê da forma.
      .replace(RX_TELEFONE_COM_PARENTESES, (m) => maskPhone(m))
      .replace(RX_TELEFONE_COM_SEPARADOR, (m) => maskPhone(m))
  );
}

/**
 * Sanitiza um valor. Profundidade m\u00e1xima 5 (evita loop em circular refs).
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
