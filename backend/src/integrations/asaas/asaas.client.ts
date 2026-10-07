/**
 * Cliente da API do Asaas (v3) — só o que o checkout da vitrine usa.
 *
 * Fonte: documentação oficial (docs.asaas.com), lida em 07/10/2026:
 *  - sandbox `https://api-sandbox.asaas.com/v3` (chave `$aact_hmlg_…`) e
 *    produção `https://api.asaas.com/v3` (chave `$aact_prod_…`); chave de um
 *    ambiente NÃO funciona no outro;
 *  - autenticação pelo cabeçalho `access_token` (não é Bearer) + User-Agent;
 *  - `GET /finance/balance` valida a chave (401 = inválida);
 *  - `GET /myAccount/fees/` = tabela de taxas da conta;
 *  - `POST/PUT/GET /webhooks` = cadastro do aviso de pagamento, com
 *    `authToken` (32–255, sem espaço) que volta no cabeçalho
 *    `asaas-access-token` de cada evento.
 *
 * A chave é por EMPRESA (conta Asaas da própria empresa) — nunca do ambiente.
 */
import { IntegrationException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';

export type AmbienteAsaas = 'sandbox' | 'producao';

const BASE: Record<AmbienteAsaas, string> = {
  sandbox: 'https://api-sandbox.asaas.com/v3',
  producao: 'https://api.asaas.com/v3',
};

/** O ambiente sai do PREFIXO da chave — não existe chave que sirva nos dois. */
export function ambienteDaChave(chave: string | null | undefined): AmbienteAsaas | null {
  const c = (chave ?? '').trim();
  if (c.startsWith('$aact_hmlg_')) return 'sandbox';
  if (c.startsWith('$aact_prod_')) return 'producao';
  return null;
}

/** Taxas da conta, do jeito que o checkout usa (percentuais em %, valores em R$). */
export interface TaxasAsaas {
  cartao: {
    /** Tarifa fixa por transação de cartão (`operationValue`). */
    fixa: number;
    /** % por faixa de parcelas — já com o desconto promocional se vigente. */
    umaVez: number;
    ateSeis: number;
    ateDoze: number;
  };
  pix: {
    percentual: number | null;
    fixa: number | null;
    minima: number | null;
    maxima: number | null;
  };
}

interface FeesResposta {
  payment?: {
    creditCard?: {
      operationValue?: number;
      oneInstallmentPercentage?: number;
      upToSixInstallmentsPercentage?: number;
      upToTwelveInstallmentsPercentage?: number;
      discountOneInstallmentPercentage?: number | null;
      discountUpToSixInstallmentsPercentage?: number | null;
      discountUpToTwelveInstallmentsPercentage?: number | null;
      discountExpiration?: string | null;
    };
    pix?: {
      fixedFeeValue?: number | null;
      percentageFee?: number | null;
      minimumFeeValue?: number | null;
      maximumFeeValue?: number | null;
    };
  };
}

/**
 * Lê a tabela de taxas. O desconto promocional vale até `discountExpiration`;
 * depois disso, a taxa cheia. Puro (testado) — recebe o "agora".
 */
export function lerTaxas(f: FeesResposta, agora = new Date()): TaxasAsaas {
  const cc = f.payment?.creditCard ?? {};
  const descontoValido =
    !!cc.discountExpiration && new Date(cc.discountExpiration).getTime() > agora.getTime();
  const pct = (cheia?: number, desconto?: number | null) =>
    descontoValido && typeof desconto === 'number' ? desconto : (cheia ?? 0);
  const pix = f.payment?.pix ?? {};
  return {
    cartao: {
      fixa: cc.operationValue ?? 0,
      umaVez: pct(cc.oneInstallmentPercentage, cc.discountOneInstallmentPercentage),
      ateSeis: pct(cc.upToSixInstallmentsPercentage, cc.discountUpToSixInstallmentsPercentage),
      ateDoze: pct(
        cc.upToTwelveInstallmentsPercentage,
        cc.discountUpToTwelveInstallmentsPercentage,
      ),
    },
    pix: {
      percentual: pix.percentageFee ?? null,
      fixa: pix.fixedFeeValue ?? null,
      minima: pix.minimumFeeValue ?? null,
      maxima: pix.maximumFeeValue ?? null,
    },
  };
}

export interface WebhookAsaas {
  id: string;
  url: string;
  enabled: boolean;
  interrupted: boolean;
}

/** Eventos de cobrança que o checkout escuta (CONFIRMED e RECEIVED = pago). */
export const EVENTOS_WEBHOOK = [
  'PAYMENT_CONFIRMED',
  'PAYMENT_RECEIVED',
  'PAYMENT_OVERDUE',
  'PAYMENT_DELETED',
  'PAYMENT_REFUNDED',
  'PAYMENT_PARTIALLY_REFUNDED',
  'PAYMENT_CHARGEBACK_REQUESTED',
  'PAYMENT_RECEIVED_IN_CASH_UNDONE',
] as const;

/**
 * Chamada crua. `fetchFn` injetável pros testes. Erro do Asaas vira
 * IntegrationException com a mensagem dele (`errors[].description`), sem a chave.
 */
export class AsaasClient {
  constructor(
    private readonly chave: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    if (!ambienteDaChave(chave)) {
      throw new IntegrationException(
        'Chave do Asaas inválida — começa com $aact_hmlg_ (sandbox) ou $aact_prod_ (produção)',
        ErrorCode.INTEGRATION_ERROR,
      );
    }
  }

  get ambiente(): AmbienteAsaas {
    return ambienteDaChave(this.chave) as AmbienteAsaas;
  }

  async req<T>(
    metodo: 'GET' | 'POST' | 'PUT' | 'DELETE',
    caminho: string,
    corpo?: unknown,
  ): Promise<T> {
    const r = await this.fetchFn(`${BASE[this.ambiente]}${caminho}`, {
      method: metodo,
      headers: {
        access_token: this.chave,
        'Content-Type': 'application/json',
        'User-Agent': 'Betinna.ai (checkout da vitrine)',
      },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
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
      const erros = (json as { errors?: Array<{ description?: string }> } | null)?.errors ?? [];
      const msg =
        r.status === 401
          ? 'A chave do Asaas foi recusada (inválida, revogada ou de outro ambiente)'
          : erros
              .map((e) => e.description)
              .filter(Boolean)
              .join('; ') || `Asaas respondeu ${r.status}`;
      throw new IntegrationException(msg, ErrorCode.INTEGRATION_ERROR);
    }
    return json as T;
  }

  /** Valida a chave (e devolve o saldo, que não é usado). */
  saldo() {
    return this.req<{ balance: number }>('GET', '/finance/balance');
  }

  async taxas(agora = new Date()): Promise<TaxasAsaas> {
    return lerTaxas(await this.req<FeesResposta>('GET', '/myAccount/fees/'), agora);
  }

  obterWebhook(id: string) {
    return this.req<WebhookAsaas>('GET', `/webhooks/${encodeURIComponent(id)}`);
  }

  /** Cria (sem id) ou atualiza (com id) o aviso de pagamento desta empresa. */
  salvarWebhook(dados: { url: string; authToken: string; email?: string | null }, id?: string) {
    const corpo = {
      name: 'Betinna — pagamentos da vitrine',
      url: dados.url,
      ...(dados.email ? { email: dados.email } : {}),
      enabled: true,
      interrupted: false,
      apiVersion: 3,
      authToken: dados.authToken,
      sendType: 'SEQUENTIALLY',
      events: [...EVENTOS_WEBHOOK],
    };
    return id
      ? this.req<WebhookAsaas>('PUT', `/webhooks/${encodeURIComponent(id)}`, corpo)
      : this.req<WebhookAsaas>('POST', '/webhooks', corpo);
  }

  // ─── Cobrança (entrega 2) ──────────────────────────────────────────────

  async acharCliente(cpfCnpj: string): Promise<ClienteAsaas | null> {
    const r = await this.req<{ data: ClienteAsaas[] }>(
      'GET',
      `/customers?cpfCnpj=${encodeURIComponent(cpfCnpj)}&limit=1`,
    );
    return r.data?.[0] ?? null;
  }

  /** `notificationDisabled`: quem avisa o cliente é a vitrine, não o Asaas. */
  criarCliente(dados: {
    name: string;
    cpfCnpj: string;
    mobilePhone?: string;
    email?: string;
    externalReference?: string;
  }): Promise<ClienteAsaas> {
    return this.req<ClienteAsaas>('POST', '/customers', { ...dados, notificationDisabled: true });
  }

  criarCobranca(dados: {
    customer: string;
    billingType: 'PIX' | 'CREDIT_CARD';
    dueDate: string;
    description: string;
    externalReference: string;
    value?: number;
    installmentCount?: number;
    totalValue?: number;
  }): Promise<CobrancaAsaas> {
    return this.req<CobrancaAsaas>('POST', '/payments', dados);
  }

  obterCobranca(id: string): Promise<CobrancaAsaas> {
    return this.req<CobrancaAsaas>('GET', `/payments/${encodeURIComponent(id)}`);
  }

  pixQrCode(id: string): Promise<PixAsaas> {
    return this.req<PixAsaas>('GET', `/payments/${encodeURIComponent(id)}/pixQrCode`);
  }

  cancelarCobranca(id: string): Promise<{ deleted: boolean; id: string }> {
    return this.req<{ deleted: boolean; id: string }>(
      'DELETE',
      `/payments/${encodeURIComponent(id)}`,
    );
  }
}

// ─── Cobrança (entrega 2) ────────────────────────────────────────────────

export interface OpcaoCartao {
  parcelas: number;
  /** Total cobrado no cartão (centavos). */
  totalC: number;
  /** Valor aproximado de cada parcela (centavos) — o Asaas joga o resto do arredondamento na última. */
  parcelaC: number;
}

/**
 * Opções de cartão (1x a 12x) pela regra do Léo (07/10): à vista = preço da
 * vitrine (a empresa cobre a taxa); parcelado = o cliente paga a taxa do Asaas
 * da faixa, pra empresa receber o valor cheio: cobrado = (total + tarifa fixa)
 * ÷ (1 − %), arredondado pra CIMA no centavo. PURO (testado).
 */
export function opcoesCartao(totalC: number, taxas: TaxasAsaas, max = 12): OpcaoCartao[] {
  const out: OpcaoCartao[] = [{ parcelas: 1, totalC, parcelaC: totalC }];
  const fixaC = Math.round(taxas.cartao.fixa * 100);
  for (let n = 2; n <= max; n++) {
    const pct = (n <= 6 ? taxas.cartao.ateSeis : taxas.cartao.ateDoze) / 100;
    const cobradoC = Math.ceil((totalC + fixaC) / (1 - pct));
    out.push({ parcelas: n, totalC: cobradoC, parcelaC: Math.ceil(cobradoC / n) });
  }
  return out;
}

export interface ClienteAsaas {
  id: string;
  name: string;
  cpfCnpj: string | null;
}

export interface CobrancaAsaas {
  id: string;
  status: string;
  value: number;
  netValue?: number;
  billingType: string;
  invoiceUrl: string;
  installment?: string | null;
  externalReference?: string | null;
}

export interface PixAsaas {
  encodedImage: string;
  payload: string;
  expirationDate: string;
}
