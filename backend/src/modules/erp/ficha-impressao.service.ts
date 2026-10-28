import { Injectable } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { NotFoundException } from '@shared/errors/app-exception';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { EstoqueService } from './estoque.service';
import { servicosAcabamento } from './acabamento';
import { materialDe, rotuloLinhas } from './encaixe.service';

/** Linha da ficha como a impressão lê (uma por uso: cós, barra…). */
export interface LinhaFichaImpressao {
  insumoId: string;
  corFixaId: string | null;
  consumoPorPeca: number;
  porTamanho: Record<string, number> | null;
  etapa: string;
  observacao: string | null;
  uso: string | null;
  nome: string;
  tipo: string;
  unidade: string;
  cor: string | null;
}

/**
 * Junta as linhas do MESMO insumo, cor efetiva e etapa (Léo, 27/10: elástico
 * no cós e na barra vai pra facção como UM total). Por tamanho soma tamanho a
 * tamanho — linha sem o tamanho entra com o consumo médio dela, como na OP.
 * Etapas diferentes não se misturam (cada via tem a sua lista). PURO.
 */
export function juntarItensDaFicha(linhas: LinhaFichaImpressao[]) {
  const grupos = new Map<string, LinhaFichaImpressao[]>();
  for (const l of linhas) {
    const k = `${l.insumoId}|${l.corFixaId ?? ''}|${l.etapa}`;
    grupos.set(k, [...(grupos.get(k) ?? []), l]);
  }
  return [...grupos.values()].map((g) => {
    const consumoPorPeca = g.reduce((s, l) => s + l.consumoPorPeca, 0);
    const tamanhos = new Set(g.flatMap((l) => Object.keys(l.porTamanho ?? {})));
    const porTamanho = tamanhos.size
      ? Object.fromEntries(
          [...tamanhos].map((t) => [
            t,
            g.reduce((s, l) => s + (l.porTamanho?.[t] ?? l.consumoPorPeca), 0),
          ]),
        )
      : null;
    const textos = (xs: Array<string | null>) => [...new Set(xs.filter((x): x is string => !!x))];
    return {
      nome: g[0].nome,
      tipo: g[0].tipo,
      unidade: g[0].unidade,
      cor: g[0].cor,
      consumoPorPeca,
      porTamanho,
      etapa: g[0].etapa,
      observacao: textos(g.map((l) => l.observacao)).join(' · ') || null,
      /** Onde vai na peça (cós, barra…) — o total já soma todos. */
      usos: textos(g.map((l) => l.uso)),
    };
  });
}

/**
 * Ficha da OP pra IMPRIMIR (card cmv8po94p0089pf5ih9l3n8bn — Léo, 14/10): tudo
 * o que as 3 vias (corte, facção, acabamento) precisam, numa leitura só. A
 * montagem das vias (totais por tamanho, enfesto, viés por cor) é da tela.
 */
@Injectable()
export class FichaImpressaoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly erp: EstoqueService,
  ) {}

  async dadosDaOp(user: AuthenticatedUser, opId: string) {
    const empresaId = await this.erp.empresaLigada(user);
    const op = await this.prisma.ordemProducao.findFirst({
      where: { id: opId, empresaId },
      include: {
        modelo: { select: { id: true, nome: true, regrasEncaixe: true } },
        faccao: { select: { nome: true } },
        itens: true,
        encaixes: {
          where: { status: 'CONCLUIDO' },
          orderBy: { concluidoEm: 'desc' },
          select: { id: true, entrada: true, resultado: true, concluidoEm: true },
        },
      },
    });
    if (!op) throw new NotFoundException('Ordem de produção', opId);

    const [vs, empresa] = await Promise.all([
      this.prisma.catalogoVariacao.findMany({
        where: { empresaId, produtoId: { in: op.itens.map((i) => i.produtoId) } },
        select: {
          produtoId: true,
          modeloCor: { select: { ordem: true, cor: { select: { nome: true, hex: true } } } },
          modeloLinha: { select: { linha: { select: { nome: true, ordem: true } } } },
          modeloTamanho: { select: { tamanho: { select: { nome: true, ordem: true } } } },
        },
      }),
      this.prisma.empresa.findUnique({
        where: { id: empresaId },
        select: { nome: true, config: true },
      }),
    ]);
    const porProduto = new Map(vs.map((v) => [v.produtoId, v]));
    const linhas = [...new Set(op.itens.map((i) => i.modeloLinhaId))];

    const [fichas, mls] = await Promise.all([
      this.prisma.fichaTecnica.findMany({
        where: { empresaId, modeloLinhaId: { in: linhas } },
        select: {
          modeloLinhaId: true,
          observacoes: true,
          acabamento: true,
          itens: {
            select: {
              insumoId: true,
              corFixaId: true,
              consumoPorPeca: true,
              porTamanho: true,
              etapa: true,
              observacao: true,
              uso: true,
              insumo: { select: { nome: true, tipo: true, unidade: true } },
              corFixa: { select: { nome: true } },
            },
          },
        },
      }),
      this.prisma.catalogoModeloLinha.findMany({
        where: { id: { in: linhas } },
        select: { id: true, tabelaMedidas: true, linha: { select: { nome: true } } },
      }),
    ]);
    const servicos = servicosAcabamento(empresa?.config);
    const regras = (op.modelo.regrasEncaixe ?? null) as {
      codigoMolde?: string | null;
      tecido?: string;
      larguraUtilMm?: number;
      ribana?: { tecido: string; larguraUtilMm: number } | null;
    } | null;

    return {
      empresa: empresa?.nome ?? '',
      op: {
        id: op.id,
        numero: op.numero,
        status: op.status,
        etapa: op.etapa,
        criadoEm: op.criadoEm,
        prazo: op.prazo,
        faccao: op.faccao?.nome ?? null,
        precoFaccaoPorPeca: op.precoFaccaoPorPeca === null ? null : Number(op.precoFaccaoPorPeca),
        observacoes: op.observacoes,
      },
      modelo: {
        nome: op.modelo.nome,
        codigoMolde: regras?.codigoMolde ?? null,
        tecido: regras?.tecido ?? null,
        larguraUtilMm: regras?.larguraUtilMm ?? null,
        ribana: regras?.ribana ?? null,
      },
      grade: op.itens.map((i) => {
        const v = porProduto.get(i.produtoId);
        return {
          modeloLinhaId: i.modeloLinhaId,
          linha: v?.modeloLinha.linha.nome ?? '',
          linhaOrdem: v?.modeloLinha.linha.ordem ?? 0,
          cor: v?.modeloCor.cor.nome ?? '',
          corHex: v?.modeloCor.cor.hex ?? null,
          corOrdem: v?.modeloCor.ordem ?? 0,
          tamanho: v?.modeloTamanho.tamanho.nome ?? '',
          tamanhoOrdem: v?.modeloTamanho.tamanho.ordem ?? 0,
          planejada: i.planejada,
          cortada: i.cortada,
        };
      }),
      fichas: linhas.map((l) => {
        const f = fichas.find((x) => x.modeloLinhaId === l);
        const ml = mls.find((x) => x.id === l);
        const ids = Array.isArray(f?.acabamento) ? (f!.acabamento as string[]) : [];
        return {
          modeloLinhaId: l,
          linha: ml?.linha.nome ?? '',
          observacoes: f?.observacoes ?? null,
          tabelaMedidas: ml?.tabelaMedidas ?? null,
          acabamento: servicos.filter((s) => ids.includes(s.id)),
          // Mesmo insumo em duas linhas (cós e barra) sai num total só.
          itens: juntarItensDaFicha(
            (f?.itens ?? []).map((i) => ({
              insumoId: i.insumoId,
              corFixaId: i.corFixaId,
              consumoPorPeca: Number(i.consumoPorPeca),
              porTamanho: (i.porTamanho as Record<string, number> | null) ?? null,
              etapa: i.etapa,
              observacao: i.observacao,
              uso: i.uso,
              nome: i.insumo.nome,
              tipo: i.insumo.tipo,
              unidade: i.insumo.unidade,
              cor: i.corFixa?.nome ?? null,
            })),
          ),
        };
      }),
      // O risco mais recente de cada material (tecido, ribana).
      riscos: (['TECIDO', 'RIBANA'] as const)
        .map((m) => op.encaixes.find((j) => materialDe(j.entrada) === m))
        .filter((j): j is NonNullable<typeof j> => !!j)
        .map((j) => {
          const e = j.entrada as {
            composicao?: Array<{ linha?: string; tamanho: string; quantidade: number }>;
          };
          return {
            material: materialDe(j.entrada),
            linha: rotuloLinhas(j.entrada),
            composicao: e.composicao ?? [],
            resultado: j.resultado,
            concluidoEm: j.concluidoEm,
          };
        }),
    };
  }
}
