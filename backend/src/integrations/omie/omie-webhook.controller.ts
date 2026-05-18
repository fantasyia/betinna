import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import { Throttle, seconds } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { EnvService } from '@config/env.service';
import { PrismaService } from '@database/prisma.service';
import { Public } from '@shared/decorators/public.decorator';
import { UnauthorizedException } from '@shared/errors/app-exception';
import { WebhookSignatureUtil } from '@shared/http/webhook-signature.util';
import { NotificacoesService } from '@modules/notificacoes/notificacoes.service';
import { WebhookAntiReplayService } from '@shared/utils/webhook-anti-replay.service';
import { OmieProdutosService } from './omie-produtos.service';

const webhookClienteStatusSchema = z.object({
  codigo_cliente_omie: z.coerce.number().int().positive(),
  bloqueado: z.enum(['S', 'N']).optional(),
  inativo: z.enum(['S', 'N']).optional(),
});

/**
 * Schema do webhook de produto/estoque do OMIE.
 *
 * O OMIE manda eventos como `Estoque.Alterado` ou `Produto.Alterado` com
 * payload variável. Aceitamos qualquer um dos campos abaixo — o que importa
 * é identificar o produto (codigo_produto OU codigo) pra disparar um pull
 * do produto específico e atualizar local.
 *
 * Outros campos do payload são ignorados — preferimos pull do estado real
 * em vez de confiar nos valores que vieram no event (evita race condition).
 */
const webhookProdutoSchema = z.object({
  codigo_produto: z.coerce.number().int().positive().optional(),
  codigo: z.string().optional(),
  // Campos opcionais que o OMIE pode mandar — usamos apenas pra logar
  quantidade_estoque: z.coerce.number().optional(),
  evento: z.string().optional(),
});

/**
 * Receiver de webhooks do OMIE.
 *
 * O OMIE permite cadastrar webhooks por evento. Aqui tratamos:
 *  - Alteração de status do cliente (bloqueio/desbloqueio)
 *
 * Verificação de assinatura:
 *  - Header `X-Omie-Signature` (HMAC-SHA256 do body cru)
 *  - Secret configurado em OMIE_WEBHOOK_SECRET
 *
 * O endpoint é público (sem AuthGuard) mas validado por HMAC.
 * Resposta 200 imediata pra não retentar — erros são logados.
 */
@ApiTags('webhooks')
@Controller('webhooks/omie')
// Webhooks: 100 req/min por IP (proxy do OMIE) — limite alto pra picos de eventos
@Throttle({ default: { limit: 100, ttl: seconds(60) } })
export class OmieWebhookController {
  private readonly logger = new Logger(OmieWebhookController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly antiReplay: WebhookAntiReplayService,
    private readonly notificacoes: NotificacoesService,
    private readonly produtosSync: OmieProdutosService,
  ) {}

  /**
   * Valida HMAC + anti-replay genérico pros webhooks OMIE.
   * Compartilhado entre `cliente-status` e `produto`.
   * Retorna `true` se aceito (processar), `false` se replay (ack idempotente).
   */
  private async validarAssinatura(
    req: RawBodyRequest<Request>,
    signature: string | undefined,
    omieTimestamp: string | undefined,
  ): Promise<boolean> {
    const secret = this.env.get('OMIE_WEBHOOK_SECRET');
    const isProd = this.env.isProduction;
    if (!secret) {
      if (isProd) {
        this.logger.error('OMIE_WEBHOOK_SECRET ausente em produção — webhook rejeitado');
        throw new UnauthorizedException('webhook secret não configurado');
      }
      this.logger.warn('OMIE_WEBHOOK_SECRET ausente (dev) — webhook aceito sem HMAC');
      return true;
    }
    const rawBody = req.rawBody;
    if (!rawBody) {
      this.logger.warn('Webhook OMIE sem rawBody — não é possível validar HMAC');
      throw new UnauthorizedException('rawBody ausente');
    }
    if (!signature || !WebhookSignatureUtil.verifyHmacSha256(rawBody, signature, secret)) {
      this.logger.warn('Webhook OMIE com assinatura inválida — descartado');
      throw new UnauthorizedException('assinatura inválida');
    }
    const replay = await this.antiReplay.checkAndMarkWebhook('omie', signature, omieTimestamp);
    return replay.fresh;
  }

  @Public()
  @Post('cliente-status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Recebe alterações de status de cliente do OMIE (bloqueado/desbloqueado)',
  })
  async clienteStatus(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-omie-signature') signature: string | undefined,
    @Headers('x-omie-timestamp') omieTimestamp: string | undefined,
    @Body() body: unknown,
  ): Promise<{ ok: boolean }> {
    const fresh = await this.validarAssinatura(req, signature, omieTimestamp);
    if (!fresh) return { ok: true }; // replay — ack idempotente

    const parsed = webhookClienteStatusSchema.safeParse(body);
    if (!parsed.success) {
      this.logger.warn(
        `Payload de webhook OMIE inválido: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
      );
      // Retorna 200 mesmo assim — não queremos OMIE retentando
      return { ok: false };
    }

    const codigoOmie = parsed.data.codigo_cliente_omie.toString();
    const novoOmieStatus = parsed.data.bloqueado === 'S' ? 'BLOQUEADO' : 'ATIVO';

    // codigoOmie agora é único dentro de cada empresa (@@unique [empresaId, codigoOmie]).
    // O webhook OMIE não inclui empresaId no payload, então usamos findFirst.
    // Em ambiente multi-tenant real, diferentes empresas OMIE têm suas próprias
    // sequências de código — colisão entre tenants é improvável, mas caso ocorra,
    // o primeiro match será atualizado. Evolução futura: endpoint por empresa
    // `/webhooks/omie/:empresaToken/cliente-status`.
    const cliente = await this.prisma.cliente.findFirst({
      where: { codigoOmie },
      select: { id: true, empresaId: true, omieStatus: true, nome: true },
    });
    if (!cliente) {
      this.logger.warn(
        `Webhook OMIE: cliente ${codigoOmie} não encontrado localmente — sync primeiro`,
      );
      return { ok: false };
    }

    if (cliente.omieStatus === novoOmieStatus) {
      return { ok: true }; // sem mudança, idempotente
    }

    await this.prisma.cliente.update({
      where: { id: cliente.id },
      data: { omieStatus: novoOmieStatus },
    });

    this.logger.log(
      `Cliente ${cliente.nome} (${codigoOmie}) → omieStatus=${novoOmieStatus} via webhook`,
    );

    // Notifica REP responsável quando cliente foi bloqueado (precisa ação)
    if (novoOmieStatus === 'BLOQUEADO') {
      const c = await this.prisma.cliente.findUnique({
        where: { id: cliente.id },
        select: { representanteId: true },
      });
      if (c?.representanteId) {
        void this.notificacoes.criarParaUsuario({
          empresaId: cliente.empresaId,
          usuarioId: c.representanteId,
          tipo: 'CLIENTE_BLOQUEADO',
          prioridade: 'ALTA',
          titulo: 'Cliente bloqueado no OMIE',
          mensagem: `${cliente.nome} foi bloqueado. Pedidos novos não passam até resolver com o financeiro.`,
          link: `/clientes/${cliente.id}`,
          metadata: { clienteId: cliente.id, codigoOmie },
        });
      }
    }

    return { ok: true };
  }

  /**
   * Webhook de produto/estoque alterado no OMIE.
   *
   * Estratégia: ao receber o evento, identificamos o produto pelo `codigo_produto`
   * (codigoOmie local). Como o payload do OMIE pode ser parcial ou stale, disparamos
   * um sync incremental da empresa correspondente em vez de confiar nos valores do
   * payload. Isso garante consistência com o cron de 30min (fallback).
   *
   * NOTA: nem todos os planos OMIE expõem webhook de estoque. O cron de 30min
   * (`OmieEstoqueJob`) cobre o caso onde o webhook não existir/falhar.
   */
  @Public()
  @Post('produto')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Recebe alteração de produto/estoque do OMIE' })
  async produtoEstoque(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-omie-signature') signature: string | undefined,
    @Headers('x-omie-timestamp') omieTimestamp: string | undefined,
    @Body() body: unknown,
  ): Promise<{ ok: boolean }> {
    const fresh = await this.validarAssinatura(req, signature, omieTimestamp);
    if (!fresh) return { ok: true }; // replay — ack idempotente

    const parsed = webhookProdutoSchema.safeParse(body);
    if (!parsed.success) {
      this.logger.warn(
        `Payload de webhook OMIE produto inválido: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
      );
      return { ok: false };
    }

    const codigoOmie = parsed.data.codigo_produto?.toString();
    if (!codigoOmie) {
      this.logger.warn('Webhook OMIE produto sem codigo_produto — ignorado');
      return { ok: false };
    }

    // Resolve a empresa via produto local (codigoOmie é único por empresa).
    const produto = await this.prisma.produto.findFirst({
      where: { codigoOmie },
      select: { id: true, empresaId: true, nome: true, estoque: true },
    });
    if (!produto) {
      this.logger.warn(
        `Webhook OMIE produto ${codigoOmie} não encontrado localmente — disparando sync incremental geral`,
      );
      // Sem produto local, não temos empresaId. Skip e deixa o cron 30min capturar.
      return { ok: false };
    }

    // Dispara sync incremental da empresa — fonte da verdade é OMIE, não o
    // payload do webhook (que pode estar stale). Async pra responder rápido.
    void this.produtosSync
      .sync(produto.empresaId, { modo: 'incremental' })
      .then((r) =>
        this.logger.log(
          `Webhook OMIE produto ${codigoOmie} (${produto.nome}) → sync disparado: ${r.atualizados} atualizados`,
        ),
      )
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Sync incremental pós-webhook produto falhou: ${msg}`);
      });

    return { ok: true };
  }
}
