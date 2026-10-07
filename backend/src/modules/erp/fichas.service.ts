import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { BusinessRuleException, NotFoundException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { EstoqueService } from './estoque.service';
import type { FaccaoDto, FichaDto, PrecosFaccaoDto, RegrasEncaixeDto } from './fichas.dto';

const D = (v: number, casas: number) => new Prisma.Decimal(v.toFixed(casas));
const num = (v: Prisma.Decimal | null) => (v === null ? null : Number(v));

/**
 * Custo PREVISTO por peça de uma grade: Σ consumo × custo médio do insumo +
 * facção prevista. É o "previsto pela ficha" da calculadora de precificação e
 * a base da simulação da OP. Insumo sem custo médio (nunca comprado) conta 0 —
 * e a tela avisa.
 */
export function custoPrevistoDaFicha(
  itens: Array<{ consumoPorPeca: number; custoMedio: number }>,
  custoFaccao: number | null,
): { insumos: number; faccao: number; total: number } {
  const insumos = itens.reduce((s, i) => s + i.consumoPorPeca * i.custoMedio, 0);
  const faccao = custoFaccao ?? 0;
  return { insumos, faccao, total: insumos + faccao };
}

/**
 * Custo por unidade de um item da ficha: cor fixada → o custo DAQUELA cor;
 * senão o custo do insumo (com cores, é a média das cores com custo).
 */
export function custoDoItem(item: {
  corFixaId: string | null;
  insumo: {
    custoMedio: Prisma.Decimal | number;
    cores: Array<{ corId: string; custoMedio: Prisma.Decimal | number }>;
  };
}): number {
  if (item.corFixaId) {
    const c = item.insumo.cores.find((x) => x.corId === item.corFixaId);
    if (c) return Number(c.custoMedio);
  }
  return Number(item.insumo.custoMedio);
}

const CORES_DO_INSUMO = {
  where: { ativo: true },
  select: { corId: true, custoMedio: true, cor: { select: { nome: true, hex: true } } },
} as const;

/**
 * ERP próprio · entrega 3 — ficha técnica (consumo médio por grade) e facções.
 * Gate: `config.erpInterno.ativo` (EstoqueService.empresaLigada).
 */
@Injectable()
export class FichasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly erp: EstoqueService,
  ) {}

  // ─── Ficha técnica ──────────────────────────────────────────────────────

  private async linhaDaEmpresa(empresaId: string, modeloLinhaId: string) {
    const ml = await this.prisma.catalogoModeloLinha.findFirst({
      where: { id: modeloLinhaId, modelo: { empresaId } },
      select: {
        id: true,
        modelo: { select: { id: true, nome: true } },
        linha: { select: { nome: true } },
      },
    });
    if (!ml) throw new NotFoundException('Linha do modelo', modeloLinhaId);
    return ml;
  }

  /** Resumo de todas as grades: tem ficha? quanto custa prevista? */
  async listar(user: AuthenticatedUser) {
    const empresaId = await this.erp.empresaLigada(user);
    const linhas = await this.prisma.catalogoModeloLinha.findMany({
      where: { modelo: { empresaId } },
      select: {
        id: true,
        modelo: { select: { id: true, nome: true, ordem: true } },
        linha: { select: { nome: true, ordem: true } },
      },
    });
    const prev = await this.custosPrevistos(
      empresaId,
      linhas.map((l) => l.id),
    );
    return linhas
      .sort(
        (a, b) =>
          a.modelo.ordem - b.modelo.ordem ||
          a.modelo.nome.localeCompare(b.modelo.nome) ||
          a.linha.ordem - b.linha.ordem,
      )
      .map((l) => ({
        modeloLinhaId: l.id,
        modelo: { id: l.modelo.id, nome: l.modelo.nome },
        linha: l.linha.nome,
        custoPrevisto: prev.get(l.id) ?? null,
      }));
  }

  async obter(user: AuthenticatedUser, modeloLinhaId: string) {
    const empresaId = await this.erp.empresaLigada(user);
    const ml = await this.linhaDaEmpresa(empresaId, modeloLinhaId);
    const ficha = await this.prisma.fichaTecnica.findUnique({
      where: { modeloLinhaId },
      include: {
        itens: {
          include: {
            insumo: {
              select: {
                id: true,
                nome: true,
                cor: true,
                unidade: true,
                tipo: true,
                custoMedio: true,
                cores: CORES_DO_INSUMO,
              },
            },
            corFixa: { select: { id: true, nome: true, hex: true } },
          },
        },
      },
    });
    const itens = (ficha?.itens ?? []).map((i) => {
      const consumo = Number(i.consumoPorPeca);
      const custoMedio = custoDoItem(i);
      const { cores, ...insumo } = i.insumo;
      return {
        insumoId: i.insumoId,
        insumo: {
          ...insumo,
          custoMedio,
          cores: cores.map((c) => ({ corId: c.corId, nome: c.cor.nome, hex: c.cor.hex })),
        },
        consumoPorPeca: consumo,
        observacao: i.observacao,
        /** Cor fixa (cordão sempre Branco). null = a cor da própria peça. */
        corFixa: i.corFixa,
        custoPorPeca: consumo * custoMedio,
      };
    });
    const custoFaccaoPrevisto = num(ficha?.custoFaccaoPrevisto ?? null);
    return {
      modeloLinhaId,
      modelo: ml.modelo,
      linha: ml.linha.nome,
      existe: Boolean(ficha),
      custoFaccaoPrevisto,
      observacoes: ficha?.observacoes ?? null,
      itens,
      custoPrevisto: custoPrevistoDaFicha(
        itens.map((i) => ({ consumoPorPeca: i.consumoPorPeca, custoMedio: i.insumo.custoMedio })),
        custoFaccaoPrevisto,
      ),
      semCusto: itens.filter((i) => i.insumo.custoMedio <= 0).map((i) => i.insumo.nome),
    };
  }

  async salvar(user: AuthenticatedUser, modeloLinhaId: string, dto: FichaDto) {
    const empresaId = await this.erp.empresaLigada(user);
    await this.linhaDaEmpresa(empresaId, modeloLinhaId);
    if (dto.itens.length) {
      const deles = await this.prisma.insumo.findMany({
        where: { empresaId, id: { in: dto.itens.map((i) => i.insumoId) } },
        select: {
          id: true,
          nome: true,
          cores: { where: { ativo: true }, select: { corId: true } },
        },
      });
      if (deles.length !== dto.itens.length) {
        throw new BusinessRuleException(
          'Algum insumo da ficha não existe nesta empresa',
          ErrorCode.BUSINESS_RULE_VIOLATION,
        );
      }
      // Cor fixa só existe pra insumo com cores, e tem que ser uma cor DELE.
      const porId = new Map(deles.map((d) => [d.id, d]));
      for (const i of dto.itens) {
        if (!i.corFixaId) continue;
        const ins = porId.get(i.insumoId)!;
        if (!ins.cores.some((c) => c.corId === i.corFixaId)) {
          throw new BusinessRuleException(
            ins.cores.length
              ? `${ins.nome}: a cor fixa não é uma das cores deste insumo`
              : `${ins.nome} não tem cores — tire a cor fixa`,
            ErrorCode.BUSINESS_RULE_VIOLATION,
          );
        }
      }
    }
    await this.prisma.$transaction(async (tx) => {
      const dados = {
        custoFaccaoPrevisto: dto.custoFaccaoPrevisto == null ? null : D(dto.custoFaccaoPrevisto, 2),
        observacoes: dto.observacoes ?? null,
      };
      const ficha = await tx.fichaTecnica.upsert({
        where: { modeloLinhaId },
        create: { empresaId, modeloLinhaId, ...dados },
        update: dados,
        select: { id: true },
      });
      await tx.fichaTecnicaItem.deleteMany({ where: { fichaId: ficha.id } });
      if (dto.itens.length) {
        await tx.fichaTecnicaItem.createMany({
          data: dto.itens.map((i) => ({
            fichaId: ficha.id,
            insumoId: i.insumoId,
            consumoPorPeca: D(i.consumoPorPeca, 4),
            observacao: i.observacao ?? null,
            corFixaId: i.corFixaId ?? null,
          })),
        });
      }
    });
    return this.obter(user, modeloLinhaId);
  }

  /**
   * Custo previsto por peça de várias grades de uma vez (calculadora, OP).
   * Sem flag de propósito: ficha só existe onde o ERP está ligado, e quem
   * chama já passou pelo gate dele.
   */
  async custosPrevistos(empresaId: string, modeloLinhaIds: string[]): Promise<Map<string, number>> {
    if (modeloLinhaIds.length === 0) return new Map();
    const fichas = await this.prisma.fichaTecnica.findMany({
      where: { empresaId, modeloLinhaId: { in: modeloLinhaIds } },
      select: {
        modeloLinhaId: true,
        custoFaccaoPrevisto: true,
        itens: {
          select: {
            consumoPorPeca: true,
            corFixaId: true,
            insumo: { select: { custoMedio: true, cores: CORES_DO_INSUMO } },
          },
        },
      },
    });
    return new Map(
      fichas.map((f) => [
        f.modeloLinhaId,
        custoPrevistoDaFicha(
          f.itens.map((i) => ({
            consumoPorPeca: Number(i.consumoPorPeca),
            custoMedio: custoDoItem(i),
          })),
          num(f.custoFaccaoPrevisto),
        ).total,
      ]),
    );
  }

  // ─── Regras de encaixe (por produto) ────────────────────────────────────

  private async modeloDaEmpresa(empresaId: string, modeloId: string) {
    const m = await this.prisma.catalogoModelo.findFirst({
      where: { id: modeloId, empresaId },
      select: { id: true, nome: true, regrasEncaixe: true },
    });
    if (!m) throw new NotFoundException('Modelo', modeloId);
    return m;
  }

  async regrasEncaixe(user: AuthenticatedUser, modeloId: string) {
    const empresaId = await this.erp.empresaLigada(user);
    const m = await this.modeloDaEmpresa(empresaId, modeloId);
    return { modeloId: m.id, regras: (m.regrasEncaixe as RegrasEncaixeDto | null) ?? null };
  }

  async salvarRegrasEncaixe(user: AuthenticatedUser, modeloId: string, dto: RegrasEncaixeDto) {
    const empresaId = await this.erp.empresaLigada(user);
    await this.modeloDaEmpresa(empresaId, modeloId);
    await this.prisma.catalogoModelo.update({
      where: { id: modeloId },
      data: { regrasEncaixe: dto as unknown as Prisma.InputJsonValue },
    });
    return { modeloId, regras: dto };
  }

  // ─── Facções ────────────────────────────────────────────────────────────

  private async faccaoDaEmpresa(empresaId: string, id: string) {
    const f = await this.prisma.faccao.findFirst({
      where: { id, empresaId },
      select: { id: true },
    });
    if (!f) throw new NotFoundException('Facção', id);
  }

  async listarFaccoes(user: AuthenticatedUser) {
    const empresaId = await this.erp.empresaLigada(user);
    const fs = await this.prisma.faccao.findMany({
      where: { empresaId },
      orderBy: [{ ativo: 'desc' }, { nome: 'asc' }],
      include: {
        precos: { include: { modelo: { select: { id: true, nome: true } } } },
      },
    });
    return fs.map((f) => ({
      id: f.id,
      nome: f.nome,
      contato: f.contato,
      telefone: f.telefone,
      especialidade: f.especialidade,
      observacoes: f.observacoes,
      ativo: f.ativo,
      precos: f.precos
        .map((p) => ({
          modeloId: p.modeloId,
          modelo: p.modelo.nome,
          precoPorPeca: Number(p.precoPorPeca),
        }))
        .sort((a, b) => a.modelo.localeCompare(b.modelo)),
    }));
  }

  async criarFaccao(user: AuthenticatedUser, dto: FaccaoDto) {
    const empresaId = await this.erp.empresaLigada(user);
    return this.prisma.faccao.create({
      data: {
        empresaId,
        nome: dto.nome,
        contato: dto.contato ?? null,
        telefone: dto.telefone ?? null,
        especialidade: dto.especialidade ?? null,
        observacoes: dto.observacoes ?? null,
        ativo: dto.ativo ?? true,
      },
      select: { id: true },
    });
  }

  async atualizarFaccao(user: AuthenticatedUser, id: string, dto: FaccaoDto) {
    const empresaId = await this.erp.empresaLigada(user);
    await this.faccaoDaEmpresa(empresaId, id);
    await this.prisma.faccao.update({
      where: { id },
      data: {
        nome: dto.nome,
        contato: dto.contato ?? null,
        telefone: dto.telefone ?? null,
        especialidade: dto.especialidade ?? null,
        observacoes: dto.observacoes ?? null,
        ...(dto.ativo !== undefined ? { ativo: dto.ativo } : {}),
      },
    });
    return { id };
  }

  async excluirFaccao(user: AuthenticatedUser, id: string) {
    const empresaId = await this.erp.empresaLigada(user);
    await this.faccaoDaEmpresa(empresaId, id);
    await this.prisma.faccao.delete({ where: { id } });
    return { ok: true };
  }

  async salvarPrecos(user: AuthenticatedUser, id: string, dto: PrecosFaccaoDto) {
    const empresaId = await this.erp.empresaLigada(user);
    await this.faccaoDaEmpresa(empresaId, id);
    if (dto.precos.length) {
      const deles = await this.prisma.catalogoModelo.count({
        where: { empresaId, id: { in: dto.precos.map((p) => p.modeloId) } },
      });
      if (deles !== dto.precos.length) {
        throw new BusinessRuleException(
          'Algum modelo da tabela não existe nesta empresa',
          ErrorCode.BUSINESS_RULE_VIOLATION,
        );
      }
    }
    await this.prisma.$transaction([
      this.prisma.faccaoPreco.deleteMany({ where: { faccaoId: id } }),
      this.prisma.faccaoPreco.createMany({
        data: dto.precos.map((p) => ({
          faccaoId: id,
          modeloId: p.modeloId,
          precoPorPeca: D(p.precoPorPeca, 2),
        })),
      }),
    ]);
    return { ok: true };
  }
}
