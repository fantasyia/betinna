import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  UseInterceptors,
} from '@nestjs/common';
import { NoFilesInterceptor } from '@nestjs/platform-express';
import { Throttle, seconds } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '@shared/decorators/public.decorator';
import { WebhookAntiReplayService } from '@shared/utils/webhook-anti-replay.service';
import { assinaturaWebhookValida, eventoShein } from './shein-webhook';
import { SheinClientService } from './shein.client';
import { SheinOrdersService } from './shein-orders.service';
import { SheinPosVendaService } from './shein-pos-venda.service';

/**
 * Receiver do webhook da Shein (Léo, 02/11).
 *
 * SEGURANÇA: assinatura com o par do APLICATIVO da empresa (appid + segredo)
 * sobre `appid&timestamp&caminho`; o `eventData` vem cifrado com o segredo do
 * app. Anti-replay pela assinatura + janela de timestamp.
 *
 * RESPOSTA: sempre 200 e na hora — a Shein espera no máximo 1,5 s e trata
 * não-2xx como falha (reenvia em 30–60 min e manda e-mail). O processamento
 * roda depois da resposta. O aviso é só um gatilho: com o número na mão, o
 * serviço busca o pedido/caso de verdade na API. O sincronismo de 30 min
 * segue como rede de segurança.
 */
@ApiTags('webhooks')
@Controller('webhooks/shein')
@Throttle({ default: { limit: 200, ttl: seconds(60) } })
export class SheinWebhookController {
  private readonly logger = new Logger(SheinWebhookController.name);

  constructor(
    private readonly shein: SheinClientService,
    private readonly pedidos: SheinOrdersService,
    private readonly posVenda: SheinPosVendaService,
    private readonly antiReplay: WebhookAntiReplayService,
  ) {}

  @Public()
  @Post()
  @HttpCode(HttpStatus.OK)
  // A Shein manda multipart/form-data; o interceptor lê os campos de texto.
  @UseInterceptors(NoFilesInterceptor())
  @ApiOperation({ summary: 'Recebe os avisos (webhook) da Shein' })
  async receive(
    @Req() req: Request,
    @Headers('x-lt-appid') appId: string | undefined,
    @Headers('x-lt-openkeyid') openKeyId: string | undefined,
    @Headers('x-lt-eventcode') evento: string | undefined,
    @Headers('x-lt-timestamp') timestamp: string | undefined,
    @Headers('x-lt-signature') assinatura: string | undefined,
    @Body() body: { eventData?: string } | undefined,
  ): Promise<{ ok: boolean }> {
    if (!appId || !timestamp || !assinatura || !body?.eventData) {
      this.logger.warn(`Webhook Shein incompleto (evento=${evento ?? '?'}) — ignorado`);
      return { ok: false };
    }
    const conta = await this.shein.resolverPorChaves(appId, openKeyId || undefined);
    if (!conta) {
      this.logger.warn(`Webhook Shein de app/loja sem conexão ativa (evento=${evento}) — ignorado`);
      return { ok: false };
    }
    const caminho = req.originalUrl.split('?')[0];
    if (!assinaturaWebhookValida(assinatura, appId, conta.appSecret, caminho, timestamp)) {
      this.logger.warn(`Webhook Shein com assinatura inválida (evento=${evento}) — descartado`);
      return { ok: false };
    }
    try {
      const replay = await this.antiReplay.checkAndMarkWebhook('shein', assinatura, timestamp);
      if (!replay.fresh) return { ok: true };
    } catch (err) {
      // Timestamp fora da janela de 5 min (replay velho).
      this.logger.warn(
        `Webhook Shein recusado pelo anti-replay (evento=${evento}): ${String(err)}`,
      );
      return { ok: false };
    }

    let dados: Record<string, unknown>;
    try {
      dados = eventoShein(body.eventData, conta.appSecret);
    } catch (err) {
      this.logger.warn(`Webhook Shein: eventData não decifrou (evento=${evento}): ${String(err)}`);
      return { ok: false };
    }
    // Depois da resposta: a Shein não espera o processamento.
    setImmediate(() => void this.despachar(conta.empresaId, evento ?? '', dados));
    return { ok: true };
  }

  private async despachar(
    empresaId: string,
    evento: string,
    d: Record<string, unknown>,
  ): Promise<void> {
    const texto = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    try {
      switch (evento) {
        case 'order_push_notice': {
          const n = texto(d.orderNo);
          if (!n) break;
          const ok = await this.pedidos.sincronizarPedido(empresaId, n);
          this.logger.log(`Webhook Shein: pedido ${n} ${ok ? 'gravado' : 'não encontrado'}`);
          return;
        }
        case 'aftersales_push_notice': {
          const n = texto(d.aftersalesOrderNo);
          if (!n) break;
          const ok = await this.posVenda.sincronizarCaso(empresaId, n);
          this.logger.log(`Webhook Shein: pós-venda ${n} ${ok ? 'gravado' : 'não encontrado'}`);
          return;
        }
        case 'return_order_push_notice': {
          // O console (02/11) só oferece este pro pós-venda: traz o número da
          // DEVOLUÇÃO, não o do caso — puxa os casos que mudaram nas 48 h.
          const r = await this.posVenda.sincronizar(
            empresaId,
            new Date(Date.now() - 47 * 3_600_000),
            2,
          );
          this.logger.log(
            `Webhook Shein: devolução ${texto(d.returnOrderNo) ?? '?'} → ${r.casos} pós-vendas`,
          );
          return;
        }
        default:
          // Evento assinado no console que o app ainda não trata: aparece no log.
          this.logger.warn(`Webhook Shein evento não-tratado: ${evento} ${JSON.stringify(d)}`);
          return;
      }
      this.logger.warn(`Webhook Shein ${evento} sem número: ${JSON.stringify(d)}`);
    } catch (err) {
      this.logger.warn(`Webhook Shein ${evento} falhou: ${String(err)}`);
    }
  }
}
