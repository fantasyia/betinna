import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { RedisService } from '@database/redis.service';
import { FILA_MAX, TINY_FILA_PENDENTES } from './tiny-webhook.controller';
import { TinyProdutosSyncService } from './tiny-produtos-sync.service';

/** Quem aplica pedido: o serviço vive no módulo de pedidos (regra de negócio). */
export interface AplicadorDePedido {
  sincronizarUm(
    empresaId: string,
    idTiny: number,
  ): Promise<'criado' | 'atualizado' | 'semMudanca' | 'foraDaJanela' | 'jaCancelado'>;
}

interface EventoNaFila {
  tipo: string;
  hash: string;
  recebidoEm: string;
  payload: string;
  /** Quantas vezes já falhou em `aplicar` e voltou pra fila (I-B). */
  tentativas?: number;
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
  /** Falharam em `aplicar` e voltaram pra fila pra próxima rodada. */
  reenfileirados: number;
  /** Esgotaram as tentativas e foram pra `tiny:webhook:mortos`. */
  mortos: number;
}

/** Quantos eventos por rodada — a fila é capada em 500 e a rodada é de 1 min. */
const LOTE = 50;
/** Janela de deduplicação: o Tiny retenta o mesmo evento até 10 vezes. */
const TTL_DEDUP_S = 24 * 60 * 60;
/**
 * Quantas vezes um evento que ESTOURA em `aplicar` volta pra fila antes de
 * ir pros mortos (auditoria 13/09, I-B). Uma rodada por minuto → ~5 min de
 * tolerância a soluço da API do Tiny/banco. Erro determinístico (payload que
 * a gente não sabe ler) não fica em loop: cai nos mortos e para de custar.
 */
const MAX_TENTATIVAS = 5;
/** Eventos que esgotaram as tentativas — ficam pra inspeção, capado. */
export const TINY_FILA_MORTOS = 'tiny:webhook:mortos';
const MORTOS_MAX = 200;

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
      reenfileirados: 0,
      mortos: 0,
    };
    const crus = await this.redis.rpop(TINY_FILA_PENDENTES, LOTE).catch(() => []);
    if (crus.length === 0) return r;
    r.lidos = crus.length;

    for (const cru of crus) {
      let evento: EventoNaFila | null = null;
      try {
        evento = JSON.parse(cru) as EventoNaFila;
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
        // Um evento problemático não pode segurar o lote — mas também não pode
        // sumir: o rpop já tirou ele da fila e o dedup já marcou "visto", então
        // sem isto aqui um soluço do banco na hora de aplicar consumia o
        // evento pra sempre (auditoria 13/09, I-B) e o pedido só chegava no
        // sync diário. Volta pra fila com contador; esgotou → mortos.
        r.erros += 1;
        const destino = await this.reenfileirar(evento, err);
        if (destino === 'fila') r.reenfileirados += 1;
        else if (destino === 'mortos') r.mortos += 1;
      }
    }

    this.logger.log(
      `[tiny] webhooks: ${r.lidos} lidos, ${r.aplicados} aplicados, ` +
        `${r.repetidos} repetidos, ${r.ignorados} ignorados, ${r.erros} erros` +
        (r.reenfileirados ? `, ${r.reenfileirados} reenfileirados` : '') +
        (r.mortos ? `, ${r.mortos} mortos` : ''),
    );
    return r;
  }

  /**
   * Devolve o evento pra fila (com `tentativas` + 1) ou, esgotadas as
   * tentativas, pra `tiny:webhook:mortos`. JSON ilegível (`evento` null) não
   * tem o que reprocessar — é descartado com log, como sempre foi.
   *
   * A chave de dedup é apagada ANTES de reenfileirar: sem isso a rodada
   * seguinte diria "repetido" e o evento morreria do mesmo jeito, só que
   * mais devagar.
   */
  private async reenfileirar(
    evento: EventoNaFila | null,
    err: unknown,
  ): Promise<'fila' | 'mortos' | 'descartado'> {
    const msg = err instanceof Error ? err.message : String(err);
    if (!evento) {
      this.logger.warn(`[tiny] evento ilegível descartado: ${msg}`);
      return 'descartado';
    }
    const tentativas = (evento.tentativas ?? 0) + 1;
    try {
      if (tentativas >= MAX_TENTATIVAS) {
        this.logger.error(
          `[tiny] webhook ${evento.tipo} (hash ${evento.hash}) esgotou ${tentativas} tentativas — ` +
            `movido pra ${TINY_FILA_MORTOS}: ${msg}`,
        );
        await this.redis.lpushCapped(
          TINY_FILA_MORTOS,
          JSON.stringify({ ...evento, tentativas, erro: msg.slice(0, 500) }),
          MORTOS_MAX,
        );
        return 'mortos';
      }
      await this.redis.del(`tiny:webhook:visto:${evento.hash}`);
      await this.redis.lpushCapped(
        TINY_FILA_PENDENTES,
        JSON.stringify({ ...evento, tentativas }),
        FILA_MAX,
      );
      this.logger.warn(
        `[tiny] webhook ${evento.tipo} (hash ${evento.hash}) falhou (${tentativas}/${MAX_TENTATIVAS}), ` +
          `volta pra fila: ${msg}`,
      );
      return 'fila';
    } catch (e2) {
      // Redis fora no meio do reprocesso: o evento se perde como antes. Log
      // diz isso em vez de fingir que reenfileirou.
      this.logger.error(
        `[tiny] não consegui reenfileirar o webhook ${evento.tipo} (hash ${evento.hash}): ` +
          `${e2 instanceof Error ? e2.message : String(e2)} — erro original: ${msg}`,
      );
      return 'descartado';
    }
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
      // Descarte SILENCIOSO era o buraco: o drain contava "1 ignorado" e não
      // dizia por quê. Medido em 10/09, na primeira chegada real de webhook —
      // eu não conseguia distinguir "o painel testou a URL com corpo vazio" de
      // "evento real que a gente não soube ler", e as duas coisas pedem ações
      // opostas. Mesma família do `default: false` do operador de condição:
      // toda saída sem log é uma pergunta que ninguém vai poder responder.
      if (!Number.isFinite(id) || id <= 0) {
        this.logger.warn(
          `[tiny] webhook ${tipo} sem id de pedido utilizável — descartado. ` +
            `Corpo: ${evento.payload.slice(0, 200)}`,
        );
        return false;
      }
      const efeito = await aplicadorDePedido.sincronizarUm(empresaId, id);
      this.logger.log(`[tiny] webhook ${tipo}: pedido ${id} → ${efeito}`);
      // "Não aplicado" aqui não é falha: pedido velho demais, ou que já chega
      // cancelado do ERP, não vira registro novo — e o log diz qual dos dois.
      return efeito !== 'foraDaJanela' && efeito !== 'jaCancelado';
    }

    // Preço entra aqui junto com estoque e produto: os três significam "este
    // produto mudou", e a resposta é a mesma — reconsultar o produto na API e
    // regravar. Confiar no valor do payload seria confiar num webhook que não
    // vem assinado.
    if (tipo.includes('estoque') || tipo.includes('produto') || tipo.includes('preco')) {
      const id = Number(dados.idProduto ?? dados.id);
      // Ver o descarte acima: sem log, "ignorado" não distingue teste de painel
      // de evento real ilegível.
      if (!Number.isFinite(id) || id <= 0) {
        this.logger.warn(
          `[tiny] webhook ${tipo} sem id de produto utilizável — descartado. ` +
            `Corpo: ${evento.payload.slice(0, 200)}`,
        );
        return false;
      }
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
