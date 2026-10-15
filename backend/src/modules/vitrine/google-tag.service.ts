import { createHash } from 'node:crypto';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { IntegracoesService } from '@modules/integracoes/integracoes.service';
import { ouvirPedidoPago } from '@modules/pedidos/pedido-pago.evento';
import { BusinessRuleException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import type { GoogleTagConfigDto } from './vitrine.dto';

/**
 * Tag do Google na vitrine (card cmv8rfj43000knz5igb2y3ws2 — #04/Léo, 15/10):
 * GA4 (G-…) e Google Ads (AW-… + rótulo da conversão de compra). Tudo
 * público (vai no HTML); fica em `Empresa.config.googleTag`, igual ao pixel.
 */
export interface ConfigGoogleTag {
  ativo?: boolean;
  ga4Id?: string | null;
  adsId?: string | null;
  /** Rótulo da conversão de compra (o que vem depois da barra no send_to). */
  compraLabel?: string | null;
}

export function configGoogleTag(config: unknown): ConfigGoogleTag {
  return (((config ?? {}) as Record<string, unknown>).googleTag ?? {}) as ConfigGoogleTag;
}

/** O que a vitrine pública recebe. null = desligada (ou sem nenhum ID). PURO. */
export function googleTagLigada(
  config: unknown,
): { ga4Id: string | null; adsId: string | null; compraSendTo: string | null } | null {
  const c = configGoogleTag(config);
  if (c.ativo !== true || (!c.ga4Id && !c.adsId)) return null;
  return {
    ga4Id: c.ga4Id || null,
    adsId: c.adsId || null,
    compraSendTo: c.adsId && c.compraLabel ? `${c.adsId}/${c.compraLabel}` : null,
  };
}

const regra = (msg: string) => new BusinessRuleException(msg, ErrorCode.BUSINESS_RULE_VIOLATION);

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

/**
 * Corpo do `purchase` do GA4 pelo Measurement Protocol (15/10). Mesmo
 * `transaction_id` do navegador — o GA4 junta os dois. `client_id` = o do
 * cookie `_ga` gravado no pedido (a compra cai na visita que veio do anúncio);
 * sem ele, um id do pedido (a compra conta, sem a origem). PURO.
 */
export function corpoCompraGa4(p: {
  pedidoId: string;
  total: number;
  clientId?: string | null;
  email?: string | null;
  telefone?: string | null;
  itens: Array<{ produtoId: string; quantidade: number; preco: number }>;
}) {
  const email = p.email?.trim().toLowerCase();
  const d = (p.telefone ?? '').replace(/\D/g, '');
  const fone = d.length >= 10 ? `+${d.startsWith('55') && d.length >= 12 ? d : `55${d}`}` : null;
  // Sem o cookie: um client_id estável por pedido (só dígitos e ponto, como o do GA).
  const doPedido = `${parseInt(sha256(p.pedidoId).slice(0, 8), 16)}.${parseInt(sha256(p.pedidoId).slice(8, 16), 16)}`;
  return {
    client_id: p.clientId && /^\d+\.\d+$/.test(p.clientId) ? p.clientId : doPedido,
    ...(email || fone
      ? {
          user_data: {
            ...(email ? { sha256_email_address: [sha256(email)] } : {}),
            ...(fone ? { sha256_phone_number: [sha256(fone)] } : {}),
          },
        }
      : {}),
    events: [
      {
        name: 'purchase',
        params: {
          transaction_id: p.pedidoId,
          value: p.total,
          currency: 'BRL',
          engagement_time_msec: 1,
          items: p.itens.map((i) => ({
            item_id: i.produtoId,
            quantity: i.quantidade,
            price: i.preco,
          })),
        },
      },
    ],
  };
}

@Injectable()
export class GoogleTagService implements OnModuleInit {
  private readonly logger = new Logger(GoogleTagService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly integracoes: IntegracoesService,
  ) {}

  onModuleInit(): void {
    ouvirPedidoPago((pedidoId) => this.enviarCompra(pedidoId));
  }

  /** Injetável nos testes. */
  protected http(url: string, init: RequestInit): Promise<Response> {
    return fetch(url, init);
  }

  private async secret(empresaId: string): Promise<string | null> {
    try {
      const c = await this.integracoes.obterCredenciaisInternas(empresaId, 'ga4_mp');
      return ((c.credenciais as { apiSecret?: string }).apiSecret ?? '').trim() || null;
    } catch {
      return null;
    }
  }

  /**
   * Compra paga da vitrine pro GA4 pelo SERVIDOR (não depende da tela do Pix
   * ficar aberta). Uma vez por pedido (trava em `atribuicao.ga4.purchase`).
   * Nunca lança: o pagamento já está gravado, isto é medição.
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
          contatoEmail: true,
          contatoTelefone: true,
          atribuicao: true,
          itens: { select: { produtoId: true, quantidade: true, precoUnitario: true } },
          empresa: { select: { config: true } },
        },
      });
      if (!p || p.origem !== 'VITRINE') return;
      const tag = googleTagLigada(p.empresa.config);
      if (!tag?.ga4Id) return;
      const secret = await this.secret(p.empresaId);
      if (!secret) return;
      const trava = await this.prisma.$executeRaw`
        UPDATE "Pedido"
        SET "atribuicao" = jsonb_set(COALESCE("atribuicao", '{}'::jsonb), '{ga4}', '{"purchase":"enviando"}'::jsonb, true)
        WHERE "id" = ${p.id} AND ("atribuicao" #>> '{ga4,purchase}') IS NULL`;
      if (trava === 0) return;

      const a = (p.atribuicao ?? {}) as { google?: { clientId?: string } };
      const corpo = corpoCompraGa4({
        pedidoId: p.id,
        total: Number(p.total),
        clientId: a.google?.clientId ?? null,
        email: p.contatoEmail,
        telefone: p.contatoTelefone,
        itens: p.itens.map((i) => ({
          produtoId: i.produtoId,
          quantidade: i.quantidade,
          preco: Number(i.precoUnitario),
        })),
      });
      const r = await this.http(
        `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(tag.ga4Id)}&api_secret=${encodeURIComponent(secret)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(corpo),
          signal: AbortSignal.timeout(10_000),
          redirect: 'error',
        },
      );
      const resultado = r.ok ? new Date().toISOString() : `falhou ${r.status}`;
      await this.prisma.$executeRaw`
        UPDATE "Pedido"
        SET "atribuicao" = jsonb_set("atribuicao", '{ga4,purchase}', to_jsonb(${resultado}::text), true)
        WHERE "id" = ${p.id}`;
      if (r.ok) this.logger.log(`[ga4] pedido ${p.numero}: compra enviada ao GA4 pelo servidor`);
      else this.logger.warn(`[ga4] pedido ${p.numero}: GA4 recusou a compra — ${resultado}`);
    } catch (err) {
      this.logger.warn(`[ga4] pedido ${pedidoId}: compra não enviada — ${String(err)}`);
    }
  }

  private empresaDo(user: AuthenticatedUser): string {
    const id = user.empresaIdAtiva ?? user.empresaIds?.[0];
    if (!id) throw regra('Empresa não definida');
    return id;
  }

  async status(user: AuthenticatedUser) {
    const empresaId = this.empresaDo(user);
    const [e, secret] = await Promise.all([
      this.prisma.empresa.findUnique({ where: { id: empresaId }, select: { config: true } }),
      this.secret(empresaId),
    ]);
    // `servidor`: o secret do Measurement Protocol está em Integrações.
    return { config: configGoogleTag(e?.config), servidor: !!secret };
  }

  async salvar(user: AuthenticatedUser, dto: GoogleTagConfigDto) {
    const empresaId = this.empresaDo(user);
    const parte: ConfigGoogleTag = {
      ativo: dto.ativo,
      ga4Id: dto.ga4Id || null,
      adsId: dto.adsId || null,
      compraLabel: dto.compraLabel || null,
    };
    await this.prisma.$executeRaw`
      UPDATE "Empresa"
      SET "config" = jsonb_set(COALESCE("config", '{}'::jsonb), '{googleTag}', ${JSON.stringify(parte)}::jsonb, true)
      WHERE "id" = ${empresaId}`;
    this.logger.log(`[google-tag] config salva na empresa ${empresaId} (ativo=${dto.ativo})`);
    return this.status(user);
  }
}
