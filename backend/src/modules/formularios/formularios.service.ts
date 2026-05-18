import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import {
  BusinessRuleException,
  ForbiddenException,
  NotFoundException,
} from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import type { UpsertFormularioDto, SubmeterRespostaDto, FormCampoTipo } from './formularios.dto';

@Injectable()
export class FormulariosService {
  private readonly logger = new Logger(FormulariosService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── ADMIN/Backoffice ──────────────────────────────────────

  async list(user: AuthenticatedUser) {
    const empresaId = this.requireEmpresa(user);
    const rows = await this.prisma.formulario.findMany({
      where: { empresaId },
      include: {
        campos: { orderBy: { ordem: 'asc' } },
        _count: { select: { respostas: true } },
      },
      orderBy: { atualizadoEm: 'desc' },
    });
    return rows;
  }

  async getById(user: AuthenticatedUser, id: string) {
    const empresaId = this.requireEmpresa(user);
    const row = await this.prisma.formulario.findFirst({
      where: { id, empresaId },
      include: {
        campos: { orderBy: { ordem: 'asc' } },
        _count: { select: { respostas: true } },
      },
    });
    if (!row) throw new NotFoundException('Formulário não encontrado');
    return row;
  }

  async upsert(user: AuthenticatedUser, id: string | null, dto: UpsertFormularioDto) {
    const empresaId = this.requireEmpresa(user);

    // Slug unique check
    const existingBySlug = await this.prisma.formulario.findFirst({
      where: { slug: dto.slug, ...(id ? { NOT: { id } } : {}) },
      select: { id: true },
    });
    if (existingBySlug) {
      throw new BusinessRuleException(`Slug "${dto.slug}" já está em uso.`);
    }

    // Campos: chaves únicas dentro do form
    const camposSet = new Set(dto.campos.map((c) => c.campo));
    if (camposSet.size !== dto.campos.length) {
      throw new BusinessRuleException('Nomes de campo duplicados — cada `campo` deve ser único.');
    }

    const baseData = {
      empresaId,
      slug: dto.slug,
      titulo: dto.titulo,
      descricao: dto.descricao ?? null,
      mensagemSucesso: dto.mensagemSucesso ?? null,
      redirectUrl: dto.redirectUrl ?? null,
      geraLead: dto.geraLead,
      leadEtapaInicial: dto.leadEtapaInicial ?? null,
      notificarUsuarioIds:
        dto.notificarUsuarioIds && dto.notificarUsuarioIds.length > 0
          ? (dto.notificarUsuarioIds as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      ativo: dto.ativo,
    };

    return this.prisma.$transaction(async (tx) => {
      let form;
      if (id) {
        form = await tx.formulario.update({
          where: { id },
          data: baseData,
        });
        await tx.formularioCampo.deleteMany({ where: { formularioId: id } });
      } else {
        form = await tx.formulario.create({ data: baseData });
      }
      await tx.formularioCampo.createMany({
        data: dto.campos.map((c) => ({
          formularioId: form.id,
          ordem: c.ordem,
          tipo: c.tipo,
          label: c.label,
          campo: c.campo,
          placeholder: c.placeholder ?? null,
          obrigatorio: c.obrigatorio,
          opcoes:
            c.opcoes && c.opcoes.length > 0
              ? (c.opcoes as unknown as Prisma.InputJsonValue)
              : Prisma.JsonNull,
          validacao: c.validacao
            ? (c.validacao as unknown as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          hint: c.hint ?? null,
        })),
      });
      return tx.formulario.findUniqueOrThrow({
        where: { id: form.id },
        include: {
          campos: { orderBy: { ordem: 'asc' } },
          _count: { select: { respostas: true } },
        },
      });
    });
  }

  async delete(user: AuthenticatedUser, id: string) {
    const empresaId = this.requireEmpresa(user);
    const row = await this.prisma.formulario.findFirst({
      where: { id, empresaId },
      select: { id: true },
    });
    if (!row) throw new NotFoundException('Formulário não encontrado');
    await this.prisma.formulario.delete({ where: { id } });
    return { deleted: true };
  }

  async listRespostas(user: AuthenticatedUser, formId: string, limit = 50) {
    await this.getById(user, formId);
    const rows = await this.prisma.formularioResposta.findMany({
      where: { formularioId: formId },
      orderBy: { criadoEm: 'desc' },
      take: limit,
    });
    return rows;
  }

  // ─── Público (sem auth) ────────────────────────────────────

  async getPublicBySlug(slug: string) {
    const row = await this.prisma.formulario.findFirst({
      where: { slug, ativo: true },
      include: { campos: { orderBy: { ordem: 'asc' } } },
    });
    if (!row) throw new NotFoundException('Formulário não encontrado ou inativo');
    // Sanitiza: não expõe empresaId, lista de notificados, etc.
    return {
      slug: row.slug,
      titulo: row.titulo,
      descricao: row.descricao,
      mensagemSucesso: row.mensagemSucesso,
      redirectUrl: row.redirectUrl,
      campos: row.campos.map((c) => ({
        ordem: c.ordem,
        tipo: c.tipo as FormCampoTipo,
        label: c.label,
        campo: c.campo,
        placeholder: c.placeholder,
        obrigatorio: c.obrigatorio,
        opcoes: c.opcoes ?? null,
        hint: c.hint,
      })),
    };
  }

  async submitPublico(
    slug: string,
    dto: SubmeterRespostaDto,
    meta: { ip?: string; userAgent?: string },
  ) {
    const form = await this.prisma.formulario.findFirst({
      where: { slug, ativo: true },
      include: { campos: true },
    });
    if (!form) throw new NotFoundException('Formulário não encontrado ou inativo');

    // Honeypot: se _hp veio preenchido, é bot — finge sucesso pra confundir
    if (dto._hp && dto._hp.length > 0) {
      this.logger.warn(`Honeypot triggered no form ${slug}`);
      return { ok: true, message: form.mensagemSucesso ?? 'Obrigado!' };
    }

    // Valida campos obrigatórios
    for (const campo of form.campos) {
      if (campo.obrigatorio) {
        const v = dto.dados[campo.campo];
        if (v === undefined || v === null || (typeof v === 'string' && v.trim().length === 0)) {
          throw new BusinessRuleException(`Campo "${campo.label}" é obrigatório`);
        }
      }
    }

    // Cria resposta + (opcional) Lead
    let leadId: string | null = null;
    await this.prisma.$transaction(async (tx) => {
      if (form.geraLead) {
        // Tenta extrair nome/email/telefone dos campos comuns
        const dados = dto.dados;
        const nome = pickFirstString(dados, ['nome', 'name', 'nomeCompleto']) ?? `Lead via ${form.titulo}`;
        const email = pickFirstString(dados, ['email', 'emailContato', 'mail']);
        const telefone = pickFirstString(dados, ['telefone', 'fone', 'celular', 'whatsapp']);
        const cidade = pickFirstString(dados, ['cidade', 'city']);
        const uf = pickFirstString(dados, ['uf', 'estado']);
        const segmento = pickFirstString(dados, ['segmento', 'segment']);

        const lead = await tx.lead.create({
          data: {
            empresaId: form.empresaId,
            nome: nome.slice(0, 200),
            contatoEmail: email?.slice(0, 200) ?? null,
            contatoTelefone: telefone?.slice(0, 30) ?? null,
            cidade: cidade?.slice(0, 100) ?? null,
            uf: uf?.slice(0, 2).toUpperCase() ?? null,
            segmento: segmento?.slice(0, 60) ?? null,
            canalOrigem: 'FORMULARIO',
            etapa: (form.leadEtapaInicial as 'NOVO' | 'QUALIFICANDO') ?? 'NOVO',
            valorEstimado: 0,
            score: 50,
            observacoes: JSON.stringify(dados, null, 2),
          },
        });
        leadId = lead.id;
      }
      await tx.formularioResposta.create({
        data: {
          formularioId: form.id,
          dados: dto.dados as unknown as Prisma.InputJsonValue,
          ip: meta.ip ?? null,
          userAgent: meta.userAgent?.slice(0, 500) ?? null,
          leadId,
        },
      });
    });

    return {
      ok: true,
      message: form.mensagemSucesso ?? 'Obrigado pelo envio! Em breve entraremos em contato.',
      redirectUrl: form.redirectUrl ?? null,
    };
  }

  // ─── Helpers ───────────────────────────────────────────────

  private requireEmpresa(user: AuthenticatedUser): string {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    return user.empresaIdAtiva;
  }
}

function pickFirstString(
  dados: Record<string, string | number | boolean | string[]>,
  keys: string[],
): string | undefined {
  for (const k of keys) {
    const v = dados[k];
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  }
  return undefined;
}
