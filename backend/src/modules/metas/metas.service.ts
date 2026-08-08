import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { ForbiddenException, NotFoundException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import type { UpsertMetaDto } from './metas.dto';

export interface MetaComProgresso {
  id: string;
  titulo: string;
  descricao: string | null;
  tipo: string;
  valorAlvo: number;
  alvoTipo: string;
  alvoId: string | null;
  alvoNome?: string;
  periodicidade: string;
  inicio: Date;
  fim: Date;
  ativo: boolean;
  /** Atingido até agora (R$ pra FATURAMENTO, contagem pra PEDIDOS) */
  atingido: number;
  /** Percentual 0-100+ */
  progresso: number;
  /** Se está em risco (passou 70% do tempo mas <70% atingido) */
  risco: boolean;
}

@Injectable()
export class MetasService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthenticatedUser): Promise<MetaComProgresso[]> {
    const empresaId = this.requireEmpresa(user);
    const metas = await this.prisma.meta.findMany({
      where: { empresaId, ...(await this.visibilidadeWhere(user)) },
      orderBy: [{ ativo: 'desc' }, { fim: 'asc' }],
    });

    // Calcula progresso de cada meta
    const result: MetaComProgresso[] = [];
    for (const m of metas) {
      const { atingido } = await this.calcularAtingimento(empresaId, m);
      const valorAlvo = Number(m.valorAlvo);
      const progresso = valorAlvo > 0 ? (atingido / valorAlvo) * 100 : 0;
      const now = new Date();
      const totalMs = m.fim.getTime() - m.inicio.getTime();
      const decorridoMs = now.getTime() - m.inicio.getTime();
      const pctTempo = totalMs > 0 ? (decorridoMs / totalMs) * 100 : 0;
      const risco = pctTempo > 70 && progresso < 70 && pctTempo <= 100;

      // Resolve nome do alvo
      let alvoNome = 'Empresa';
      if (m.alvoTipo === 'REP' || m.alvoTipo === 'GERENTE') {
        if (m.alvoId) {
          const u = await this.prisma.usuario.findUnique({
            where: { id: m.alvoId },
            select: { nome: true },
          });
          alvoNome = u?.nome ?? 'Usuário removido';
        }
      }

      result.push({
        id: m.id,
        titulo: m.titulo,
        descricao: m.descricao,
        tipo: m.tipo,
        valorAlvo,
        alvoTipo: m.alvoTipo,
        alvoId: m.alvoId,
        alvoNome,
        periodicidade: m.periodicidade,
        inicio: m.inicio,
        fim: m.fim,
        ativo: m.ativo,
        atingido,
        progresso,
        risco,
      });
    }

    return result;
  }

  async getById(user: AuthenticatedUser, id: string): Promise<MetaComProgresso> {
    const empresaId = this.requireEmpresa(user);
    const m = await this.prisma.meta.findFirst({ where: { id, empresaId } });
    if (!m) throw new NotFoundException('Meta não encontrada');
    const all = await this.list(user);
    const found = all.find((x) => x.id === id);
    if (!found) throw new NotFoundException('Meta não encontrada');
    return found;
  }

  async upsert(user: AuthenticatedUser, id: string | null, dto: UpsertMetaDto) {
    const empresaId = this.requireEmpresa(user);

    const data = {
      empresaId,
      titulo: dto.titulo,
      descricao: dto.descricao ?? null,
      tipo: dto.tipo,
      valorAlvo: new Prisma.Decimal(dto.valorAlvo),
      alvoTipo: dto.alvoTipo,
      alvoId: dto.alvoTipo === 'EMPRESA' ? null : (dto.alvoId ?? null),
      periodicidade: dto.periodicidade,
      inicio: new Date(dto.inicio),
      fim: new Date(dto.fim),
      ativo: dto.ativo,
    };

    await this.assertEscopoDeEscrita(user, empresaId, data.alvoTipo, data.alvoId);

    if (id) {
      // IDOR guard: só edita meta da PRÓPRIA empresa. Sem isso, editar por id puro
      // deixava sobrescrever E reatribuir (data.empresaId) a meta de OUTRO tenant.
      const existente = await this.prisma.meta.findFirst({
        where: { id, empresaId },
        select: { id: true, alvoTipo: true, alvoId: true },
      });
      if (!existente) throw new NotFoundException('Meta não encontrada');
      await this.assertEscopoDeEscrita(user, empresaId, existente.alvoTipo, existente.alvoId);
      return this.prisma.meta.update({ where: { id }, data });
    }
    return this.prisma.meta.create({ data });
  }

  async delete(user: AuthenticatedUser, id: string) {
    const empresaId = this.requireEmpresa(user);
    const m = await this.prisma.meta.findFirst({
      where: { id, empresaId },
      select: { id: true, alvoTipo: true, alvoId: true },
    });
    if (!m) throw new NotFoundException('Meta não encontrada');
    await this.assertEscopoDeEscrita(user, empresaId, m.alvoTipo, m.alvoId);
    await this.prisma.meta.delete({ where: { id } });
    return { deleted: true };
  }

  // ─── Escopo por papel ─────────────────────────────────────

  /** REP enxerga metas da empresa + as próprias; GERENTE idem + as dos seus reps. */
  private async visibilidadeWhere(user: AuthenticatedUser): Promise<Prisma.MetaWhereInput> {
    if (user.role === 'REP') {
      return { OR: [{ alvoTipo: 'EMPRESA' }, { alvoId: user.id }] };
    }
    if (user.role === 'GERENTE') {
      const reps = await this.prisma.usuario.findMany({
        where: { gerenteId: user.id },
        select: { id: true },
      });
      return {
        OR: [{ alvoTipo: 'EMPRESA' }, { alvoId: { in: [user.id, ...reps.map((r) => r.id)] } }],
      };
    }
    return {};
  }

  /**
   * Escrita: alvo tem que ser usuário DESTE tenant; GERENTE só mexe em meta
   * própria ou dos reps sob sua gerência (meta de EMPRESA é DIRECTOR/ADMIN).
   */
  private async assertEscopoDeEscrita(
    user: AuthenticatedUser,
    empresaId: string,
    alvoTipo: string,
    alvoId: string | null,
  ) {
    if (alvoId) {
      const alvo = await this.prisma.usuario.findFirst({
        where: { id: alvoId, empresas: { some: { empresaId } } },
        select: { id: true, gerenteId: true },
      });
      if (!alvo) throw new NotFoundException('Usuário alvo não encontrado nesta empresa');
      if (user.role === 'GERENTE' && alvo.id !== user.id && alvo.gerenteId !== user.id) {
        throw new ForbiddenException('GERENTE só define meta pra si ou pros reps da sua gerência');
      }
    }
    if (user.role === 'GERENTE' && alvoTipo === 'EMPRESA') {
      throw new ForbiddenException('Meta da empresa é definida pelo diretor');
    }
  }

  // ─── Cálculo de atingimento ────────────────────────────────

  private async calcularAtingimento(
    empresaId: string,
    meta: {
      tipo: string;
      alvoTipo: string;
      alvoId: string | null;
      inicio: Date;
      fim: Date;
    },
  ): Promise<{ atingido: number }> {
    const where: Prisma.PedidoWhereInput = {
      empresaId,
      // Considera apenas pedidos válidos (não cancelado/rascunho)
      status: {
        in: ['ENVIADO_OMIE', 'PAGO', 'EM_SEPARACAO', 'ENVIADO', 'ENTREGUE'],
      },
      criadoEm: { gte: meta.inicio, lte: meta.fim },
    };

    if (meta.alvoTipo === 'REP' && meta.alvoId) {
      where.representanteId = meta.alvoId;
    } else if (meta.alvoTipo === 'GERENTE' && meta.alvoId) {
      // Pega todos os reps do gerente.
      // Usuario.empresas é uma junction table (UsuarioEmpresa[]) — filtra via `some`.
      const reps = await this.prisma.usuario.findMany({
        where: {
          gerenteId: meta.alvoId,
          empresas: { some: { empresaId } },
        },
        select: { id: true },
      });
      where.representanteId = { in: reps.map((r) => r.id) };
    }

    if (meta.tipo === 'PEDIDOS') {
      const count = await this.prisma.pedido.count({ where });
      return { atingido: count };
    }
    const agg = await this.prisma.pedido.aggregate({
      where,
      _sum: { total: true },
    });
    return { atingido: Number(agg._sum.total ?? 0) };
  }

  private requireEmpresa(user: AuthenticatedUser): string {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    return user.empresaIdAtiva;
  }
}
