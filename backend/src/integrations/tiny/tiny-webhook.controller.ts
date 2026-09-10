import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  Req,
  Res,
  type RawBodyRequest,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Throttle, seconds } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { EnvService } from '@config/env.service';
import { TinyMapeamentoService } from './tiny-mapeamento.service';
import { RedisService } from '@database/redis.service';
import { Public } from '@shared/decorators/public.decorator';
import { NotFoundException, UnauthorizedException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';

/**
 * Os eventos que o painel do Tiny oferece, um por campo de URL.
 *
 * `produto` e `preco` entraram com o cadastro de e-commerce ("Outra
 * Integração"), que pede cinco URLs. Evento fora desta lista dá 404 — e como o
 * painel TESTA a URL antes de salvar, faltar um nome aqui não vira bug sutil:
 * vira "não foi possível acessar a URL" na cara de quem está cadastrando.
 */
const EVENTOS = ['pedido', 'rastreio', 'estoque', 'nota', 'produto', 'preco'] as const;
type Evento = (typeof EVENTOS)[number];

/** Fila de eventos crus, pra o processamento (item 7) poder reprocessar. */
export const TINY_FILA_PENDENTES = 'tiny:webhook:pendentes';
const FILA_MAX = 500;

/**
 * Marca de chegada, POR EVENTO e SEM TTL.
 *
 * Existe pra responder uma pergunta que já custou tempo a duas sessões: **este
 * webhook algum dia chegou?** A fila é drenada (some), o dedup expira, e o log
 * do Railway é por deploy — num dia de vários deploys a janela vira minutos.
 * Sem uma marca durável, "não achei" e "nunca chegou" ficam indistinguíveis, e
 * a conclusão errada é cara: leva a mexer no app quando o que falta é o
 * cadastro no painel do ERP (que a API v3 não expõe — 0 das 202 operações
 * mexem em webhook, conferido em `docs/tiny/openapi.json`).
 *
 * Duas chaves, não uma: o total distingue "chegou uma vez no teste" de "chega
 * todo dia", e o carimbo diz se parou de chegar.
 */
const marcaUltimo = (tipo: Evento) => `tiny:webhook:ultimo:${tipo}`;
const marcaTotal = (tipo: Evento) => `tiny:webhook:total:${tipo}`;

/**
 * Marca de RECUSA — a outra metade da pergunta, e sem ela o diagnóstico empata.
 *
 * O contador de chegada só conta o que PASSA da guarda. Então `recebidos: 0`
 * não distingue duas coisas opostas:
 *
 *   o ERP não tentou              → o problema está no painel dele
 *   tentou e tomou 401/404        → o problema é segredo ou nome de evento
 *
 * O log de HTTP do Railway mostraria a recusa, mas é POR DEPLOY: em 10/09 a
 * janela era de 2 minutos quando a pergunta apareceu, e a resposta histórica
 * simplesmente não existia. Foi o que travou a investigação do card dos seis
 * zeros — medir ausência dos dois lados e não poder cruzar.
 *
 * Contador durável fecha isso: uma chamada ao GET passa a responder
 * "não tentou" ou "tentou e foi barrado", pra sempre.
 */
const marcaRecusa = (motivo: 'segredo' | 'evento') => `tiny:webhook:recusado:${motivo}`;
const marcaRecusaUltimo = (motivo: 'segredo' | 'evento') =>
  `tiny:webhook:recusado:${motivo}:ultimo`;

/** Registra sem `await` e sem poder falhar: contador não atrasa nem derruba resposta. */
function registrar(
  redis: { incr(k: string): Promise<number>; set(k: string, v: string): Promise<void> },
  chaveTotal: string,
  chaveUltimo: string,
): void {
  void Promise.all([
    redis.incr(chaveTotal),
    redis.set(chaveUltimo, new Date().toISOString()),
  ]).catch(() => undefined);
}

/**
 * Receptor dos webhooks do Tiny (Olist).
 *
 * **Por que o segredo vai no CAMINHO da URL.** O Tiny não assina os webhooks:
 * não manda HMAC nem header de autenticação (é a exceção ao D11, que vale pra
 * Meta/Shopee/TikTok). Sobra o que o painel deixa configurar — a própria
 * URL. Por isso ela carrega um segredo longo, comparado em tempo constante.
 *
 * **E por que isso NÃO basta.** URL secreta protege contra tráfego aleatório,
 * não contra alguém que a conheça. Então o payload é tratado como DICA, nunca
 * como verdade: quem processa vai reconsultar o pedido/produto na API v3 antes
 * de mudar qualquer coisa. É a mesma escolha que o webhook do ERP já fazia
 * ("preferimos pull do estado real em vez de confiar nos valores do evento"),
 * aqui por necessidade e não por preferência.
 *
 * **ACK primeiro, aplica depois.** O evento entra numa lista capada no Redis e
 * o `TinyWebhookProcessorService` drena de minuto em minuto. Responder rápido
 * é obrigação: o Tiny retenta 10x quando não recebe 200 e depois desiste — e
 * processar dentro do request faria o timeout dele virar evento perdido.
 *
 * Este endpoint existe agora por um motivo concreto: o painel do Tiny **valida
 * a URL antes de salvar** ("Não foi possível acessar a URL"), então sem um 200
 * respondendo não dá nem pra cadastrar o webhook.
 */
@ApiTags('webhooks/tiny')
@Controller('webhooks/tiny/:segredo/:evento')
// 200 req/min por IP: o Tiny retenta até 10x por evento e uma rajada de
// atualização de estoque pode disparar vários de uma vez.
@Throttle({ default: { limit: 200, ttl: seconds(60) } })
export class TinyWebhookController {
  private readonly logger = new Logger(TinyWebhookController.name);

  constructor(
    private readonly env: EnvService,
    private readonly redis: RedisService,
    private readonly mapeamento: TinyMapeamentoService,
  ) {}

  /**
   * Compara o segredo da URL em tempo constante.
   *
   * Sem `TINY_WEBHOOK_SECRET` configurado, aceita com warning — mesmo tratamento
   * que o webhook do ERP dá em dev. É o que permite cadastrar a URL no painel
   * antes de a env existir; assim que ela existe, passa a valer.
   */
  private validarSegredo(segredo: string): void {
    const esperado = this.env.get('TINY_WEBHOOK_SECRET');
    if (!esperado) {
      this.logger.warn('TINY_WEBHOOK_SECRET ausente — webhook aceito SEM validação de segredo');
      return;
    }
    const a = Buffer.from(segredo);
    const b = Buffer.from(esperado);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      this.logger.warn('Webhook Tiny com segredo inválido na URL — descartado');
      registrar(this.redis, marcaRecusa('segredo'), marcaRecusaUltimo('segredo'));
      throw new UnauthorizedException('segredo inválido', ErrorCode.AUTH_INVALID_TOKEN);
    }
  }

  private validarEvento(evento: string): Evento {
    if (!(EVENTOS as readonly string[]).includes(evento)) {
      // 404 de propósito: erro de digitação no painel aparece como "não foi
      // possível acessar a URL" na hora de salvar, em vez de virar um endpoint
      // que aceita tudo calado e nunca entrega nada.
      registrar(this.redis, marcaRecusa('evento'), marcaRecusaUltimo('evento'));
      throw new NotFoundException(`evento desconhecido: ${evento}`, ErrorCode.NOT_FOUND);
    }
    return evento as Evento;
  }

  /**
   * O painel do Tiny testa a URL antes de salvar. Responder 200 aqui é o que
   * destrava o cadastro — e de quebra dá um jeito de conferir a URL pelo
   * navegador depois.
   *
   * A resposta também diz **se este evento já chegou alguma vez** e **se alguma
   * tentativa foi barrada**. Abrir a mesma URL do painel no navegador passa a
   * ser o diagnóstico inteiro, e é o cruzamento que dá a resposta:
   *
   *   401                                → o segredo que VOCÊ colou está errado
   *   404                                → o nome do evento está errado
   *   recebidos > 0                      → está chegando e sendo processado
   *   recebidos: 0, recusados: 0         → o ERP NUNCA POSTOU — é o painel dele
   *   recebidos: 0, recusados.segredo>0  → o ERP posta, com o segredo VELHO
   *   recebidos: 0, recusados.evento>0   → o ERP posta, com nome de evento errado
   *
   * Sem a linha das recusas, os dois primeiros zeros ficavam indistinguíveis —
   * e foi exatamente isso que travou a investigação dos seis zeros em 10/09.
   */
  @Public()
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verificação de alcance da URL (o painel do Tiny testa antes de salvar)',
  })
  async verificar(
    @Param('segredo') segredo: string,
    @Param('evento') evento: string,
  ): Promise<{
    ok: boolean;
    evento: Evento;
    recebidos: number;
    ultimoEm: string | null;
    recusados: { segredo: number; evento: number; ultimoEm: string | null };
  }> {
    this.validarSegredo(segredo);
    const tipo = this.validarEvento(evento);

    // Redis fora não pode derrubar a verificação: o que o painel do Tiny
    // precisa é do 200. O diagnóstico é o extra, e degrada pra "não sei".
    const nao = () => null;
    const [total, ultimo, recSeg, recEvt, recSegEm, recEvtEm] = await Promise.all([
      this.redis.get(marcaTotal(tipo)).catch(nao),
      this.redis.get(marcaUltimo(tipo)).catch(nao),
      this.redis.get(marcaRecusa('segredo')).catch(nao),
      this.redis.get(marcaRecusa('evento')).catch(nao),
      this.redis.get(marcaRecusaUltimo('segredo')).catch(nao),
      this.redis.get(marcaRecusaUltimo('evento')).catch(nao),
    ]);

    // As recusas NÃO são por evento: uma requisição barrada no segredo nunca
    // chega a ter evento válido, e o 404 barra justamente o nome. Contá-las
    // globalmente é o que faz elas responderem "o ERP tentou?".
    const maisRecente = [recSegEm, recEvtEm].filter(Boolean).sort().pop() ?? null;

    return {
      ok: true,
      evento: tipo,
      recebidos: Number(total ?? 0),
      ultimoEm: ultimo,
      recusados: {
        segredo: Number(recSeg ?? 0),
        evento: Number(recEvt ?? 0),
        ultimoEm: maisRecente,
      },
    };
  }

  @Public()
  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Recebe evento do Tiny (vendas, envios, estoque, notas fiscais)' })
  async receber(
    @Param('segredo') segredo: string,
    @Param('evento') evento: string,
    @Req() req: RawBodyRequest<Request>,
    // Resposta escrita à mão de propósito: o `ResponseInterceptor` envelopa
    // tudo em `{ success, data, meta }`, e o ERP espera o corpo CRU do
    // contrato dele. Envelopado, o mapeamento de produto não seria lido.
    @Res() res: Response,
  ): Promise<void> {
    this.validarSegredo(segredo);
    const tipo = this.validarEvento(evento);

    // Guarda o corpo CRU. O hash serve pra deduplicar retentativa: o Tiny manda
    // o mesmo evento até 10 vezes quando não recebe 200, e quem processar não
    // pode aplicar o mesmo fato duas vezes.
    const bruto = req.rawBody?.toString('utf8') ?? JSON.stringify(req.body ?? {});
    const hash = createHash('sha256').update(bruto).digest('hex');

    // Marca de chegada ANTES da fila, e sem `await` no caminho crítico: mesmo
    // que o enfileiramento falhe, fica registrado que o ERP postou aqui — que
    // é justamente o que separa "app com problema" de "cadastro faltando".
    registrar(this.redis, marcaTotal(tipo), marcaUltimo(tipo));

    await this.redis
      .lpushCapped(
        TINY_FILA_PENDENTES,
        JSON.stringify({ tipo, hash, recebidoEm: new Date().toISOString(), payload: bruto }),
        FILA_MAX,
      )
      .catch((err: unknown) => {
        // Redis fora não pode virar erro pro Tiny: se respondermos != 200 ele
        // retenta 10x e depois desiste. Melhor logar alto e dar o ack.
        this.logger.error(
          `Falha ao enfileirar webhook Tiny ${tipo}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });

    this.logger.debug(
      `[tiny] webhook ${tipo} recebido (${bruto.length} bytes, hash ${hash.slice(0, 12)})`,
    );

    // `produto` não é aviso, é PERGUNTA: "este produto meu, como a sua loja
    // chama?". Responder só `ok` faz o ERP marcar "Produto não mapeado pelo
    // integrador" — e sem mapeamento o produto não entra na lista do canal,
    // que é onde a cotação de frete procura o item.
    if (tipo === 'produto') {
      res.status(HttpStatus.OK).json(await this.mapeamento.responder(bruto));
      return;
    }

    res.status(HttpStatus.OK).json({ ok: true });
  }
}
