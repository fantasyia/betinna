import { pagamentoOnlineLigado } from '@modules/checkout/checkout.service';
import { Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { NotFoundException } from '@shared/errors/app-exception';
import { EstoqueService } from '@modules/erp/estoque.service';
import { VitrineFotosService } from './vitrine-fotos.service';
import { minimoDaVitrine } from './vitrine-pedido.service';
import { configFrete } from './frete';
import { privacidadePublicada } from './privacidade.service';
import { pixelLigado } from './meta-pixel.service';

/** O que a vitrine pública precisa saber do frete (sem CEP de origem nem caixas). */
function freteDaVitrine(config: unknown) {
  const f = configFrete(config);
  if (!f.ativo) return null;
  const r = f.retirada;
  const retira = !!(r?.ativo && r.endereco?.trim() && r.minimoPecas);
  // O endereço de retirada é da EMPRESA (o cliente vai buscar lá): público.
  return {
    retiradaMinimoPecas: retira ? (r?.minimoPecas ?? null) : null,
    retiradaEndereco: retira ? (r?.endereco ?? null) : null,
    retiradaHorario: retira ? (r?.horario ?? null) : null,
  };
}

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
      (vitrine.empresa.config ?? {}) as {
        branding?: { nome?: string; logoUrl?: string; iconeUrl?: string };
      }
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
        // Pares do conjunto (os dois sentidos) — ver `paresDoConjunto` abaixo.
        combinaCom: m.combinaCom,
        tituloMarketplace: m.tituloMarketplace,
        descricaoMarketplace: m.descricaoMarketplace,
        composicao: m.composicao,
        cores: m.cores.map((c) => ({
          id: c.id,
          // Cor da LISTA da empresa: é ela que diz "mesma cor" entre modelos.
          corId: c.corId,
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
            // Pode abrir a vitrine (rodízio por cliente).
            rodizio: f.rodizio,
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
              // tamanhoId: o tamanho da LISTA da linha — "mesmo tamanho" entre modelos.
              .map((t) => ({ id: t.id, tamanhoId: t.tamanhoId, nome: t.tamanho.nome })),
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
    const linhasMap = new Map<string, { id: string; nome: string; selo: string | null }>();
    for (const m of modelos) {
      for (const l of m.linhas) {
        if (publicos.some((p) => p.id === m.id && p.linhas.some((x) => x.linhaId === l.linhaId))) {
          // Selo da linha (Plus Size de verdade…) — aparece quando o lojista a escolhe.
          linhasMap.set(l.linhaId, { id: l.linhaId, nome: l.linha.nome, selo: l.linha.selo });
        }
      }
    }
    const ordemLinha = new Map(
      modelos.flatMap((m) => m.linhas.map((l) => [l.linhaId, l.linha.ordem])),
    );
    const linhas = [...linhasMap.values()].sort(
      (a, b) => (ordemLinha.get(a.id) ?? 0) - (ordemLinha.get(b.id) ?? 0),
    );

    const pares = paresDoConjunto(publicos);
    return {
      empresa: {
        nome: branding?.nome || vitrine.empresa.nome,
        logoUrl: branding?.logoUrl ?? null,
        // Símbolo da marca (o passarinho da Ribelt) ao lado do logo, no topo.
        simboloUrl: branding?.iconeUrl?.trim() || null,
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
      // Frete cobrado no pedido (Melhor Envio): a tela pede CEP e cota.
      frete: freteDaVitrine(vitrine.empresa.config),
      // Link "Política de privacidade" na vitrine (só quando publicada).
      privacidade: privacidadePublicada(vitrine.empresa.config),
      // Pixel do Meta (ID é público; o token da CAPI nunca sai do servidor).
      pixel: pixelLigado(vitrine.empresa.config),
      linhas,
      respeitaEstoque: respeita,
      modelos: publicos.map((m) => ({
        ...m,
        combinaCom: pares.get(m.id) ?? [],
        /** cor → tamanho → disponível. null = vitrine não controla estoque. */
        estoque: respeita ? (estoquePorModelo.get(m.id) ?? {}) : null,
      })),
    };
  }
}

/**
 * "Combina com" nos DOIS sentidos e só entre modelos que estão na vitrine:
 * ligar a blusa à calça já faz a calça sugerir a blusa. PURO.
 */
export function paresDoConjunto<T extends { id: string; combinaCom?: string[] | null }>(
  modelos: T[],
): Map<string, string[]> {
  const ids = new Set(modelos.map((m) => m.id));
  const pares = new Map<string, Set<string>>(modelos.map((m) => [m.id, new Set<string>()]));
  for (const m of modelos) {
    for (const outro of m.combinaCom ?? []) {
      if (outro === m.id || !ids.has(outro)) continue;
      pares.get(m.id)!.add(outro);
      pares.get(outro)!.add(m.id);
    }
  }
  return new Map([...pares].map(([k, v]) => [k, [...v]]));
}
