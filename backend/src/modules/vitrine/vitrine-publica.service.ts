import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { NotFoundException } from '@shared/errors/app-exception';
import { VitrineFotosService } from './vitrine-fotos.service';

const num = (v: Prisma.Decimal | null): number | null => (v === null ? null : Number(v));

/**
 * Vitrine PÚBLICA (sem login) — o que o cliente de atacado vê pelo link.
 *
 * 🔒 Só sai o que pode aparecer: vitrine ligada E no ar, modelo ativo, cor
 * ativa COM foto, linha e tamanho ativos. Nada de id de produto, SKU, estoque,
 * custo ou dado da empresa além de nome e logo — este endpoint é aberto.
 */
@Injectable()
export class VitrinePublicaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fotos: VitrineFotosService,
  ) {}

  async carregar(slug: string) {
    const vitrine = await this.prisma.vitrine.findUnique({
      where: { slug },
      select: {
        ativa: true,
        minimoEntrada: true,
        minimoVolume: true,
        minimoAtacadao: true,
        empresaId: true,
        empresa: { select: { nome: true, ativo: true, config: true } },
      },
    });
    // Desligada, inexistente ou empresa inativa: a mesma resposta (não revela
    // que o endereço existe).
    if (!vitrine || !vitrine.ativa || !vitrine.empresa.ativo) {
      throw new NotFoundException('Vitrine');
    }
    const empresaId = vitrine.empresaId;
    const branding = (
      (vitrine.empresa.config ?? {}) as { branding?: { nome?: string; logoUrl?: string } }
    ).branding;

    const modelos = await this.prisma.catalogoModelo.findMany({
      where: { empresaId, ativo: true },
      orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
      include: {
        categoria: true,
        cores: {
          orderBy: { ordem: 'asc' },
          where: { cor: { ativo: true }, fotos: { some: {} } },
          include: { cor: true, fotos: { orderBy: { ordem: 'asc' } } },
        },
        linhas: {
          where: { linha: { ativo: true } },
          include: {
            linha: true,
            tamanhos: { where: { tamanho: { ativo: true } }, include: { tamanho: true } },
          },
        },
        videos: { orderBy: { ordem: 'asc' } },
      },
    });

    const publicos = modelos
      .map((m) => ({
        id: m.id,
        nome: m.nome,
        categoria:
          m.categoria && m.categoria.ativo ? { id: m.categoria.id, nome: m.categoria.nome } : null,
        descricao: m.descricao,
        etiquetas: m.etiquetas,
        tituloMarketplace: m.tituloMarketplace,
        descricaoMarketplace: m.descricaoMarketplace,
        composicao: m.composicao,
        cores: m.cores.map((c) => ({
          id: c.id,
          nome: c.cor.nome,
          hex: c.cor.hex,
          fotos: c.fotos.map((f) => ({
            url: this.fotos.urlPublica(f.storagePath),
            thumbUrl: this.fotos.urlPublica(f.thumbPath),
            largura: f.largura,
            altura: f.altura,
          })),
        })),
        linhas: m.linhas
          .filter((l) => l.tamanhos.length > 0)
          .sort((a, b) => a.linha.ordem - b.linha.ordem || a.linha.nome.localeCompare(b.linha.nome))
          .map((l) => ({
            id: l.id,
            linhaId: l.linhaId,
            nome: l.linha.nome,
            tamanhos: l.tamanhos
              .sort(
                (a, b) =>
                  a.tamanho.ordem - b.tamanho.ordem || a.tamanho.nome.localeCompare(b.tamanho.nome),
              )
              .map((t) => ({ id: t.id, nome: t.tamanho.nome })),
            precoEntrada: num(l.precoEntrada),
            precoVolume: num(l.precoVolume),
            precoAtacadao: num(l.precoAtacadao),
            precoSugerido: num(l.precoSugerido),
            tabelaMedidas: l.tabelaMedidas,
          })),
        videos: m.videos.map((v) => ({
          url: this.fotos.urlPublica(v.storagePath),
          nomeArquivo: v.nomeArquivo,
          tamanhoBytes: v.tamanhoBytes,
        })),
      }))
      // Sem cor com foto ou sem grade: não aparece (§6 da especificação).
      .filter((m) => m.cores.length > 0 && m.linhas.length > 0);

    // Linhas e categorias da vitrine = só as que têm modelo publicado.
    const linhasMap = new Map<string, { id: string; nome: string }>();
    for (const m of modelos) {
      for (const l of m.linhas) {
        if (publicos.some((p) => p.id === m.id && p.linhas.some((x) => x.linhaId === l.linhaId))) {
          linhasMap.set(l.linhaId, { id: l.linhaId, nome: l.linha.nome });
        }
      }
    }
    const ordemLinha = new Map(
      modelos.flatMap((m) => m.linhas.map((l) => [l.linhaId, l.linha.ordem])),
    );
    const linhas = [...linhasMap.values()].sort(
      (a, b) => (ordemLinha.get(a.id) ?? 0) - (ordemLinha.get(b.id) ?? 0),
    );

    return {
      empresa: {
        nome: branding?.nome || vitrine.empresa.nome,
        logoUrl: branding?.logoUrl ?? null,
      },
      faixas: {
        minimoEntrada: vitrine.minimoEntrada,
        minimoVolume: vitrine.minimoVolume,
        minimoAtacadao: vitrine.minimoAtacadao,
      },
      linhas,
      modelos: publicos,
    };
  }
}
