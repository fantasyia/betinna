import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import {
  BusinessRuleException,
  ForbiddenException,
  NotFoundException,
} from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import type { PrecosLinhaDto, TaxasPrecificacaoDto } from './precificacao.dto';
import { VitrineAdminService } from './vitrine-admin.service';
import { minimoDaVitrine } from './vitrine-pedido.service';

const num = (v: Prisma.Decimal | null): number | null => (v === null ? null : Number(v));

type SecaoPrecificacao = { ativa?: boolean } & TaxasPrecificacaoDto;

const TAXAS_VAZIAS = {
  impostoPct: null,
  pixPct: null,
  pixFixoPorPedido: null,
  cartaoPct: null,
  anuncioPorPedido: null,
  embalagemPorPedido: null,
};

/**
 * Calculadora de precificação — custo, preço por faixa e lucro de cada pedido.
 *
 * 🔒 Duas travas, e as duas valem na API (a tela só esconde):
 *  1. papel — o controller só deixa ADMIN e DIRECTOR;
 *  2. empresa — `Empresa.config.precificacao.ativa`. Ligada por migration só
 *     na Distribuidora; a chave não existe no PATCH /empresas/config, então
 *     nenhuma tela liga.
 * O custo por peça mora na Linha do modelo e NÃO é lido pela vitrine pública.
 */
@Injectable()
export class PrecificacaoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly admin: VitrineAdminService,
  ) {}

  private requireEmpresa(user: AuthenticatedUser): string {
    const id = user.empresaIdAtiva ?? user.empresaIds?.[0];
    if (!id) throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    return id;
  }

  private async secao(empresaId: string) {
    const e = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { config: true },
    });
    const cfg = (e?.config ?? {}) as { precificacao?: SecaoPrecificacao };
    return { config: e?.config ?? null, secao: cfg.precificacao ?? {} };
  }

  /** Empresa da sessão, desde que a calculadora esteja ligada nela. */
  private async empresaLigada(user: AuthenticatedUser) {
    const empresaId = this.requireEmpresa(user);
    const s = await this.secao(empresaId);
    if (s.secao.ativa !== true) {
      throw new BusinessRuleException(
        'A calculadora de precificação não está ligada nesta empresa',
      );
    }
    return { empresaId, ...s };
  }

  /** Pra aba do menu: só diz se aparece. */
  async status(user: AuthenticatedUser): Promise<{ ativa: boolean }> {
    const { secao } = await this.secao(this.requireEmpresa(user));
    return { ativa: secao.ativa === true };
  }

  async carregar(user: AuthenticatedUser) {
    const { empresaId, config, secao } = await this.empresaLigada(user);
    const [vitrine, modelos] = await Promise.all([
      this.prisma.vitrine.findUnique({
        where: { empresaId },
        select: { minimoVolume: true, minimoAtacadao: true },
      }),
      this.prisma.catalogoModelo.findMany({
        where: { empresaId },
        orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
        select: {
          id: true,
          nome: true,
          ativo: true,
          linhas: {
            select: {
              id: true,
              precoEntrada: true,
              precoVolume: true,
              precoAtacadao: true,
              precoSugerido: true,
              custoPorPeca: true,
              custoAtualizadoEm: true,
              linha: { select: { nome: true, ordem: true } },
            },
          },
        },
      }),
    ]);
    return {
      taxas: {
        impostoPct: secao.impostoPct ?? null,
        pixPct: secao.pixPct ?? null,
        pixFixoPorPedido: secao.pixFixoPorPedido ?? null,
        cartaoPct: secao.cartaoPct ?? null,
        anuncioPorPedido: secao.anuncioPorPedido ?? null,
        embalagemPorPedido: secao.embalagemPorPedido ?? null,
      },
      faixas: {
        minimoVolume: vitrine?.minimoVolume ?? null,
        minimoAtacadao: vitrine?.minimoAtacadao ?? null,
      },
      pedidoMinimo: minimoDaVitrine(config),
      modelos: modelos.map((m) => ({
        id: m.id,
        nome: m.nome,
        ativo: m.ativo,
        linhas: [...m.linhas]
          .sort((a, b) => a.linha.ordem - b.linha.ordem || a.linha.nome.localeCompare(b.linha.nome))
          .map((l) => ({
            id: l.id,
            nome: l.linha.nome,
            precoEntrada: num(l.precoEntrada),
            precoVolume: num(l.precoVolume),
            precoAtacadao: num(l.precoAtacadao),
            precoSugerido: num(l.precoSugerido),
            // Hoje só existe o manual; o custo das OPs entra com o ERP Fase 2.
            custo: { manual: num(l.custoPorPeca), atualizadoEm: l.custoAtualizadoEm },
          })),
      })),
    };
  }

  /** Custos da empresa: grava SÓ as sub-chaves de taxa, sob lock da linha. */
  async salvarTaxas(user: AuthenticatedUser, dto: TaxasPrecificacaoDto) {
    const { empresaId } = await this.empresaLigada(user);
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ config: unknown }>>`
        SELECT "config" FROM "Empresa" WHERE "id" = ${empresaId} FOR UPDATE`;
      const atual = (rows[0]?.config ?? {}) as Record<string, unknown>;
      const secao = (atual.precificacao ?? {}) as SecaoPrecificacao;
      // `ativa` NÃO vem do cliente: quem liga é a migration.
      const nova: SecaoPrecificacao = { ...TAXAS_VAZIAS, ...dto, ativa: secao.ativa };
      await tx.empresa.update({
        where: { id: empresaId },
        data: { config: { ...atual, precificacao: nova } as Prisma.InputJsonValue },
      });
      return {
        impostoPct: nova.impostoPct ?? null,
        pixPct: nova.pixPct ?? null,
        pixFixoPorPedido: nova.pixFixoPorPedido ?? null,
        cartaoPct: nova.cartaoPct ?? null,
        anuncioPorPedido: nova.anuncioPorPedido ?? null,
        embalagemPorPedido: nova.embalagemPorPedido ?? null,
      };
    });
  }

  /** "Salvar preços no modelo" — muda o que a vitrine mostra (o custo, não). */
  async salvarPrecosDaLinha(user: AuthenticatedUser, modeloLinhaId: string, dto: PrecosLinhaDto) {
    const { empresaId } = await this.empresaLigada(user);
    const ml = await this.prisma.catalogoModeloLinha.findFirst({
      where: { id: modeloLinhaId, modelo: { empresaId } },
      select: { id: true, modeloId: true, custoPorPeca: true },
    });
    if (!ml) throw new NotFoundException('Linha do modelo', modeloLinhaId);

    const d = (v: number | null | undefined) =>
      v === null || v === undefined ? null : new Prisma.Decimal(v.toFixed(2));
    const custoNovo = d(dto.custoPorPeca);
    const custoMudou = (custoNovo?.toString() ?? null) !== (ml.custoPorPeca?.toString() ?? null);
    await this.prisma.catalogoModeloLinha.update({
      where: { id: ml.id },
      data: {
        precoEntrada: d(dto.precoEntrada),
        precoVolume: d(dto.precoVolume),
        precoAtacadao: d(dto.precoAtacadao),
        precoSugerido: d(dto.precoSugerido),
        custoPorPeca: custoNovo,
        ...(custoMudou ? { custoAtualizadoEm: new Date() } : {}),
      },
    });
    // Preço de Entrada é o `precoTabela` dos produtos das variações.
    await this.admin.ressincronizarModelo(empresaId, ml.modeloId);
    return { ok: true };
  }
}
