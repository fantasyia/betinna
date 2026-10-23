import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { BusinessRuleException, NotFoundException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { EstoqueService } from './estoque.service';
import type {
  AcabamentoDto,
  FaccaoDto,
  FichaDto,
  PrecosFaccaoDto,
  RegrasEncaixeDto,
} from './fichas.dto';
import {
  acabamentoPorPeca,
  idDoServico,
  servicosAcabamento,
  custoCortePorPeca,
  fretePorOp,
} from './acabamento';

const D = (v: number, casas: number) => new Prisma.Decimal(v.toFixed(casas));
const num = (v: Prisma.Decimal | null) => (v === null ? null : Number(v));

/**
 * Custo PREVISTO por peça de uma grade: Σ consumo × custo médio do insumo +
 * facção prevista + acabamento + corte. É o "previsto pela ficha" da calculadora de precificação e
 * a base da simulação da OP. Insumo sem custo médio (nunca comprado) conta 0 —
 * e a tela avisa.
 */
export function custoPrevistoDaFicha(
  itens: Array<{ consumoPorPeca: number; custoMedio: number }>,
  custoFaccao: number | null,
  /** Acabamento por peça (serviços da Isabela, 14/10). */
  acabamento = 0,
  /** Corte por peça (Léo, 20/10), da config da empresa. */
  corte = 0,
): { insumos: number; faccao: number; acabamento: number; corte: number; total: number } {
  const insumos = itens.reduce((s, i) => s + i.consumoPorPeca * i.custoMedio, 0);
  const faccao = custoFaccao ?? 0;
  return { insumos, faccao, acabamento, corte, total: insumos + faccao + acabamento + corte };
}

const temTamanhos = (v: Record<string, number> | null | undefined) =>
  !!v && Object.keys(v).length > 0;

/** Média das quantidades por tamanho — vira o consumo médio da grade. PURO. */
export function mediaPorTamanho(porTamanho: Record<string, number>): number {
  const vs = Object.values(porTamanho);
  return vs.length ? vs.reduce((s, v) => s + v, 0) / vs.length : 0;
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
        tamanhos: { select: { tamanho: { select: { nome: true, ordem: true } } } },
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
        porTamanho: (i.porTamanho as Record<string, number> | null) ?? null,
        etapa: i.etapa,
        observacao: i.observacao,
        /** Cor fixa (cordão sempre Branco). null = a cor da própria peça. */
        corFixa: i.corFixa,
        custoPorPeca: consumo * custoMedio,
      };
    });
    const custoFaccaoPrevisto = num(ficha?.custoFaccaoPrevisto ?? null);
    const servicos = await this.servicosDaEmpresa(empresaId);
    const corte = await this.corteDaEmpresa(empresaId);
    const acabamento = Array.isArray(ficha?.acabamento) ? (ficha!.acabamento as string[]) : [];
    return {
      modeloLinhaId,
      /** Serviços de acabamento marcados nesta grade + a lista da empresa (pra marcar). */
      acabamento,
      servicosAcabamento: servicos,
      /** Custo de corte por peça da empresa (entra no previsto). */
      custoCortePorPeca: corte,
      modelo: ml.modelo,
      linha: ml.linha.nome,
      // Tamanhos da grade, na ordem — a tela mostra um campo por tamanho.
      tamanhos: [...ml.tamanhos]
        .sort((a, b) => a.tamanho.ordem - b.tamanho.ordem)
        .map((t) => t.tamanho.nome),
      existe: Boolean(ficha),
      custoFaccaoPrevisto,
      observacoes: ficha?.observacoes ?? null,
      itens,
      custoPrevisto: custoPrevistoDaFicha(
        itens.map((i) => ({ consumoPorPeca: i.consumoPorPeca, custoMedio: i.insumo.custoMedio })),
        custoFaccaoPrevisto,
        acabamentoPorPeca(acabamento, servicos),
        corte,
      ),
      semCusto: itens.filter((i) => i.insumo.custoMedio <= 0).map((i) => i.insumo.nome),
    };
  }

  async salvar(user: AuthenticatedUser, modeloLinhaId: string, dto: FichaDto) {
    const empresaId = await this.erp.empresaLigada(user);
    const ml = await this.linhaDaEmpresa(empresaId, modeloLinhaId);
    if (dto.acabamento?.length) {
      const existe = new Set((await this.servicosDaEmpresa(empresaId)).map((s) => s.id));
      const fora = dto.acabamento.filter((id) => !existe.has(id));
      if (fora.length) {
        throw new BusinessRuleException(
          'Serviço de acabamento que não está na lista da empresa',
          ErrorCode.BUSINESS_RULE_VIOLATION,
        );
      }
    }
    const daGrade = new Set(ml.tamanhos.map((t) => t.tamanho.nome));
    for (const i of dto.itens) {
      const fora = Object.keys(i.porTamanho ?? {}).filter((t) => !daGrade.has(t));
      if (fora.length) {
        throw new BusinessRuleException(
          `Tamanho fora da grade ${ml.linha.nome}: ${fora.join(', ')}`,
          ErrorCode.BUSINESS_RULE_VIOLATION,
        );
      }
    }
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
        // Sem o campo (tela antiga): não mexe no que estava marcado.
        ...(dto.acabamento !== undefined
          ? {
              acabamento: dto.acabamento.length
                ? (dto.acabamento as unknown as Prisma.InputJsonValue)
                : Prisma.DbNull,
            }
          : {}),
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
            // Por tamanho: o consumo da grade é a MÉDIA (custo previsto).
            consumoPorPeca: D(
              temTamanhos(i.porTamanho) ? mediaPorTamanho(i.porTamanho!) : i.consumoPorPeca,
              4,
            ),
            porTamanho: temTamanhos(i.porTamanho) ? i.porTamanho! : Prisma.DbNull,
            etapa: i.etapa ?? 'FACCAO',
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
    const servicos = await this.servicosDaEmpresa(empresaId);
    const corte = await this.corteDaEmpresa(empresaId);
    const fichas = await this.prisma.fichaTecnica.findMany({
      where: { empresaId, modeloLinhaId: { in: modeloLinhaIds } },
      select: {
        modeloLinhaId: true,
        custoFaccaoPrevisto: true,
        acabamento: true,
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
          acabamentoPorPeca(f.acabamento, servicos),
          corte,
        ).total,
      ]),
    );
  }

  // ─── Acabamento (Isabela, 14/10) ────────────────────────────────────────

  async servicosDaEmpresa(empresaId: string) {
    const e = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { config: true },
    });
    return servicosAcabamento(e?.config);
  }

  /** Custo de corte por peça da empresa (0 = não configurado). */
  async corteDaEmpresa(empresaId: string): Promise<number> {
    const e = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { config: true },
    });
    return custoCortePorPeca(e?.config);
  }

  /** Frete da facção por OP da empresa (0 = não configurado). */
  async freteDaEmpresa(empresaId: string): Promise<number> {
    const e = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { config: true },
    });
    return fretePorOp(e?.config);
  }

  /** R$ de acabamento por peça de cada grade (OP: simulação e fechamento). */
  async acabamentoPorGrade(empresaId: string, modeloLinhaIds: string[]) {
    if (!modeloLinhaIds.length) return new Map<string, number>();
    const [servicos, fichas] = await Promise.all([
      this.servicosDaEmpresa(empresaId),
      this.prisma.fichaTecnica.findMany({
        where: { empresaId, modeloLinhaId: { in: modeloLinhaIds } },
        select: { modeloLinhaId: true, acabamento: true },
      }),
    ]);
    return new Map(fichas.map((f) => [f.modeloLinhaId, acabamentoPorPeca(f.acabamento, servicos)]));
  }

  async acabamento(user: AuthenticatedUser) {
    const empresaId = await this.erp.empresaLigada(user);
    return {
      servicos: await this.servicosDaEmpresa(empresaId),
      custoCortePorPeca: await this.corteDaEmpresa(empresaId),
      fretePorOp: await this.freteDaEmpresa(empresaId),
    };
  }

  /** Salva a lista; serviço sem id ganha um (estável, pelo nome). */
  async salvarAcabamento(user: AuthenticatedUser, dto: AcabamentoDto) {
    const empresaId = await this.erp.empresaLigada(user);
    const usados = new Set(dto.servicos.map((s) => s.id).filter((x): x is string => !!x));
    const servicos = dto.servicos.map((s) => ({
      id: s.id ?? idDoServico(s.nome, usados),
      nome: s.nome,
      preco: Math.round(s.preco * 100) / 100,
    }));
    // Corte ausente no corpo = mantém o que estava (a seção é regravada inteira).
    const custoCortePorPeca =
      dto.custoCortePorPeca !== undefined
        ? Math.round(dto.custoCortePorPeca * 10000) / 10000
        : await this.corteDaEmpresa(empresaId);
    // Frete idem: ausente = mantém.
    const frete =
      dto.fretePorOp !== undefined
        ? Math.round(dto.fretePorOp * 100) / 100
        : await this.freteDaEmpresa(empresaId);
    const secao = { servicos, custoCortePorPeca, fretePorOp: frete };
    // jsonb_set atômico: só a seção `acabamento`.
    await this.prisma.$executeRaw`
      UPDATE "Empresa"
      SET "config" = jsonb_set(COALESCE("config", '{}'::jsonb), '{acabamento}', ${JSON.stringify(secao)}::jsonb, true)
      WHERE "id" = ${empresaId}`;
    return secao;
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
