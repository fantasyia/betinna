import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import {
  BusinessRuleException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { VitrineFotosService } from './vitrine-fotos.service';
import type {
  CorDto,
  LinhaDto,
  ModeloDto,
  TamanhoDto,
  VariacaoPatchDto,
  VitrineConfigDto,
} from './vitrine.dto';

type Tx = Prisma.TransactionClient;

/** Erro de unicidade do Prisma (P2002) — vira 409 legível. */
function ehUnicidade(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}
/** Erro de chave estrangeira (P2003) — item ainda em uso. */
function ehEmUso(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003';
}

const modeloInclude = {
  cores: {
    orderBy: { ordem: 'asc' },
    include: {
      cor: true,
      fotos: { orderBy: { ordem: 'asc' } },
    },
  },
  linhas: {
    include: {
      linha: true,
      tamanhos: { include: { tamanho: true } },
    },
  },
  videos: { orderBy: { ordem: 'asc' } },
  variacoes: {
    where: { ativo: true },
    select: {
      id: true,
      modeloCorId: true,
      modeloTamanhoId: true,
      sku: true,
      estoque: true,
      produtoId: true,
    },
  },
} satisfies Prisma.CatalogoModeloInclude;

/**
 * Vitrine de atacado — Fase 1: cadastro do lado da EMPRESA.
 *
 * 🔒 ISOLAMENTO: toda operação de catálogo exige que a empresa ativa tenha a
 * vitrine ligada (linha em `Vitrine`). Empresa sem ela recebe 422 e nada é
 * lido ou gravado — é o que garante "zero mudança" pra Somatec e Assessoria.
 * A única porta de entrada é `salvarConfig`, que CRIA a linha.
 *
 * A VARIAÇÃO (modelo × cor × linha × tamanho) é materializada e ganha um
 * `Produto` comum: é por ele que o pedido da vitrine entra no Betinna sem
 * mexer em Pedido/PedidoItem. Desmarcar cor/linha/tamanho DESATIVA o produto
 * (pedido antigo continua apontando pra ele) e remove a variação.
 */
@Injectable()
export class VitrineAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fotos: VitrineFotosService,
  ) {}

  /** Modelo pra tela: fotos e vídeos com a URL pública pronta. */
  private comUrls<
    M extends {
      cores: Array<{ fotos: Array<{ storagePath: string; thumbPath: string | null }> }>;
      videos: Array<{ storagePath: string }>;
    },
  >(m: M) {
    return {
      ...m,
      cores: m.cores.map((c) => ({ ...c, fotos: c.fotos.map((f) => this.fotos.comUrls(f)) })),
      videos: m.videos.map((v) => ({ ...v, url: this.fotos.urlPublica(v.storagePath) })),
    };
  }

  private requireEmpresa(user: AuthenticatedUser): string {
    const id = user.empresaIdAtiva ?? user.empresaIds?.[0];
    if (!id) throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    return id;
  }

  /** Empresa da sessão, desde que ela tenha a vitrine ligada. */
  private async empresaComVitrine(user: AuthenticatedUser): Promise<string> {
    const empresaId = this.requireEmpresa(user);
    const v = await this.prisma.vitrine.findUnique({
      where: { empresaId },
      select: { id: true },
    });
    if (!v) {
      throw new BusinessRuleException(
        'A vitrine de atacado não está ligada nesta empresa — configure o endereço primeiro',
      );
    }
    return empresaId;
  }

  // ─── Configuração (liga a vitrine) ──────────────────────────────────────

  async obterConfig(user: AuthenticatedUser) {
    const empresaId = this.requireEmpresa(user);
    return this.prisma.vitrine.findUnique({ where: { empresaId } });
  }

  async salvarConfig(user: AuthenticatedUser, dto: VitrineConfigDto) {
    const empresaId = this.requireEmpresa(user);
    const dados = {
      slug: dto.slug,
      ...(dto.ativa !== undefined ? { ativa: dto.ativa } : {}),
      ...(dto.minimoEntrada !== undefined ? { minimoEntrada: dto.minimoEntrada } : {}),
      ...(dto.minimoVolume !== undefined ? { minimoVolume: dto.minimoVolume } : {}),
      ...(dto.minimoAtacadao !== undefined ? { minimoAtacadao: dto.minimoAtacadao } : {}),
    };
    this.validarFaixas({
      minimoEntrada: dto.minimoEntrada,
      minimoVolume: dto.minimoVolume,
      minimoAtacadao: dto.minimoAtacadao,
    });
    try {
      return await this.prisma.vitrine.upsert({
        where: { empresaId },
        create: { empresaId, ...dados },
        update: dados,
      });
    } catch (err) {
      if (ehUnicidade(err)) {
        throw new ConflictException(`O endereço "${dto.slug}" já é usado por outra empresa`);
      }
      throw err;
    }
  }

  /** As faixas têm que subir: Entrada < Volume < 500+. Null não entra na conta. */
  private validarFaixas(f: {
    minimoEntrada?: number | null;
    minimoVolume?: number | null;
    minimoAtacadao?: number | null;
  }): void {
    const seq = [f.minimoEntrada, f.minimoVolume, f.minimoAtacadao].filter(
      (n): n is number => typeof n === 'number',
    );
    for (let i = 1; i < seq.length; i++) {
      if (seq[i] <= seq[i - 1]) {
        throw new BusinessRuleException(
          'Os mínimos das faixas têm que crescer: Entrada < Volume < 500+',
        );
      }
    }
  }

  // ─── Cores ──────────────────────────────────────────────────────────────

  async listarCores(user: AuthenticatedUser) {
    const empresaId = await this.empresaComVitrine(user);
    return this.prisma.catalogoCor.findMany({
      where: { empresaId },
      orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
    });
  }

  async criarCor(user: AuthenticatedUser, dto: CorDto) {
    const empresaId = await this.empresaComVitrine(user);
    try {
      return await this.prisma.catalogoCor.create({
        data: {
          empresaId,
          nome: dto.nome,
          hex: dto.hex.toUpperCase(),
          ordem: dto.ordem ?? 0,
          ativo: dto.ativo ?? true,
        },
      });
    } catch (err) {
      if (ehUnicidade(err)) throw new ConflictException(`Já existe a cor "${dto.nome}"`);
      throw err;
    }
  }

  async atualizarCor(user: AuthenticatedUser, id: string, dto: CorDto) {
    const empresaId = await this.empresaComVitrine(user);
    await this.garantirDaEmpresa('catalogoCor', id, empresaId);
    try {
      const cor = await this.prisma.catalogoCor.update({
        where: { id },
        data: {
          nome: dto.nome,
          hex: dto.hex.toUpperCase(),
          ...(dto.ordem !== undefined ? { ordem: dto.ordem } : {}),
          ...(dto.ativo !== undefined ? { ativo: dto.ativo } : {}),
        },
      });
      // Nome da cor entra no nome do produto da variação: renomear a cor
      // renomeia os produtos dos modelos que a usam.
      await this.ressincronizarModelosQueUsam(empresaId, { corId: id });
      return cor;
    } catch (err) {
      if (ehUnicidade(err)) throw new ConflictException(`Já existe a cor "${dto.nome}"`);
      throw err;
    }
  }

  async excluirCor(user: AuthenticatedUser, id: string) {
    const empresaId = await this.empresaComVitrine(user);
    await this.garantirDaEmpresa('catalogoCor', id, empresaId);
    try {
      await this.prisma.catalogoCor.delete({ where: { id } });
      return { ok: true };
    } catch (err) {
      if (ehEmUso(err)) {
        throw new BusinessRuleException(
          'Essa cor está em uso num modelo — desmarque nos modelos ou desative a cor',
        );
      }
      throw err;
    }
  }

  // ─── Linhas e tamanhos ──────────────────────────────────────────────────

  async listarLinhas(user: AuthenticatedUser) {
    const empresaId = await this.empresaComVitrine(user);
    return this.prisma.catalogoLinha.findMany({
      where: { empresaId },
      orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
      include: { tamanhos: { orderBy: [{ ordem: 'asc' }, { nome: 'asc' }] } },
    });
  }

  async criarLinha(user: AuthenticatedUser, dto: LinhaDto) {
    const empresaId = await this.empresaComVitrine(user);
    try {
      return await this.prisma.catalogoLinha.create({
        data: { empresaId, nome: dto.nome, ordem: dto.ordem ?? 0, ativo: dto.ativo ?? true },
        include: { tamanhos: true },
      });
    } catch (err) {
      if (ehUnicidade(err)) throw new ConflictException(`Já existe a linha "${dto.nome}"`);
      throw err;
    }
  }

  async atualizarLinha(user: AuthenticatedUser, id: string, dto: LinhaDto) {
    const empresaId = await this.empresaComVitrine(user);
    await this.garantirDaEmpresa('catalogoLinha', id, empresaId);
    try {
      const linha = await this.prisma.catalogoLinha.update({
        where: { id },
        data: {
          nome: dto.nome,
          ...(dto.ordem !== undefined ? { ordem: dto.ordem } : {}),
          ...(dto.ativo !== undefined ? { ativo: dto.ativo } : {}),
        },
        include: { tamanhos: { orderBy: [{ ordem: 'asc' }, { nome: 'asc' }] } },
      });
      await this.ressincronizarModelosQueUsam(empresaId, { linhaId: id });
      return linha;
    } catch (err) {
      if (ehUnicidade(err)) throw new ConflictException(`Já existe a linha "${dto.nome}"`);
      throw err;
    }
  }

  async criarTamanho(user: AuthenticatedUser, linhaId: string, dto: TamanhoDto) {
    const empresaId = await this.empresaComVitrine(user);
    await this.garantirDaEmpresa('catalogoLinha', linhaId, empresaId);
    try {
      return await this.prisma.catalogoTamanho.create({
        data: { linhaId, nome: dto.nome, ordem: dto.ordem ?? 0, ativo: dto.ativo ?? true },
      });
    } catch (err) {
      if (ehUnicidade(err)) {
        throw new ConflictException(`Essa linha já tem o tamanho "${dto.nome}"`);
      }
      throw err;
    }
  }

  async atualizarTamanho(user: AuthenticatedUser, id: string, dto: TamanhoDto) {
    const empresaId = await this.empresaComVitrine(user);
    const tam = await this.prisma.catalogoTamanho.findFirst({
      where: { id, linha: { empresaId } },
      select: { id: true, linhaId: true },
    });
    if (!tam) throw new NotFoundException('Tamanho', id);
    try {
      const atualizado = await this.prisma.catalogoTamanho.update({
        where: { id },
        data: {
          nome: dto.nome,
          ...(dto.ordem !== undefined ? { ordem: dto.ordem } : {}),
          ...(dto.ativo !== undefined ? { ativo: dto.ativo } : {}),
        },
      });
      await this.ressincronizarModelosQueUsam(empresaId, { linhaId: tam.linhaId });
      return atualizado;
    } catch (err) {
      if (ehUnicidade(err)) {
        throw new ConflictException(`Essa linha já tem o tamanho "${dto.nome}"`);
      }
      throw err;
    }
  }

  // ─── Modelos ────────────────────────────────────────────────────────────

  async listarModelos(user: AuthenticatedUser) {
    const empresaId = await this.empresaComVitrine(user);
    const modelos = await this.prisma.catalogoModelo.findMany({
      where: { empresaId },
      orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
      include: modeloInclude,
    });
    return modelos.map((m) => this.comUrls(m));
  }

  async obterModelo(user: AuthenticatedUser, id: string) {
    const empresaId = await this.empresaComVitrine(user);
    const m = await this.prisma.catalogoModelo.findFirst({
      where: { id, empresaId },
      include: modeloInclude,
    });
    if (!m) throw new NotFoundException('Modelo', id);
    return this.comUrls(m);
  }

  async criarModelo(user: AuthenticatedUser, dto: ModeloDto) {
    const empresaId = await this.empresaComVitrine(user);
    await this.validarReferencias(empresaId, dto);
    const id = await this.prisma.$transaction(
      async (tx) => {
        const m = await tx.catalogoModelo.create({
          data: {
            empresaId,
            nome: dto.nome,
            categoria: dto.categoria ?? null,
            descricao: dto.descricao ?? null,
            etiquetas: dto.etiquetas ?? [],
            ordem: dto.ordem ?? 0,
            ativo: dto.ativo ?? true,
            tituloMarketplace: dto.tituloMarketplace ?? null,
            descricaoMarketplace: dto.descricaoMarketplace ?? null,
            composicao: dto.composicao ?? null,
          },
          select: { id: true },
        });
        await this.aplicarGrade(tx, m.id, dto);
        await this.sincronizarVariacoes(tx, empresaId, m.id);
        return m.id;
      },
      { timeout: 30_000 },
    );
    return this.obterModelo(user, id);
  }

  async atualizarModelo(user: AuthenticatedUser, id: string, dto: ModeloDto) {
    const empresaId = await this.empresaComVitrine(user);
    await this.garantirDaEmpresa('catalogoModelo', id, empresaId);
    await this.validarReferencias(empresaId, dto);
    await this.prisma.$transaction(
      async (tx) => {
        await tx.catalogoModelo.update({
          where: { id },
          data: {
            nome: dto.nome,
            categoria: dto.categoria ?? null,
            descricao: dto.descricao ?? null,
            ...(dto.etiquetas !== undefined ? { etiquetas: dto.etiquetas } : {}),
            ...(dto.ordem !== undefined ? { ordem: dto.ordem } : {}),
            ...(dto.ativo !== undefined ? { ativo: dto.ativo } : {}),
            ...(dto.tituloMarketplace !== undefined
              ? { tituloMarketplace: dto.tituloMarketplace }
              : {}),
            ...(dto.descricaoMarketplace !== undefined
              ? { descricaoMarketplace: dto.descricaoMarketplace }
              : {}),
            ...(dto.composicao !== undefined ? { composicao: dto.composicao } : {}),
          },
        });
        await this.aplicarGrade(tx, id, dto);
        await this.sincronizarVariacoes(tx, empresaId, id);
      },
      { timeout: 30_000 },
    );
    return this.obterModelo(user, id);
  }

  async atualizarVariacao(user: AuthenticatedUser, id: string, dto: VariacaoPatchDto) {
    const empresaId = await this.empresaComVitrine(user);
    const v = await this.prisma.catalogoVariacao.findFirst({
      where: { id, empresaId },
      select: { id: true, produtoId: true },
    });
    if (!v) throw new NotFoundException('Variação', id);
    try {
      return await this.prisma.$transaction(async (tx) => {
        if (dto.sku !== undefined) {
          // O SKU vive nos dois: na variação (cadastro) e no produto (pedido/ERP).
          await tx.produto.update({ where: { id: v.produtoId }, data: { sku: dto.sku } });
        }
        return tx.catalogoVariacao.update({
          where: { id },
          data: {
            ...(dto.sku !== undefined ? { sku: dto.sku } : {}),
            ...(dto.estoque !== undefined ? { estoque: dto.estoque } : {}),
          },
        });
      });
    } catch (err) {
      if (ehUnicidade(err))
        throw new ConflictException(`O SKU "${dto.sku}" já existe nesta empresa`);
      throw err;
    }
  }

  // ─── Núcleo: grade e variações ──────────────────────────────────────────

  /**
   * Toda cor, linha e tamanho citado no modelo tem que ser DESTA empresa — e o
   * tamanho, da linha em que foi marcado. Sem isto um id de outra empresa
   * entraria pela grade.
   */
  private async validarReferencias(empresaId: string, dto: ModeloDto): Promise<void> {
    const corIds = dto.corIds ?? [];
    if (corIds.length) {
      const n = await this.prisma.catalogoCor.count({ where: { id: { in: corIds }, empresaId } });
      if (n !== corIds.length) throw new BusinessRuleException('Cor inválida para esta empresa');
    }
    for (const l of dto.linhas ?? []) {
      const linha = await this.prisma.catalogoLinha.findFirst({
        where: { id: l.linhaId, empresaId },
        select: { id: true },
      });
      if (!linha) throw new BusinessRuleException('Linha inválida para esta empresa');
      const n = await this.prisma.catalogoTamanho.count({
        where: { id: { in: l.tamanhoIds }, linhaId: l.linhaId },
      });
      if (n !== new Set(l.tamanhoIds).size) {
        throw new BusinessRuleException('Tamanho que não pertence à linha escolhida');
      }
    }
  }

  /**
   * Aplica cores/linhas/tamanhos marcados. Upsert por chave natural, pra que
   * as FOTOS (presas à cor do modelo) sobrevivam a uma edição. O que foi
   * desmarcado sai — antes, os produtos das variações dele são desativados.
   * Campo ausente no DTO = não mexe naquela parte.
   */
  private async aplicarGrade(tx: Tx, modeloId: string, dto: ModeloDto): Promise<void> {
    if (dto.corIds) {
      const atuais = await tx.catalogoModeloCor.findMany({
        where: { modeloId },
        select: { id: true, corId: true },
      });
      const sai = atuais.filter((a) => !dto.corIds!.includes(a.corId)).map((a) => a.id);
      if (sai.length) {
        await this.desativarProdutosDas(tx, { modeloCorId: { in: sai } });
        await tx.catalogoModeloCor.deleteMany({ where: { id: { in: sai } } });
      }
      for (const [ordem, corId] of dto.corIds.entries()) {
        await tx.catalogoModeloCor.upsert({
          where: { modeloId_corId: { modeloId, corId } },
          create: { modeloId, corId, ordem },
          update: { ordem },
        });
      }
    }

    if (dto.linhas) {
      const novas = dto.linhas.map((l) => l.linhaId);
      const atuais = await tx.catalogoModeloLinha.findMany({
        where: { modeloId },
        select: { id: true, linhaId: true },
      });
      const sai = atuais.filter((a) => !novas.includes(a.linhaId)).map((a) => a.id);
      if (sai.length) {
        await this.desativarProdutosDas(tx, { modeloLinhaId: { in: sai } });
        await tx.catalogoModeloLinha.deleteMany({ where: { id: { in: sai } } });
      }
      for (const l of dto.linhas) {
        const precos = {
          precoEntrada: l.precoEntrada ?? null,
          precoVolume: l.precoVolume ?? null,
          precoAtacadao: l.precoAtacadao ?? null,
          precoSugerido: l.precoSugerido ?? null,
          // Json nullable: "sem tabela" é DbNull, não o JSON `null`.
          tabelaMedidas: l.tabelaMedidas ?? Prisma.DbNull,
        };
        const ml = await tx.catalogoModeloLinha.upsert({
          where: { modeloId_linhaId: { modeloId, linhaId: l.linhaId } },
          create: { modeloId, linhaId: l.linhaId, ...precos },
          update: precos,
          select: { id: true },
        });
        const tamAtuais = await tx.catalogoModeloTamanho.findMany({
          where: { modeloLinhaId: ml.id },
          select: { id: true, tamanhoId: true },
        });
        const tamSai = tamAtuais
          .filter((t) => !l.tamanhoIds.includes(t.tamanhoId))
          .map((t) => t.id);
        if (tamSai.length) {
          await this.desativarProdutosDas(tx, { modeloTamanhoId: { in: tamSai } });
          await tx.catalogoModeloTamanho.deleteMany({ where: { id: { in: tamSai } } });
        }
        const jaTem = new Set(tamAtuais.map((t) => t.tamanhoId));
        const entram = [...new Set(l.tamanhoIds)].filter((t) => !jaTem.has(t));
        if (entram.length) {
          await tx.catalogoModeloTamanho.createMany({
            data: entram.map((tamanhoId) => ({ modeloLinhaId: ml.id, tamanhoId })),
          });
        }
      }
    }
  }

  /** Desativa o produto das variações que vão sair (o pedido antigo segue apontando). */
  private async desativarProdutosDas(
    tx: Tx,
    where: Prisma.CatalogoVariacaoWhereInput,
  ): Promise<void> {
    const vs = await tx.catalogoVariacao.findMany({ where, select: { produtoId: true } });
    if (vs.length) {
      await tx.produto.updateMany({
        where: { id: { in: vs.map((v) => v.produtoId) } },
        data: { ativo: false },
      });
    }
  }

  /**
   * Garante uma variação (e um produto) pra cada cor × tamanho marcado, e
   * mantém o produto em dia: nome, linha, categoria, preço de tabela (= preço
   * da faixa Entrada, 0 quando "sob consulta") e ativo (= modelo ativo).
   */
  private async sincronizarVariacoes(tx: Tx, empresaId: string, modeloId: string): Promise<void> {
    const m = await tx.catalogoModelo.findUniqueOrThrow({
      where: { id: modeloId },
      include: {
        cores: { include: { cor: true } },
        linhas: { include: { linha: true, tamanhos: { include: { tamanho: true } } } },
        variacoes: true,
      },
    });
    const existentes = new Map(
      m.variacoes.map((v) => [`${v.modeloCorId}|${v.modeloTamanhoId}`, v]),
    );
    for (const mc of m.cores) {
      for (const ml of m.linhas) {
        for (const mt of ml.tamanhos) {
          const nome = `${m.nome} · ${mc.cor.nome} · ${ml.linha.nome} ${mt.tamanho.nome}`;
          const dadosProduto = {
            nome,
            linha: ml.linha.nome,
            categoria: m.categoria,
            precoTabela: ml.precoEntrada ?? new Prisma.Decimal(0),
            ativo: m.ativo && mc.cor.ativo && ml.linha.ativo && mt.tamanho.ativo,
          };
          const v = existentes.get(`${mc.id}|${mt.id}`);
          if (v) {
            await tx.produto.update({ where: { id: v.produtoId }, data: dadosProduto });
            if (!v.ativo) {
              await tx.catalogoVariacao.update({ where: { id: v.id }, data: { ativo: true } });
            }
            continue;
          }
          const produto = await tx.produto.create({
            data: {
              empresaId,
              ...dadosProduto,
              atributos: { origem: 'vitrine', modeloId: m.id },
            },
            select: { id: true },
          });
          await tx.catalogoVariacao.create({
            data: {
              empresaId,
              modeloId: m.id,
              modeloCorId: mc.id,
              modeloLinhaId: ml.id,
              modeloTamanhoId: mt.id,
              produtoId: produto.id,
            },
          });
        }
      }
    }
  }

  /** Renomeou cor/linha/tamanho → reescreve o nome dos produtos que a usam. */
  private async ressincronizarModelosQueUsam(
    empresaId: string,
    alvo: { corId?: string; linhaId?: string },
  ): Promise<void> {
    const modelos = await this.prisma.catalogoModelo.findMany({
      where: {
        empresaId,
        ...(alvo.corId ? { cores: { some: { corId: alvo.corId } } } : {}),
        ...(alvo.linhaId ? { linhas: { some: { linhaId: alvo.linhaId } } } : {}),
      },
      select: { id: true },
    });
    for (const m of modelos) {
      await this.prisma.$transaction((tx) => this.sincronizarVariacoes(tx, empresaId, m.id), {
        timeout: 30_000,
      });
    }
  }

  private async garantirDaEmpresa(
    modelo: 'catalogoCor' | 'catalogoLinha' | 'catalogoModelo',
    id: string,
    empresaId: string,
  ): Promise<void> {
    const delegate = this.prisma[modelo] as unknown as {
      findFirst(args: { where: { id: string; empresaId: string }; select: { id: true } }): Promise<{
        id: string;
      } | null>;
    };
    const row = await delegate.findFirst({ where: { id, empresaId }, select: { id: true } });
    if (!row) {
      const nome = { catalogoCor: 'Cor', catalogoLinha: 'Linha', catalogoModelo: 'Modelo' }[modelo];
      throw new NotFoundException(nome, id);
    }
  }
}
