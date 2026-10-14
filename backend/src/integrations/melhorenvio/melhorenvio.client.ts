import { IntegrationException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AmbienteFrete, OpcaoCotada } from '@modules/vitrine/frete';

/**
 * Melhor Envio — COTAÇÃO (POST /api/v2/me/shipment/calculate) e ETIQUETA
 * (carrinho → compra com o saldo da carteira → geração → impressão).
 *
 *  - produção `https://melhorenvio.com.br`, sandbox `https://sandbox.melhorenvio.com.br`;
 *    token de um ambiente não vale no outro (401);
 *  - `User-Agent` com nome do app e e-mail técnico é EXIGIDO pela API;
 *  - medidas em cm (inteiros), peso em kg, seguro em R$;
 *  - a resposta lista TODOS os serviços; quem não atende o volume vem com
 *    `error` e sem preço — esse fica de fora;
 *  - `custom_price` é o preço da CONTA (com o desconto dela); `price` é o de
 *    tabela. Vale o que a empresa paga.
 *
 * O token nunca aparece em mensagem de erro nem em log.
 */
const BASE: Record<AmbienteFrete, string> = {
  sandbox: 'https://sandbox.melhorenvio.com.br',
  producao: 'https://melhorenvio.com.br',
};

export interface VolumeCotacao {
  comprimentoCm: number;
  larguraCm: number;
  alturaCm: number;
  pesoG: number;
  /** Valor declarado (R$) do que vai neste volume. */
  seguro: number;
}

interface ServicoApi {
  id?: number;
  name?: string;
  price?: string | number;
  custom_price?: string | number;
  delivery_time?: number;
  custom_delivery_time?: number;
  error?: string;
  company?: { name?: string };
}

const centavos = (v: string | number | undefined): number | null => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : v;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
};

export class MelhorEnvioClient {
  constructor(
    private readonly token: string,
    readonly ambiente: AmbienteFrete,
    private readonly emailTecnico: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    if (!token.trim()) {
      throw new IntegrationException('Token do Melhor Envio vazio', ErrorCode.INTEGRATION_ERROR);
    }
  }

  async cotar(cepOrigem: string, cepDestino: string, v: VolumeCotacao): Promise<OpcaoCotada[]> {
    const r = await this.fetchFn(`${BASE[this.ambiente]}/api/v2/me/shipment/calculate`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
        'User-Agent': `Betinna.ai (${this.emailTecnico || 'sem e-mail'})`,
      },
      body: JSON.stringify({
        from: { postal_code: cepOrigem },
        to: { postal_code: cepDestino },
        volumes: [
          {
            width: Math.ceil(v.larguraCm),
            height: Math.ceil(v.alturaCm),
            length: Math.ceil(v.comprimentoCm),
            weight: Math.max(0.01, Math.round(v.pesoG) / 1000),
            insurance: Math.round(v.seguro * 100) / 100,
          },
        ],
        options: { receipt: false, own_hand: false },
      }),
      signal: AbortSignal.timeout(12_000),
      redirect: 'error',
    });
    const texto = await r.text();
    let json: unknown = null;
    try {
      json = texto ? JSON.parse(texto) : null;
    } catch {
      json = null;
    }
    if (!r.ok) {
      const msg =
        r.status === 401
          ? 'O Melhor Envio recusou o token (inválido, vencido ou de outro ambiente)'
          : r.status === 422
            ? `Melhor Envio recusou a cotação: ${resumoErros(json)}`
            : `Melhor Envio respondeu ${r.status}`;
      throw new IntegrationException(msg, ErrorCode.INTEGRATION_ERROR);
    }
    const lista = Array.isArray(json) ? (json as ServicoApi[]) : [];
    const out: OpcaoCotada[] = [];
    for (const s of lista) {
      const precoC = centavos(s.custom_price) ?? centavos(s.price);
      if (s.error || typeof s.id !== 'number' || precoC === null) continue;
      const prazo = s.custom_delivery_time ?? s.delivery_time;
      out.push({
        id: s.id,
        nome: s.name ?? `Serviço ${s.id}`,
        transportadora: s.company?.name ?? '',
        precoC,
        prazoDias: typeof prazo === 'number' ? prazo : null,
      });
    }
    return out;
  }
}

/** Um envio pro carrinho do Melhor Envio (corpo de POST /api/v2/me/cart). */
export interface EnvioCarrinho {
  service: number;
  from: Record<string, string>;
  to: Record<string, string>;
  products: Array<{ name: string; quantity: string; unitary_value: string }>;
  volumes: Array<{ height: number; width: number; length: number; weight: number }>;
  options: Record<string, unknown>;
}

export interface MelhorEnvioEtiquetas {
  adicionarAoCarrinho(envio: EnvioCarrinho): Promise<{ id: string; precoC: number | null }>;
  comprar(ids: string[]): Promise<{ totalC: number | null }>;
  gerar(ids: string[]): Promise<Array<{ id: string; ok: boolean; mensagem: string }>>;
  imprimir(ids: string[]): Promise<string>;
  /** O PDF de cada etiqueta, baixado com o token — abre sem login no Melhor Envio. */
  pdfs(ids: string[]): Promise<Buffer[]>;
}

/**
 * Link do PDF que o Melhor Envio devolve: só https no S3 da Amazon. Qualquer
 * outro destino é recusado antes do download (o app não busca URL arbitrária). PURO.
 */
export function linkPdfConfiavel(u: string): boolean {
  try {
    const q = new URL(u);
    return q.protocol === 'https:' && q.hostname.endsWith('.amazonaws.com');
  } catch {
    return false;
  }
}

/**
 * Etiqueta: os 4 passos da API. Cada um é chamado em separado pelo serviço,
 * que grava no pedido o que já foi feito — clicar de novo continua de onde
 * parou e NUNCA compra duas vezes.
 */
export class MelhorEnvioEtiquetaClient implements MelhorEnvioEtiquetas {
  constructor(
    private readonly token: string,
    readonly ambiente: AmbienteFrete,
    private readonly emailTecnico: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    if (!token.trim()) {
      throw new IntegrationException('Token do Melhor Envio vazio', ErrorCode.INTEGRATION_ERROR);
    }
  }

  private async post(caminho: string, body: unknown, rotulo: string): Promise<unknown> {
    const r = await this.fetchFn(`${BASE[this.ambiente]}/api/v2/me${caminho}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
        'User-Agent': `Betinna.ai (${this.emailTecnico || 'sem e-mail'})`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
      redirect: 'error',
    });
    const texto = await r.text();
    let json: unknown = null;
    try {
      json = texto ? JSON.parse(texto) : null;
    } catch {
      json = null;
    }
    if (!r.ok) {
      const msg =
        r.status === 401
          ? 'O Melhor Envio recusou o token (inválido, vencido, de outro ambiente ou sem a permissão)'
          : r.status === 422
            ? `${rotulo}: ${resumoErros(json)}`
            : `${rotulo}: o Melhor Envio respondeu ${r.status}${mensagemDe(json)}`;
      throw new IntegrationException(msg, ErrorCode.INTEGRATION_ERROR);
    }
    return json;
  }

  async adicionarAoCarrinho(envio: EnvioCarrinho) {
    const j = (await this.post('/cart', envio, 'Carrinho do Melhor Envio')) as {
      id?: string;
      price?: string | number;
    } | null;
    if (!j?.id) {
      throw new IntegrationException(
        'O Melhor Envio não devolveu o id do envio no carrinho',
        ErrorCode.INTEGRATION_ERROR,
      );
    }
    return { id: j.id, precoC: centavos(j.price) };
  }

  async comprar(ids: string[]) {
    const j = (await this.post('/shipment/checkout', { orders: ids }, 'Compra da etiqueta')) as {
      purchase?: { total?: string | number };
    } | null;
    return { totalC: centavos(j?.purchase?.total) };
  }

  async gerar(ids: string[]) {
    const j = ((await this.post('/shipment/generate', { orders: ids }, 'Geração da etiqueta')) ??
      {}) as Record<string, { status?: boolean; message?: string }>;
    return ids.map((id) => ({
      id,
      ok: j[id]?.status === true,
      mensagem: j[id]?.message ?? 'sem resposta pra este envio',
    }));
  }

  async imprimir(ids: string[]) {
    const j = (await this.post('/shipment/print', { orders: ids }, 'Impressão da etiqueta')) as {
      url?: string;
    } | null;
    if (!j?.url) {
      throw new IntegrationException(
        'O Melhor Envio não devolveu o link de impressão',
        ErrorCode.INTEGRATION_ERROR,
      );
    }
    return j.url;
  }

  /**
   * Etiqueta sem login (Léo, 14/10): o link do /shipment/print abre o portal do
   * Melhor Envio e cai no login quando o navegador não tem sessão lá (testado
   * no sandbox, até com mode "public"). GET /imprimir/pdf/<id> devolve o link
   * assinado do PDF no S3 (30 min) — 1 id por chamada.
   */
  async pdfs(ids: string[]): Promise<Buffer[]> {
    const arquivos: Buffer[] = [];
    for (const id of ids) {
      const r = await this.fetchFn(
        `${BASE[this.ambiente]}/api/v2/me/imprimir/pdf/${encodeURIComponent(id)}`,
        {
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${this.token}`,
            'User-Agent': `Betinna.ai (${this.emailTecnico || 'sem e-mail'})`,
          },
          signal: AbortSignal.timeout(20_000),
          redirect: 'error',
        },
      );
      const links = r.ok ? ((await r.json().catch(() => null)) as unknown) : null;
      const lista = Array.isArray(links)
        ? links.filter((x): x is string => typeof x === 'string')
        : [];
      if (!lista.length) {
        throw new IntegrationException(
          `PDF da etiqueta: o Melhor Envio respondeu ${r.status} sem o link`,
          ErrorCode.INTEGRATION_ERROR,
        );
      }
      for (const u of lista) {
        if (!linkPdfConfiavel(u)) {
          throw new IntegrationException(
            'PDF da etiqueta: link fora do armazenamento do Melhor Envio',
            ErrorCode.INTEGRATION_ERROR,
          );
        }
        const a = await this.fetchFn(u, { signal: AbortSignal.timeout(30_000), redirect: 'error' });
        const buf = Buffer.from(await a.arrayBuffer());
        if (!a.ok || buf.subarray(0, 4).toString() !== '%PDF') {
          throw new IntegrationException(
            `PDF da etiqueta: o download falhou (${a.status})`,
            ErrorCode.INTEGRATION_ERROR,
          );
        }
        arquivos.push(buf);
      }
    }
    return arquivos;
  }
}

function mensagemDe(json: unknown): string {
  const m = (json as { message?: unknown; error?: unknown } | null)?.message;
  return typeof m === 'string' && m ? ` — ${m.slice(0, 160)}` : '';
}

/**
 * 422 do Melhor Envio: ou vem `errors` por campo, ou só `message` (+ `suggestion`).
 * Sem ler o `message`, a recusa do seguro acima de R$ 1.000 virava "dados
 * inválidos" e ninguém sabia o que mudar (PED-0008, 14/10). PURO.
 */
export function resumoErros(json: unknown): string {
  const j = json as {
    errors?: Record<string, string[]>;
    message?: unknown;
    suggestion?: unknown;
  } | null;
  const porCampo = j?.errors ? Object.values(j.errors).flat().slice(0, 3).join('; ') : '';
  if (porCampo) return porCampo;
  const msg = typeof j?.message === 'string' ? j.message.trim().slice(0, 240) : '';
  const dica = typeof j?.suggestion === 'string' ? j.suggestion.trim().slice(0, 160) : '';
  if (msg) return dica ? `${msg} ${dica}` : msg;
  return 'dados inválidos';
}
