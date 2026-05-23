import { Injectable } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import {
  BusinessRuleException,
  ForbiddenException,
  NotFoundException,
} from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { categorizarNota, type SubmitNpsDto, type UpsertPesquisaDto } from './nps.dto';

@Injectable()
export class NpsService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── ADMIN ─────────────────────────────────────────────────

  async list(user: AuthenticatedUser) {
    const empresaId = this.requireEmpresa(user);
    return this.prisma.pesquisaNPS.findMany({
      where: { empresaId },
      include: { _count: { select: { respostas: true } } },
      orderBy: { atualizadoEm: 'desc' },
    });
  }

  async getById(user: AuthenticatedUser, id: string) {
    const empresaId = this.requireEmpresa(user);
    const row = await this.prisma.pesquisaNPS.findFirst({
      where: { id, empresaId },
      include: {
        _count: { select: { respostas: true } },
      },
    });
    if (!row) throw new NotFoundException('Pesquisa não encontrada');
    return row;
  }

  async upsert(user: AuthenticatedUser, id: string | null, dto: UpsertPesquisaDto) {
    const empresaId = this.requireEmpresa(user);

    const conflict = await this.prisma.pesquisaNPS.findFirst({
      where: { slug: dto.slug, ...(id ? { NOT: { id } } : {}) },
      select: { id: true },
    });
    if (conflict) throw new BusinessRuleException(`Slug "${dto.slug}" já está em uso.`);

    const data = {
      empresaId,
      slug: dto.slug,
      titulo: dto.titulo,
      descricao: dto.descricao ?? null,
      mensagemAgradecimento: dto.mensagemAgradecimento ?? null,
      pergunta: dto.pergunta,
      perguntaFollowUp: dto.perguntaFollowUp ?? null,
      ativo: dto.ativo,
      expiraEm: dto.expiraEm ? new Date(dto.expiraEm) : null,
    };

    if (id) {
      return this.prisma.pesquisaNPS.update({
        where: { id },
        data,
        include: { _count: { select: { respostas: true } } },
      });
    }
    return this.prisma.pesquisaNPS.create({
      data,
      include: { _count: { select: { respostas: true } } },
    });
  }

  async delete(user: AuthenticatedUser, id: string) {
    const empresaId = this.requireEmpresa(user);
    const row = await this.prisma.pesquisaNPS.findFirst({
      where: { id, empresaId },
      select: { id: true },
    });
    if (!row) throw new NotFoundException('Pesquisa não encontrada');
    await this.prisma.pesquisaNPS.delete({ where: { id } });
    return { deleted: true };
  }

  async dashboard(user: AuthenticatedUser, id: string) {
    const pesquisa = await this.getById(user, id);
    const respostas = await this.prisma.respostaNPS.findMany({
      where: { pesquisaId: id },
      orderBy: { criadoEm: 'desc' },
    });
    const total = respostas.length;
    const promotores = respostas.filter((r) => r.categoria === 'PROMOTOR').length;
    const detratores = respostas.filter((r) => r.categoria === 'DETRATOR').length;
    const passivos = respostas.filter((r) => r.categoria === 'PASSIVO').length;
    const score = total > 0 ? Math.round(((promotores - detratores) / total) * 100) : 0;
    const mediaNota = total > 0 ? respostas.reduce((s, r) => s + r.nota, 0) / total : 0;

    // Distribuição por nota (0-10)
    const distribuicao: number[] = new Array(11).fill(0);
    for (const r of respostas) distribuicao[r.nota]++;

    return {
      pesquisa,
      stats: {
        total,
        promotores,
        passivos,
        detratores,
        score,
        mediaNota: Number(mediaNota.toFixed(1)),
      },
      distribuicao,
      respostas: respostas.slice(0, 50),
    };
  }

  // ─── Público ────────────────────────────────────────────────

  async getPublicBySlug(slug: string) {
    const row = await this.prisma.pesquisaNPS.findFirst({
      where: { slug, ativo: true },
    });
    if (!row) throw new NotFoundException('Pesquisa não encontrada ou inativa');
    if (row.expiraEm && row.expiraEm < new Date()) {
      throw new BusinessRuleException('Esta pesquisa já expirou.');
    }
    return {
      slug: row.slug,
      titulo: row.titulo,
      descricao: row.descricao,
      mensagemAgradecimento: row.mensagemAgradecimento,
      pergunta: row.pergunta,
      perguntaFollowUp: row.perguntaFollowUp,
    };
  }

  async submitPublico(slug: string, dto: SubmitNpsDto, meta: { ip?: string; userAgent?: string }) {
    const pesquisa = await this.prisma.pesquisaNPS.findFirst({
      where: { slug, ativo: true },
      select: { id: true, mensagemAgradecimento: true, empresaId: true, expiraEm: true },
    });
    if (!pesquisa) throw new NotFoundException('Pesquisa não encontrada');
    if (pesquisa.expiraEm && pesquisa.expiraEm < new Date()) {
      throw new BusinessRuleException('Esta pesquisa já expirou.');
    }

    // Valida cliente se passado — deve ser da mesma empresa
    let clienteId: string | null = null;
    if (dto.clienteId) {
      const cli = await this.prisma.cliente.findFirst({
        where: { id: dto.clienteId, empresaId: pesquisa.empresaId },
        select: { id: true },
      });
      clienteId = cli?.id ?? null;
    }

    const categoria = categorizarNota(dto.nota);
    await this.prisma.respostaNPS.create({
      data: {
        pesquisaId: pesquisa.id,
        nota: dto.nota,
        comentario: dto.comentario ?? null,
        contato: dto.contato ?? null,
        clienteId,
        categoria,
        ip: meta.ip ?? null,
        userAgent: meta.userAgent?.slice(0, 500) ?? null,
      },
    });

    return {
      ok: true,
      message:
        pesquisa.mensagemAgradecimento ??
        'Obrigado pela resposta! Seu feedback é muito importante.',
    };
  }

  private requireEmpresa(user: AuthenticatedUser): string {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    return user.empresaIdAtiva;
  }
}
