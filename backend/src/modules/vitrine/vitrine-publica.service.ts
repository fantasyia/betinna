import { pagamentoOnlineLigado } from '@modules/checkout/checkout.service';
import { Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { NotFoundException } from '@shared/errors/app-exception';
import { EstoqueService } from '@modules/erp/estoque.service';
import { VitrineFotosService } from './vitrine-fotos.service';
import { minimoDaVitrine } from './vitrine-pedido.service';

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
    // ERP próprio: com "respeita estoque", a vitrine diz quanto tem de cada
    // tamanho (esgotado apaga). Opcional pra quem monta o service à mão.
    @Optional() private readonly estoque?: EstoqueService,
  ) {}

  async carregar(slug: string) {
    const vitrine = await this.prisma.vitrine.findUnique({
      where: { slug },
      select: {
        ativa: true,
        minimoEntrada: true,
        minimoVolume: true,
        minimoAtacadao: true,
        respeitaEstoque: true,
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
          // Ponto da capa escolhido no cadastro pra bolinha (null = automático).
          amostra:
            c.amostraX !== null && c.amostraY !== null ? { x: c.amostraX, y: c.amostraY } : null,
          fotos: c.fotos.map((f) => ({
            url: this.fotos.urlPublica(f.storagePath),
            thumbUrl: this.fotos.urlPublica(f.thumbPath),
            largura: f.largura,
            altura: f.altura,
            // null = foto geral da cor; com id = foto daquela linha (biotipo).
            linhaId: f.linhaId,
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

    // Disponível por cor × tamanho, só com "respeita estoque" e ERP ligado.
    // Nada de id de produto: a chave é a mesma cor/tamanho que a vitrine já mostra.
    const respeita =
      vitrine.respeitaEstoque && this.estoque
        ? await this.estoque.vitrineRespeitaEstoque(empresaId)
        : false;
    const estoquePorModelo = new Map<string, Record<string, Record<string, number>>>();
    if (respeita && this.estoque) {
      const vs = await this.prisma.catalogoVariacao.findMany({
        where: { empresaId, ativo: true, modeloId: { in: publicos.map((m) => m.id) } },
        select: { modeloId: true, modeloCorId: true, modeloTamanhoId: true, produtoId: true },
      });
      const disp = await this.estoque.disponiveis(
        empresaId,
        vs.map((v) => v.produtoId),
      );
      for (const v of vs) {
        const m = estoquePorModelo.get(v.modeloId) ?? {};
        m[v.modeloCorId] = m[v.modeloCorId] ?? {};
        // Teto de exibição: ninguém precisa saber se tem 9.999 ou 50.000.
        m[v.modeloCorId][v.modeloTamanhoId] = Math.min(
          9999,
          Math.max(0, disp.get(v.produtoId) ?? 0),
        );
        estoquePorModelo.set(v.modeloId, m);
      }
    }

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
      // Pedido mínimo da empresa (R$ e/ou peças) — o envio confere de novo.
      pedidoMinimo: minimoDaVitrine(vitrine.empresa.config),
      // Aceita Pix/cartão pela vitrine (Asaas): o cliente sabe antes de enviar.
      pagamentoOnline: pagamentoOnlineLigado(vitrine.empresa.config),
      linhas,
      respeitaEstoque: respeita,
      modelos: publicos.map((m) => ({
        ...m,
        /** cor → tamanho → disponível. null = vitrine não controla estoque. */
        estoque: respeita ? (estoquePorModelo.get(m.id) ?? {}) : null,
      })),
    };
  }
}
