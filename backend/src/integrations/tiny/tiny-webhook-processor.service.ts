import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { RedisService } from '@database/redis.service';
import { TINY_FILA_PENDENTES } from './tiny-webhook.controller';
import { TinyProdutosSyncService } from './tiny-produtos-sync.service';

/** Quem aplica pedido: o serviço vive no módulo de pedidos (regra de negócio). */
export interface AplicadorDePedido {
  sincronizarUm(
    empresaId: string,
    idTiny: number,
  ): Promise<'criado' | 'atualizado' | 'semMudanca' | 'foraDaJanela'>;
}

interface EventoNaFila {
  tipo: string;
  hash: string;
  recebidoEm: string;
  payload: string;
}

interface PayloadTiny {
  versao?: string;
  /** É o que diz DE QUAL CONTA o evento veio — a URL é a mesma pra todos. */
  cnpj?: string;
  tipo?: string;
  dados?: Record<string, unknown>;
}

export interface ResultadoProcessamento {
  lidos: number;
  aplicados: number;
  repetidos: number;
  ignorados: number;
  erros: number;
}

/** Quantos eventos por rodada — a fila é capada em 500 e a rodada é de 1 min. */
const LOTE = 50;
/** Janela de deduplicação: o Tiny retenta o mesmo evento até 10 vezes. */
const TTL_DEDUP_S = 24 * 60 * 60;

/**
 * Processa os webhooks do Tiny que estavam só empilhando no Redis.
 *
 * O receptor sempre respondeu 200 e guardou o evento cru (o painel do Tiny
 * valida a URL antes de deixar salvar, então o endpoint nasceu antes do
 * processamento). Isto aqui é a outra metade: tirar da fila e aplicar.
 *
 * **O payload é DICA, não verdade.** O Tiny não assina webhook — não há HMAC
 * nem header de autenticação, só o segredo na URL, que protege contra tráfego
 * aleatório e não contra quem conheça a URL. Então nada do corpo vira estado:
 * pegamos o ID e reconsultamos o recurso na API v3 antes de mudar qualquer
 * coisa. (É também por isso que o evento de estoque não é aplicado direto: o
 * `saldo` que ele manda nem é o número que a tela usa — o que vale é o
 * `disponivel`, saldo menos reservado.)
 *
 * **O CNPJ do payload é o que roteia o tenant.** A URL do webhook é a mesma pra
 * todas as empresas (o segredo é do app, não da conta), então sem casar o CNPJ
 * um evento da empresa A poderia mexer nos dados da B. Não achou empresa: o
 * evento é descartado com log, não aplicado "na que estiver conectada".
 *
 * **Deduplicação pelo hash do corpo.** O Tiny retenta até 10 vezes quando não
 * recebe 200 — e um 200 que se perde na rede também vira retentativa. Aplicar
 * duas vezes é barato aqui (a aplicação é idempotente), mas o log ficaria
 * mentindo sobre o que aconteceu.
 */
@Injectable()
export class TinyWebhookProcessorService {
  private readonly logger = new Logger(TinyWebhookProcessorService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly produtos: TinyProdutosSyncService,
  ) {}

  /**
   * Quem aplica pedido vem por PARÂMETRO, não por injeção.
   *
   * A regra de pedido mora no módulo de pedidos, que já importa este módulo —
   * injetar de volta fecharia um ciclo. Passar na chamada mantém a dependência
   * numa direção só e deixa o teste trivial.
   */
  async processarPendentes(aplicadorDePedido: AplicadorDePedido): Promise<ResultadoProcessamento> {
    const r: ResultadoProcessamento = {
      lidos: 0,
      aplicados: 0,
      repetidos: 0,
      ignorados: 0,
      erros: 0,
    };
    const crus = await this.redis.rpop(TINY_FILA_PENDENTES, LOTE).catch(() => []);
    if (crus.length === 0) return r;
    r.lidos = crus.length;

    for (const cru of crus) {
      try {
        const evento = JSON.parse(cru) as EventoNaFila;
        const novo = await this.redis
          .setNxEx(`tiny:webhook:visto:${evento.hash}`, '1', TTL_DEDUP_S)
          .catch(() => true);
        if (!novo) {
          r.repetidos += 1;
          continue;
        }
        const aplicou = await this.aplicar(evento, aplicadorDePedido);
        if (aplicou) r.aplicados += 1;
        else r.ignorados += 1;
      } catch (err) {
        // Um evento problemático não pode segurar o lote. Ele já saiu da fila:
        // reprocessar viria pela rodada diária, que é a rede de baixo.
        r.erros += 1;
        this.logger.warn(
          `[tiny] evento descartado por erro: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    this.logger.log(
      `[tiny] webhooks: ${r.lidos} lidos, ${r.aplicados} aplicados, ` +
        `${r.repetidos} repetidos, ${r.ignorados} ignorados, ${r.erros} erros`,
    );
    return r;
  }

  private async aplicar(
    evento: EventoNaFila,
    aplicadorDePedido: AplicadorDePedido,
  ): Promise<boolean> {
    const payload = JSON.parse(evento.payload) as PayloadTiny;
    const empresaId = await this.empresaDoEvento(payload);
    if (!empresaId) {
      this.logger.warn(
        `[tiny] webhook ${evento.tipo} de CNPJ ${payload.cnpj ?? '?'} sem empresa correspondente — ignorado`,
      );
      return false;
    }

    // `tipo` do corpo manda; o da URL é fallback (o painel permite apontar
    // qualquer evento pra qualquer URL, e o corpo é quem sabe o que aconteceu).
    const tipo = (payload.tipo ?? evento.tipo).toLowerCase();
    const dados = payload.dados ?? {};

    if (tipo.includes('pedido') || tipo.includes('rastreio') || tipo.includes('nota')) {
      const id = Number(dados.id ?? dados.idPedido ?? dados.idVenda);
      if (!Number.isFinite(id) || id <= 0) return false;
      const efeito = await aplicadorDePedido.sincronizarUm(empresaId, id);
      this.logger.log(`[tiny] webhook ${tipo}: pedido ${id} → ${efeito}`);
      return efeito !== 'foraDaJanela';
    }

    if (tipo.includes('estoque') || tipo.includes('produto')) {
      const id = Number(dados.idProduto ?? dados.id);
      if (!Number.isFinite(id) || id <= 0) return false;
      const ok = await this.produtos.sincronizarUm(empresaId, id);
      this.logger.log(
        `[tiny] webhook ${tipo}: produto ${id} → ${ok ? 'atualizado' : 'não achado'}`,
      );
      return ok;
    }

    // Tipo que ainda não tem destino no app (ex.: nota fiscal isolada). Ignorar
    // é a resposta certa — inventar efeito seria pior —, mas com log: evento
    // sumindo calado é como a integração passa a mentir.
    this.logger.log(`[tiny] webhook ${tipo} sem tratamento no app — ignorado`);
    return false;
  }

  /**
   * Acha o tenant pelo CNPJ do payload.
   *
   * Sem CNPJ (evento antigo ou versão nova do Tiny), cai pra ÚNICA conexão
   * ativa — e só quando é uma só. Com duas empresas conectadas, adivinhar seria
   * mexer nos dados da errada.
   */
  private async empresaDoEvento(payload: PayloadTiny): Promise<string | null> {
    const cnpj = (payload.cnpj ?? '').replace(/\D/g, '');
    if (cnpj) {
      const empresas = await this.prisma.empresa.findMany({ select: { id: true, cnpj: true } });
      const alvo = empresas.find((e) => (e.cnpj ?? '').replace(/\D/g, '') === cnpj);
      if (alvo) return alvo.id;
      return null;
    }
    const conexoes = await this.prisma.integracaoConexao.findMany({
      where: { servico: 'tiny', ativo: true },
      select: { empresaId: true },
      take: 2,
    });
    return conexoes.length === 1 ? conexoes[0].empresaId : null;
  }
}
