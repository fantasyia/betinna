import { lookup as dnsLookup } from 'node:dns/promises';
import { BusinessRuleException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';

/**
 * Erro específico de SSRF — quando uma URL falha nas verificações de segurança.
 * Use sempre via `safeRequest()` ou `assertSafeUrl()` — não instancie direto.
 */
export class SsrfBlockedError extends BusinessRuleException {
  constructor(message: string) {
    super(`Bloqueado por proteção SSRF: ${message}`, ErrorCode.BUSINESS_RULE_VIOLATION);
  }
}

/**
 * Schemes permitidas em URLs vindas do usuário (config de fluxo, webhook externo).
 * Apenas HTTP e HTTPS — bloqueia file://, ftp://, gopher://, javascript:, data:, etc.
 */
const ALLOWED_SCHEMES = new Set(['http:', 'https:']);

/**
 * Hosts/IPs proibidos — bloqueio direto por substring.
 * IPv4 metadata da AWS, GCP, Azure + localhost variants.
 */
const BLOCKED_HOSTS = new Set<string>([
  // localhost
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  // cloud metadata services
  '169.254.169.254',          // AWS EC2 / GCP / DigitalOcean / Oracle Cloud
  'metadata.google.internal', // GCP
  'metadata.azure.com',       // Azure (alguns endpoints)
  'instance-data.ec2.internal',
]);

/**
 * Faixas de IP privadas (RFC 1918 + link-local + loopback + carrier-grade NAT).
 * Verificação via prefixo numérico após DNS resolve.
 */
interface IpV4Range {
  prefix: number;  // máscara em bits
  network: number; // representação numérica do início da faixa
}

function ipv4ToInt(ip: string): number | null {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const parts = m.slice(1, 5).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return (parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3];
}

const PRIVATE_IPV4_RANGES: IpV4Range[] = [
  // 10.0.0.0/8 — RFC 1918
  { network: ipv4ToInt('10.0.0.0')!, prefix: 8 },
  // 172.16.0.0/12 — RFC 1918
  { network: ipv4ToInt('172.16.0.0')!, prefix: 12 },
  // 192.168.0.0/16 — RFC 1918
  { network: ipv4ToInt('192.168.0.0')!, prefix: 16 },
  // 127.0.0.0/8 — loopback
  { network: ipv4ToInt('127.0.0.0')!, prefix: 8 },
  // 169.254.0.0/16 — link-local (inclui metadata services)
  { network: ipv4ToInt('169.254.0.0')!, prefix: 16 },
  // 100.64.0.0/10 — carrier-grade NAT
  { network: ipv4ToInt('100.64.0.0')!, prefix: 10 },
  // 0.0.0.0/8 — current network
  { network: ipv4ToInt('0.0.0.0')!, prefix: 8 },
];

function isPrivateIpv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return false;
  for (const r of PRIVATE_IPV4_RANGES) {
    const mask = r.prefix === 0 ? 0 : (0xffffffff << (32 - r.prefix)) >>> 0;
    if ((n & mask) === (r.network & mask)) return true;
  }
  return false;
}

/**
 * IPv6 privadas comuns:
 *  ::1                  — loopback
 *  fc00::/7             — unique local
 *  fe80::/10            — link-local
 *  ::ffff:<v4>          — IPv4-mapped (avaliamos o v4)
 */
function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // fc00::/7
  if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) {
    return true; // fe80::/10
  }
  // IPv4-mapped — formato decimal `::ffff:127.0.0.1`
  const v4mappedDec = lower.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4mappedDec) return isPrivateIpv4(v4mappedDec[1]);
  // IPv4-mapped — formato hex `::ffff:7f00:1` (Node normaliza assim)
  // Padrão: `::ffff:HHHH:HHHH` onde os 32 bits hex codificam um IPv4
  const v4mappedHex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (v4mappedHex) {
    const hi = parseInt(v4mappedHex[1], 16);
    const lo = parseInt(v4mappedHex[2], 16);
    const a = (hi >> 8) & 0xff;
    const b = hi & 0xff;
    const c = (lo >> 8) & 0xff;
    const d = lo & 0xff;
    return isPrivateIpv4(`${a}.${b}.${c}.${d}`);
  }
  return false;
}

/**
 * Verifica que uma URL é segura para ser chamada do servidor.
 * Lança `SsrfBlockedError` se:
 *  - Schema não é http/https
 *  - Hostname é um dos blocked hosts (localhost, metadata services)
 *  - DNS resolve aponta para IP privado/loopback/link-local
 *
 * O DNS resolve é OBRIGATÓRIO porque sem ele um atacante pode usar:
 *  - DNS rebinding: domínio público que resolve pra 127.0.0.1
 *  - Hostnames customizados em /etc/hosts (irrelevante em container, mas defesa)
 *
 * @param url URL completa (ex: 'https://api.example.com/webhook')
 * @throws SsrfBlockedError quando URL não é segura
 */
export async function assertSafeUrl(url: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SsrfBlockedError(`URL malformada: ${url}`);
  }

  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    throw new SsrfBlockedError(
      `Schema ${parsed.protocol} não permitida (apenas http/https)`,
    );
  }

  // Node.js URL retorna hostname IPv6 com brackets `[fd00::1]` — strip pra
  // verificação consistente.
  let hostname = parsed.hostname.toLowerCase();
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    hostname = hostname.slice(1, -1);
  }

  // Bloqueio direto por hostname conhecido
  if (BLOCKED_HOSTS.has(hostname)) {
    throw new SsrfBlockedError(`Hostname bloqueado: ${hostname}`);
  }

  // Se o hostname já é um IP literal, verifica direto
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
    if (isPrivateIpv4(hostname)) {
      throw new SsrfBlockedError(`IP privado bloqueado: ${hostname}`);
    }
  } else if (hostname.includes(':')) {
    if (isPrivateIpv6(hostname)) {
      throw new SsrfBlockedError(`IPv6 privado bloqueado: ${hostname}`);
    }
  } else {
    // DNS resolve para detectar rebinding pra IP privado
    try {
      const resolved = await dnsLookup(hostname, { all: true });
      for (const r of resolved) {
        if (r.family === 4 && isPrivateIpv4(r.address)) {
          throw new SsrfBlockedError(
            `Hostname ${hostname} resolve para IP privado ${r.address}`,
          );
        }
        if (r.family === 6 && isPrivateIpv6(r.address)) {
          throw new SsrfBlockedError(
            `Hostname ${hostname} resolve para IPv6 privado ${r.address}`,
          );
        }
      }
    } catch (err) {
      if (err instanceof SsrfBlockedError) throw err;
      // DNS falhou — bloqueia por padrão pra evitar bypass via host inexistente
      throw new SsrfBlockedError(`Hostname não resolvido: ${hostname}`);
    }
  }

  return parsed;
}

/**
 * Wrapper de `fetch` com validação SSRF + timeout.
 *
 * @param url URL pública (vai ser validada)
 * @param init opções do fetch (method, headers, body)
 * @param opts.timeoutMs default 10s
 */
export async function safeRequest(
  url: string,
  init: RequestInit = {},
  opts: { timeoutMs?: number } = {},
): Promise<Response> {
  const validated = await assertSafeUrl(url);
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(validated.toString(), {
      ...init,
      signal: controller.signal,
      // Sem redirect automático — redirect 302 pra IP interno é vetor de SSRF
      redirect: 'manual',
    });
  } finally {
    clearTimeout(timer);
  }
}
