import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { BusinessRuleException, ForbiddenException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { NotFoundException } from '@shared/errors/app-exception';
import { RepScopeService } from '@shared/scope/rep-scope.service';
import { LeadsService } from '@modules/leads/leads.service';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import type { ContatoEtapaDto, ContatoTagsDto } from './crm.dto';

/**
 * Ações de CRM (ESCRITA) sobre um contato, disparadas pelo Claude Code via MCP
 * (escopo de token `crm`). Sempre tenant + carteira (RepScope). Reusa
 * LeadsService (que dispara os gatilhos de fluxo — ex: LEAD_RECEBEU_TAG).
 */
@Injectable()
export class CrmService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repScope: RepScopeService,
    private readonly leads: LeadsService,
  ) {}

  private requireEmpresa(user: AuthenticatedUser): string {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException(
        'Empresa não definida para esta requisição',
        ErrorCode.TENANT_ACCESS_DENIED,
      );
    }
    return user.empresaIdAtiva;
  }

  private sufixoTel(tel: string | null | undefined): string | null {
    const d = (tel ?? '').replace(/\D/g, '');
    return d.length >= 8 ? d.slice(-8) : null;
  }

  /**
   * Resolve os leads + clientes ACESSÍVEIS (tenant + carteira) de um contato,
   * a partir de leadId, clienteId ou telefone (sufixo D18). Só entra id que
   * passa no filtro — nunca escreve fora da carteira.
   */
  private async resolverEntidades(
    user: AuthenticatedUser,
    empresaId: string,
    q: { leadId?: string; clienteId?: string; telefone?: string },
  ): Promise<{ leadIds: string[]; clienteIds: string[] }> {
    const scope = await this.repScope.getRepIds(user);
    const scopeLead: Prisma.LeadWhereInput =
      scope !== null ? { representanteId: { in: scope.length ? scope : ['__none__'] } } : {};
    const leadIds = new Set<string>();
    const clienteIds = new Set<string>();

    if (q.leadId) {
      const l = await this.prisma.lead.findFirst({
        where: { id: q.leadId, empresaId, ...scopeLead },
        select: { id: true },
      });
      if (l) leadIds.add(l.id);
    }
    if (q.clienteId) {
      const c = await this.prisma.cliente.findFirst({
        where: { id: q.clienteId, empresaId, ...(scopeLead as Prisma.ClienteWhereInput) },
        select: { id: true },
      });
      if (c) clienteIds.add(c.id);
    }
    const sufixo = this.sufixoTel(q.telefone);
    if (sufixo) {
      const scopeSql =
        scope !== null
          ? Prisma.sql`AND "representanteId" IN (${Prisma.join(scope.length ? scope : ['__none__'])})`
          : Prisma.empty;
      const [lr, cr] = await Promise.all([
        this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT id FROM "Lead" WHERE "empresaId" = ${empresaId} ${scopeSql}
            AND "contatoTelefone" IS NOT NULL
            AND RIGHT(REGEXP_REPLACE("contatoTelefone", '[^0-9]', '', 'g'), 8) = ${sufixo}`),
        this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT id FROM "Cliente" WHERE "empresaId" = ${empresaId} ${scopeSql}
            AND telefone IS NOT NULL
            AND RIGHT(REGEXP_REPLACE(telefone, '[^0-9]', '', 'g'), 8) = ${sufixo}`),
      ]);
      lr.forEach((x) => leadIds.add(x.id));
      cr.forEach((x) => clienteIds.add(x.id));
    }
    return { leadIds: [...leadIds], clienteIds: [...clienteIds] };
  }

  /** Tags atuais (união Lead+Cliente) das entidades do contato. */
  private async tagsAtuais(leadIds: string[], clienteIds: string[]): Promise<string[]> {
    const nomes = new Set<string>();
    if (leadIds.length) {
      const lt = await this.prisma.leadTag.findMany({
        where: { leadId: { in: leadIds } },
        select: { tag: { select: { nome: true } } },
      });
      lt.forEach((t) => nomes.add(t.tag.nome));
    }
    if (clienteIds.length) {
      const ct = await this.prisma.clienteTag.findMany({
        where: { clienteId: { in: clienteIds } },
        select: { tag: { select: { nome: true } } },
      });
      ct.forEach((t) => nomes.add(t.tag.nome));
    }
    return [...nomes].sort();
  }

  /**
   * Adiciona/remove tags (por NOME) de um contato. Em leads, reusa
   * `LeadsService.aplicarTagPorNome` (cria a tag + dispara LEAD_RECEBEU_TAG).
   * Em clientes, upsert direto. Remoção: resolve a tag por nome e apaga.
   */
  async tags(user: AuthenticatedUser, dto: ContatoTagsDto) {
    const empresaId = this.requireEmpresa(user);
    const { leadIds, clienteIds } = await this.resolverEntidades(user, empresaId, dto);
    if (leadIds.length === 0 && clienteIds.length === 0) {
      throw new BusinessRuleException('Contato não encontrado (ou fora da sua carteira)');
    }

    // ── ADICIONAR ──
    for (const nome of dto.adicionar) {
      for (const leadId of leadIds) {
        await this.leads.aplicarTagPorNome(empresaId, leadId, nome, 'usuario');
      }
      if (clienteIds.length) {
        const tag = await this.prisma.tag.upsert({
          where: { empresaId_nome: { empresaId, nome } },
          create: { empresaId, nome },
          update: {},
          select: { id: true },
        });
        await this.prisma.clienteTag.createMany({
          data: clienteIds.map((clienteId) => ({ clienteId, tagId: tag.id })),
          skipDuplicates: true,
        });
      }
    }
    // ── REMOVER ──
    for (const nome of dto.remover) {
      const tag = await this.prisma.tag.findFirst({
        where: { empresaId, nome },
        select: { id: true },
      });
      if (!tag) continue;
      if (leadIds.length) {
        await this.prisma.leadTag.deleteMany({ where: { leadId: { in: leadIds }, tagId: tag.id } });
      }
      if (clienteIds.length) {
        await this.prisma.clienteTag.deleteMany({
          where: { clienteId: { in: clienteIds }, tagId: tag.id },
        });
      }
    }

    return {
      ok: true,
      leadIds,
      clienteIds,
      tags: await this.tagsAtuais(leadIds, clienteIds),
    };
  }

  /**
   * Move UM lead pra outra etapa do funil. Reusa `LeadsService.moverEtapa`
   * (valida acesso/allow-list, sincroniza o enum e dispara LEAD_ETAPA_MUDOU).
   * Retorna a etapa anterior e a nova. Tenant + carteira via LeadsService.
   */
  async moverEtapa(user: AuthenticatedUser, dto: ContatoEtapaDto) {
    const empresaId = this.requireEmpresa(user);
    // Etapa destino tem que existir na empresa (e casar o funilId, se informado).
    const etapa = await this.prisma.funilEtapa.findFirst({
      where: {
        id: dto.etapaId,
        funil: { empresaId, ...(dto.funilId ? { id: dto.funilId } : {}) },
      },
      select: { id: true, nome: true, funilId: true },
    });
    if (!etapa) throw new NotFoundException('Etapa', dto.etapaId);

    // Etapa anterior (pra reportar de→para) — o moverEtapa valida a carteira do lead.
    const antes = await this.prisma.lead.findFirst({
      where: { id: dto.leadId, empresaId },
      select: { funilEtapa: { select: { id: true, nome: true } } },
    });

    await this.leads.moverEtapa(user, dto.leadId, {
      funilEtapaId: dto.etapaId,
      motivo: dto.motivo,
    });

    return {
      ok: true,
      leadId: dto.leadId,
      funilId: etapa.funilId,
      de: antes?.funilEtapa
        ? { etapaId: antes.funilEtapa.id, etapaNome: antes.funilEtapa.nome }
        : null,
      para: { etapaId: etapa.id, etapaNome: etapa.nome },
    };
  }
}
