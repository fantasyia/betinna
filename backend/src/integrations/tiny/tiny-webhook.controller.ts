import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Throttle, seconds } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { EnvService } from '@config/env.service';
import { RedisService } from '@database/redis.service';
import { Public } from '@shared/decorators/public.decorator';
import { NotFoundException, UnauthorizedException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';

/** Os quatro eventos que o painel do Tiny oferece, um por toggle. */
const EVENTOS = ['pedido', 'rastreio', 'estoque', 'nota'] as const;
type Evento = (typeof EVENTOS)[number];

/** Fila de eventos crus, pra o processamento (item 7) poder reprocessar. */
export const TINY_FILA_PENDENTES = 'tiny:webhook:pendentes';
const FILA_MAX = 500;

/**
 * Receptor dos webhooks do Tiny (Olist).
 *
 * **Por que o segredo vai no CAMINHO da URL.** O Tiny não assina os webhooks:
 * não manda HMAC nem header de autenticação (é a exceção ao D11, que vale pra
 * OMIE/Meta/Shopee/TikTok). Sobra o que o painel deixa configurar — a própria
 * URL. Por isso ela carrega um segredo longo, comparado em tempo constante.
 *
 * **E por que isso NÃO basta.** URL secreta protege contra tráfego aleatório,
 * não contra alguém que a conheça. Então o payload é tratado como DICA, nunca
 * como verdade: quem processa vai reconsultar o pedido/produto na API v3 antes
 * de mudar qualquer coisa. É a mesma escolha que o webhook do OMIE já fazia
 * ("preferimos pull do estado real em vez de confiar nos valores do evento"),
 * aqui por necessidade e não por preferência.
 *
 * **Estado atual: ACK + fila.** O processamento entra junto com o cliente da
 * API v3 (item 7 do plano em `docs/erp-tiny-olist.md`). Até lá o evento é
 * gravado numa lista capada no Redis em vez de descartado — assim um pedido de
 * teste que o Léo criar antes disso não vira evento perdido, e o processamento
 * nasce com histórico pra reprocessar.
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
  ) {}

  /**
   * Compara o segredo da URL em tempo constante.
   *
   * Sem `TINY_WEBHOOK_SECRET` configurado, aceita com warning — mesmo tratamento
   * que o webhook do OMIE dá em dev. É o que permite cadastrar a URL no painel
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
      throw new UnauthorizedException('segredo inválido', ErrorCode.AUTH_INVALID_TOKEN);
    }
  }

  private validarEvento(evento: string): Evento {
    if (!(EVENTOS as readonly string[]).includes(evento)) {
      // 404 de propósito: erro de digitação no painel aparece como "não foi
      // possível acessar a URL" na hora de salvar, em vez de virar um endpoint
      // que aceita tudo calado e nunca entrega nada.
      throw new NotFoundException(`evento desconhecido: ${evento}`, ErrorCode.NOT_FOUND);
    }
    return evento as Evento;
  }

  /**
   * O painel do Tiny testa a URL antes de salvar. Responder 200 aqui é o que
   * destrava o cadastro — e de quebra dá um jeito de conferir a URL pelo
   * navegador depois.
   */
  @Public()
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verificação de alcance da URL (o painel do Tiny testa antes de salvar)',
  })
  verificar(
    @Param('segredo') segredo: string,
    @Param('evento') evento: string,
  ): { ok: boolean; evento: Evento } {
    this.validarSegredo(segredo);
    return { ok: true, evento: this.validarEvento(evento) };
  }

  @Public()
  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Recebe evento do Tiny (vendas, envios, estoque, notas fiscais)' })
  async receber(
    @Param('segredo') segredo: string,
    @Param('evento') evento: string,
    @Req() req: RawBodyRequest<Request>,
  ): Promise<{ ok: boolean }> {
    this.validarSegredo(segredo);
    const tipo = this.validarEvento(evento);

    // Guarda o corpo CRU. O hash serve pra deduplicar retentativa: o Tiny manda
    // o mesmo evento até 10 vezes quando não recebe 200, e quem processar não
    // pode aplicar o mesmo fato duas vezes.
    const bruto = req.rawBody?.toString('utf8') ?? JSON.stringify(req.body ?? {});
    const hash = createHash('sha256').update(bruto).digest('hex');

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

    // Log em nível alto de propósito enquanto não há processamento: é o único
    // sinal de que o evento chegou. Sai quando o item 7 entrar.
    this.logger.log(
      `[tiny] webhook ${tipo} recebido (${bruto.length} bytes, hash ${hash.slice(0, 12)})`,
    );
    return { ok: true };
  }
}
