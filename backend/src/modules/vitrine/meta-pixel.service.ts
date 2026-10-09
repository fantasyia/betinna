import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { EnvService } from '@config/env.service';
import { PrismaService } from '@database/prisma.service';
import { IntegracoesService } from '@modules/integracoes/integracoes.service';
import { ouvirPedidoPago } from '@modules/pedidos/pedido-pago.evento';
import { eventoCompra } from '@integrations/meta/meta-conversoes';
import { BusinessRuleException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import type { PixelConfigDto } from './vitrine.dto';

/** O que fica em `Empresa.config.pixel` (sem segredo — o ID do pixel é público). */
export interface ConfigPixel {
  ativo?: boolean;
  pixelId?: string;
  /** Código de teste do Gerenciador de Eventos (só enquanto testa). */
  testEventCode?: string | null;
}

export function configPixel(config: unknown): ConfigPixel {
  return (((config ?? {}) as Record<string, unknown>).pixel ?? {}) as ConfigPixel;
}

/** Pixel ligado com ID — o que a vitrine pública e a política precisam saber. */
export function pixelLigado(config: unknown): string | null {
  const c = configPixel(config);
  return c.ativo === true && c.pixelId ? c.pixelId : null;
}

/** Atribuição gravada no pedido da vitrine (Pedido.atribuicao). */
interface AtribuicaoPedido {
  primeiro?: { landingPage?: string };
  ultimo?: { landingPage?: string };
  meta?: { fbc?: string; fbp?: string; ip?: string; userAgent?: string };
  capi?: { purchase?: string };
}

const regra = (msg: string) => new BusinessRuleException(msg, ErrorCode.BUSINESS_RULE_VIOLATION);

/**
 * Pixel do Meta + API de Conversões na vitrine (card da #04, 09/10).
 *
 * Navegador: PageView, ViewContent, AddToCart, InitiateCheckout,
 * AddPaymentInfo e Purchase (a tela). Servidor: o Purchase de verdade, quando
 * o pedido vira PAGO — com o MESMO `event_id` do navegador (o Meta deduplica).
 * O token fica na conexão `meta_pixel` (Integrações, cifrada).
 */
@Injectable()
export class MetaPixelService implements OnModuleInit {
  private readonly logger = new Logger(MetaPixelService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly integracoes: IntegracoesService,
    private readonly env: EnvService,
  ) {}

  onModuleInit(): void {
    ouvirPedidoPago((pedidoId) => this.enviarCompra(pedidoId));
  }

  /** Injetável nos testes. */
  protected http(url: string, init: RequestInit): Promise<Response> {
    return fetch(url, init);
  }

  private empresaDo(user: AuthenticatedUser): string {
    const id = user.empresaIdAtiva ?? user.empresaIds?.[0];
    if (!id) throw regra('Empresa não definida');
    return id;
  }

  private async token(empresaId: string): Promise<string | null> {
    try {
      const c = await this.integracoes.obterCredenciaisInternas(empresaId, 'meta_pixel');
      return ((c.credenciais as { accessToken?: string }).accessToken ?? '').trim() || null;
    } catch {
      return null;
    }
  }

  // ─── Tela de configuração ────────────────────────────────────────────────

  async status(user: AuthenticatedUser) {
    const empresaId = this.empresaDo(user);
    const [e, tk] = await Promise.all([
      this.prisma.empresa.findUnique({ where: { id: empresaId }, select: { config: true } }),
      this.token(empresaId),
    ]);
    return { conectado: !!tk, config: configPixel(e?.config) };
  }

  async salvar(user: AuthenticatedUser, dto: PixelConfigDto) {
    const empresaId = this.empresaDo(user);
    if (dto.ativo && !(await this.token(empresaId))) {
      throw regra('Conecte a API de Conversões (token) em Integrações antes de ligar o pixel');
    }
    const parte: ConfigPixel = {
      ativo: dto.ativo,
      pixelId: dto.pixelId,
      testEventCode: dto.testEventCode || null,
    };
    await this.prisma.$executeRaw`
      UPDATE "Empresa"
      SET "config" = jsonb_set(COALESCE("config", '{}'::jsonb), '{pixel}', ${JSON.stringify(parte)}::jsonb, true)
      WHERE "id" = ${empresaId}`;
    this.logger.log(`[pixel] config salva na empresa ${empresaId} (ativo=${dto.ativo})`);
    return this.status(user);
  }

  // ─── Compra (CAPI) ───────────────────────────────────────────────────────

  /**
   * Manda o Purchase do pedido da vitrine que acabou de virar PAGO. Uma vez por
   * pedido (trava atômica em `atribuicao.capi.purchase`). Nunca lança: o
   * pagamento já está gravado, isto é medição.
   */
  async enviarCompra(pedidoId: string): Promise<void> {
    try {
      const p = await this.prisma.pedido.findUnique({
        where: { id: pedidoId },
        select: {
          id: true,
          empresaId: true,
          origem: true,
          numero: true,
          total: true,
          pagoEm: true,
          contatoTelefone: true,
          contatoEmail: true,
          contatoNome: true,
          clienteId: true,
          entrega: true,
          atribuicao: true,
          cliente: { select: { cidade: true, uf: true, cep: true } },
          itens: { select: { produtoId: true, quantidade: true, precoUnitario: true } },
          empresa: { select: { config: true } },
        },
      });
      if (!p || p.origem !== 'VITRINE') return;
      const cfg = configPixel(p.empresa.config);
      const pixelId = pixelLigado(p.empresa.config);
      if (!pixelId) return;
      const a = (p.atribuicao ?? {}) as AtribuicaoPedido;
      // Evento de site exige o navegador do cliente — pedido sem ele (anterior
      // ao pixel) não vai.
      if (!a.meta?.userAgent) return;
      const tk = await this.token(p.empresaId);
      if (!tk) {
        this.logger.warn(`[pixel] pedido ${p.numero}: pixel ligado SEM token — compra não enviada`);
        return;
      }
      // Trava: só quem marca "enviando" segue (PEDIDO_PAGO repetido não duplica).
      const trava = await this.prisma.$executeRaw`
        UPDATE "Pedido"
        SET "atribuicao" = jsonb_set(COALESCE("atribuicao", '{}'::jsonb), '{capi}', '{"purchase":"enviando"}'::jsonb, true)
        WHERE "id" = ${p.id} AND ("atribuicao" #>> '{capi,purchase}') IS NULL`;
      if (trava === 0) return;

      const e = (p.entrega ?? {}) as { cep?: string; cidade?: string; uf?: string };
      const evento = eventoCompra({
        pedidoId: p.id,
        numero: p.numero,
        total: Number(p.total),
        pagoEm: p.pagoEm ?? new Date(),
        telefone: p.contatoTelefone,
        email: p.contatoEmail,
        nome: p.contatoNome,
        cidade: e.cidade ?? p.cliente?.cidade ?? null,
        uf: e.uf ?? p.cliente?.uf ?? null,
        cep: e.cep ?? p.cliente?.cep ?? null,
        clienteId: p.clienteId,
        itens: p.itens.map((i) => ({
          produtoId: i.produtoId,
          quantidade: i.quantidade,
          preco: Number(i.precoUnitario),
        })),
        url: a.ultimo?.landingPage ?? a.primeiro?.landingPage ?? '',
        ip: a.meta.ip ?? null,
        userAgent: a.meta.userAgent,
        fbc: a.meta.fbc ?? null,
        fbp: a.meta.fbp ?? null,
      });
      const versao = this.env.get('META_GRAPH_API_VERSION');
      const r = await this.http(
        `https://graph.facebook.com/${versao}/${encodeURIComponent(pixelId)}/events?access_token=${encodeURIComponent(tk)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            data: [evento],
            ...(cfg.testEventCode ? { test_event_code: cfg.testEventCode } : {}),
          }),
          signal: AbortSignal.timeout(10_000),
          redirect: 'error',
        },
      );
      const resultado = r.ok
        ? new Date().toISOString()
        : `falhou ${r.status}: ${await r
            .json()
            .then((j: { error?: { message?: string } }) => j?.error?.message ?? '')
            .catch(() => '')}`.slice(0, 300);
      await this.prisma.$executeRaw`
        UPDATE "Pedido"
        SET "atribuicao" = jsonb_set("atribuicao", '{capi,purchase}', to_jsonb(${resultado}::text), true)
        WHERE "id" = ${p.id}`;
      if (r.ok) this.logger.log(`[pixel] pedido ${p.numero}: compra enviada ao Meta`);
      else this.logger.warn(`[pixel] pedido ${p.numero}: Meta recusou a compra — ${resultado}`);
    } catch (err) {
      this.logger.warn(`[pixel] pedido ${pedidoId}: compra não enviada — ${String(err)}`);
    }
  }
}
