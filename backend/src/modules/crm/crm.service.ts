import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { BusinessRuleException, ForbiddenException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { NotFoundException } from '@shared/errors/app-exception';
import { RepScopeService } from '@shared/scope/rep-scope.service';
import { LeadsService } from '@modules/leads/leads.service';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import type {
  ContatoEtapaDto,
  ContatoExcluirDto,
  ContatoRepresentanteDto,
  ContatoTagsDto,
} from './crm.dto';

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

    // Facilidade de TESTE (ver o comentário no DTO): grava a entrada na etapa
    // com data RETROATIVA pra o SLA vencer sem esperar dias reais. Vem DEPOIS
    // do moverEtapa (que carimba etapaDesde=agora) de propósito — é override.
    if (dto.etapaDesde) {
      await this.prisma.lead.updateMany({
        where: { id: dto.leadId, empresaId },
        data: { etapaDesde: dto.etapaDesde },
      });
    }

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

  /**
   * Atribui (ou DESATRIBUI, com null) o representante de um lead. Reusa o
   * `LeadsService.atribuirRep` — carteira, tenant e validação do rep (existe,
   * é da empresa) já moram lá; aqui é só a porta de MCP (escopo `crm`).
   */
  async atribuirRepresentante(user: AuthenticatedUser, dto: ContatoRepresentanteDto) {
    const lead = await this.leads.atribuirRep(user, dto.leadId, {
      representanteId: dto.representanteId,
    });
    return {
      ok: true,
      leadId: dto.leadId,
      representanteId: lead.representanteId ?? null,
      representanteNome: lead.representante?.nome ?? null,
    };
  }

  /**
   * Exclui leads por lista EXPLÍCITA de ids. Não existe versão por filtro, e não
   * vai existir: o `Lead` guarda ao mesmo tempo os poucos leads de funil e os
   * ~30 mil contatos da base de prospecção importada (esses ficam com `funilId`
   * null). Um `deleteMany` com filtro errado aqui é irreversível.
   *
   * Três travas, todas antes de apagar qualquer coisa (all-or-nothing):
   *  1. todo id tem que existir na empresa (e na carteira) — se um não existe,
   *     não apaga NENHUM, porque id que não resolve é sinal de lista errada;
   *  2. lead SEM FUNIL é recusado — é a base de prospecção, não resíduo de teste;
   *  3. a contagem já foi conferida no DTO (`confirmoExclusaoDe`).
   *
   * Devolve o que foi apagado (nome/telefone/funil/etapa), não só um ok: sem
   * isso não há como auditar depois — a linha já não existe pra ser consultada.
   */
  async excluirLeads(user: AuthenticatedUser, dto: ContatoExcluirDto) {
    const empresaId = this.requireEmpresa(user);
    const ids = [...new Set(dto.leadIds)];

    const scope = await this.repScope.getRepIds(user);
    const scopeLead: Prisma.LeadWhereInput =
      scope !== null ? { representanteId: { in: scope.length ? scope : ['__none__'] } } : {};

    const achados = await this.prisma.lead.findMany({
      where: { id: { in: ids }, empresaId, ...scopeLead },
      select: {
        id: true,
        nome: true,
        contatoTelefone: true,
        funilId: true,
        funil: { select: { nome: true } },
        funilEtapa: { select: { nome: true } },
      },
    });

    // 1. Id que não resolve = lista errada (ou de outro tenant/carteira).
    if (achados.length !== ids.length) {
      const vistos = new Set(achados.map((l) => l.id));
      const faltando = ids.filter((id) => !vistos.has(id));
      throw new BusinessRuleException(
        `Nada foi excluído: ${faltando.length} id(s) não existem nesta empresa ou estão fora da ` +
          `sua carteira — ${faltando.join(', ')}. Confira a lista antes de repetir.`,
      );
    }

    // 2. Lead sem funil é a BASE DE PROSPECÇÃO, não resíduo de teste.
    const semFunil = achados.filter((l) => !l.funilId);
    if (semFunil.length > 0) {
      throw new BusinessRuleException(
        `Nada foi excluído: ${semFunil.length} lead(s) não estão em nenhum funil. Lead sem funil é ` +
          'a base de prospecção importada — esta rota só alcança lead DENTRO de funil. ' +
          `Ids recusados: ${semFunil.map((l) => l.id).join(', ')}.`,
      );
    }

    // `Conversation.leadId` é campo SOLTO (sem FK): apagar o lead sem desamarrar
    // deixa a conversa apontando pra id morto, e o CRIAR_LEAD da triagem conclui
    // "já tem lead" e não cria — a conversa nunca mais é triada, sem erro nenhum.
    // Mesmo cuidado do LeadsService.remove.
    await this.prisma.$transaction([
      this.prisma.conversation.updateMany({
        where: { leadId: { in: ids }, empresaId },
        data: { leadId: null },
      }),
      this.prisma.lead.deleteMany({ where: { id: { in: ids }, empresaId } }),
    ]);

    return {
      ok: true,
      total: achados.length,
      motivo: dto.motivo ?? null,
      excluidos: achados.map((l) => ({
        id: l.id,
        nome: l.nome,
        telefone: l.contatoTelefone ?? null,
        funil: l.funil?.nome ?? null,
        etapa: l.funilEtapa?.nome ?? null,
      })),
    };
  }
}
