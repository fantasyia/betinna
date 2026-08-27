import { Injectable, Logger } from '@nestjs/common';
import { TinyClientService } from './tiny-client.service';

interface ListaTiny<T> {
  itens?: T[];
  paginacao?: { limit: number; offset: number; total: number };
}

interface DepositoTiny {
  id: number;
  nome?: string;
  desconsiderar?: boolean;
  padrao?: boolean;
}
interface VendedorTiny {
  id: number;
  nome?: string;
  situacao?: string;
}
interface FormaEnvioTiny {
  id: number;
  nome?: string;
}
interface ProdutoResumo {
  id: number;
  sku?: string;
  descricao?: string;
  situacao?: string;
  precos?: { preco?: number; precoCusto?: number };
}

/**
 * Raio-X da conta do Tiny — o que existe cadastrado lá.
 *
 * Existe por uma necessidade concreta do setup: `POST /pedidos` exige
 * `deposito.id` e `vendedor.id`, e esses números não estão em lugar nenhum do
 * painel de forma óbvia. Em vez de pedir pro diretor caçar e transcrever (com o
 * risco de vir o id errado e o pedido nascer no depósito errado), a própria API
 * responde.
 *
 * Serve também de teste de fumaça da integração: se isto responde, o OAuth, o
 * refresh e o cliente HTTP estão de pé de ponta a ponta.
 */
@Injectable()
export class TinyContaService {
  private readonly logger = new Logger(TinyContaService.name);

  constructor(private readonly client: TinyClientService) {}

  async raioX(empresaId: string): Promise<{
    depositos: Array<{ id: number; nome: string; padrao: boolean }>;
    vendedores: Array<{ id: number; nome: string; situacao: string | null }>;
    formasEnvio: Array<{ id: number; nome: string }>;
    /** Resposta CRUA de vendedores/depósitos. O mapeamento por nome de campo
     *  já enganou uma vez (nome vindo vazio) — com o cru dá pra ver a chave
     *  real em vez de adivinhar. */
    cru?: { vendedores: unknown[]; depositos: unknown[]; tiposContato: unknown[] };
    produtos: {
      total: number;
      amostra: Array<{
        id: number;
        sku: string;
        nome: string;
        preco: number | null;
        custo: number | null;
      }>;
    };
  }> {
    // Em paralelo: são quatro leituras independentes e o rate limit do Tiny é
    // por minuto, não por rajada.
    const [depositos, vendedores, formasEnvio, produtos, tipos] = await Promise.all([
      this.client
        .get<ListaTiny<DepositoTiny>>(empresaId, '/depositos')
        .catch((e: unknown) => this.vazio<DepositoTiny>('depositos', e)),
      this.client
        .get<ListaTiny<VendedorTiny>>(empresaId, '/vendedores')
        .catch((e: unknown) => this.vazio<VendedorTiny>('vendedores', e)),
      this.client
        .get<ListaTiny<FormaEnvioTiny>>(empresaId, '/formas-envio')
        .catch((e: unknown) => this.vazio<FormaEnvioTiny>('formas-envio', e)),
      this.client
        .get<ListaTiny<ProdutoResumo>>(empresaId, '/produtos', { situacao: 'A', limit: 10 })
        .catch((e: unknown) => this.vazio<ProdutoResumo>('produtos', e)),
      // Tipos de contato: é aqui que se descobre se "Vendedor" é um TIPO de
      // contato — o que decidiria se dá pra criar vendedor pela API.
      this.client
        .get<ListaTiny<Record<string, unknown>>>(empresaId, '/contatos/tipos')
        .catch((e: unknown) => this.vazio<Record<string, unknown>>('contatos/tipos', e)),
    ]);

    return {
      cru: {
        vendedores: vendedores.itens ?? [],
        depositos: depositos.itens ?? [],
        tiposContato: tipos.itens ?? [],
      },
      depositos: (depositos.itens ?? []).map((d) => ({
        id: d.id,
        nome: d.nome ?? '',
        padrao: d.padrao === true,
      })),
      vendedores: (vendedores.itens ?? []).map((v) => ({
        id: v.id,
        nome: v.nome ?? '',
        situacao: v.situacao ?? null,
      })),
      formasEnvio: (formasEnvio.itens ?? []).map((f) => ({ id: f.id, nome: f.nome ?? '' })),
      produtos: {
        // O total vem da paginação, não do tamanho da amostra — pedimos 10 itens
        // só pra conferir SKU e custo, mas quem conta é o Tiny.
        total: produtos.paginacao?.total ?? produtos.itens?.length ?? 0,
        amostra: (produtos.itens ?? []).map((p) => ({
          id: p.id,
          sku: p.sku ?? '',
          nome: p.descricao ?? '',
          preco: p.precos?.preco ?? null,
          custo: p.precos?.precoCusto ?? null,
        })),
      },
    };
  }

  /**
   * Uma leitura que falha não pode derrubar as outras três: o raio-X é
   * diagnóstico, e diagnóstico parcial vale mais que erro total — inclusive
   * porque "vendedores falhou" já é, em si, uma informação de permissão.
   */
  private vazio<T>(recurso: string, err: unknown): ListaTiny<T> {
    this.logger.warn(
      `[tiny] raio-X: ${recurso} falhou — ${err instanceof Error ? err.message : String(err)}`,
    );
    return { itens: [] };
  }
}
