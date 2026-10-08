import { IntegrationException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AmbienteFrete, OpcaoCotada } from '@modules/vitrine/frete';

/**
 * Melhor Envio — só a COTAÇÃO (POST /api/v2/me/shipment/calculate).
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

function resumoErros(json: unknown): string {
  const erros = (json as { errors?: Record<string, string[]> } | null)?.errors;
  if (!erros) return 'dados inválidos';
  return Object.values(erros).flat().slice(0, 3).join('; ') || 'dados inválidos';
}
