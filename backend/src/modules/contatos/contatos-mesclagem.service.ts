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

/**
 * Mesclagem de contatos duplicados.
 *
 * DUAS operações diferentes, de propósito:
 *
 *  - **Lead + Lead = FUSÃO destrutiva.** Duplicata de verdade (a mesma pessoa
 *    cadastrada duas vezes). Um sobrevive, o outro é absorvido e apagado.
 *
 *  - **Lead + Cliente = VÍNCULO.** NÃO é duplicata: é o ciclo de vida normal
 *    (`Lead.clienteId` existe justamente pra isso — "populado quando ganho vira
 *    cliente"). Fundir os dois destruiria a história de aquisição pra manter a
 *    relação comercial, quebraria o nó "Conversar com IA" (que exige um Lead) e
 *    impediria o caso real de um CLIENTE virar lead de novo numa recompra. Então
 *    aqui nada é apagado: só ligamos os dois.
 *
 * Regra dura em qualquer caso: **a atribuição de marketing vem do registro MAIS
 * ANTIGO** — foi ele que trouxe o contato. Perder isso numa mesclagem é perder a
 * campanha, e esse dado não volta.
 *
 * Cliente + Cliente fica FORA desta fase: Cliente tem 15 dependentes, incluindo
 * pedidos/propostas/comissões. Fundir dinheiro merece card próprio.
 */
@Injectable()
export class ContatosMesclagemService {
  private readonly logger = new Logger(ContatosMesclagemService.name);

  constructor(private readonly prisma: PrismaService) {}

  private requireEmpresa(user: AuthenticatedUser): string {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    return user.empresaIdAtiva;
  }

  /** Mesclar é de gestão: REP e SAC não mexem (decisão do Léo). */
  private assertPodeMesclar(user: AuthenticatedUser): void {
    if (!['ADMIN', 'DIRECTOR', 'GERENTE'].includes(user.role)) {
      throw new ForbiddenException(
        'Apenas ADMIN, Diretor ou Gerente podem mesclar contatos',
        ErrorCode.INSUFFICIENT_PERMISSIONS,
      );
    }
  }

  // ─── Detecção ────────────────────────────────────────────────────────

  /**
   * Grupos de leads suspeitos de serem a mesma pessoa. SÓ LISTA — não age.
   * Duplicata é decisão humana: telefone parecido virando fusão automática é
   * como se perde cliente.
   *
   * Chaves: sufixo de 8 dígitos do telefone (D18 — formatação varia demais pra
   * comparar string crua) e e-mail case-insensitive.
   */
  async duplicatas(
    user: AuthenticatedUser,
    limite = 50,
  ): Promise<
    Array<{
      chave: string;
      motivo: 'telefone' | 'email';
      leads: Array<{
        id: string;
        nome: string;
        contatoTelefone: string | null;
        contatoEmail: string | null;
        criadoEm: string;
        utmCampaign: string | null;
        maisAntigo: boolean;
      }>;
    }>
  > {
    const empresaId = this.requireEmpresa(user);
    this.assertPodeMesclar(user);

    // Agrupa no BANCO (não em memória): a base pode ter dezenas de milhares de
    // leads e trazer tudo pro Node só pra agrupar seria insustentável.
    const porTelefone = await this.prisma.$queryRaw<Array<{ chave: string; ids: string[] }>>`
      SELECT RIGHT(REGEXP_REPLACE("contatoTelefone", '[^0-9]', '', 'g'), 8) AS chave,
             ARRAY_AGG("id" ORDER BY "criadoEm" ASC) AS ids
      FROM "Lead"
      WHERE "empresaId" = ${empresaId}
        AND "contatoTelefone" IS NOT NULL
        AND LENGTH(REGEXP_REPLACE("contatoTelefone", '[^0-9]', '', 'g')) >= 8
      GROUP BY 1
      HAVING COUNT(*) > 1
      LIMIT ${limite}
    `;

    const porEmail = await this.prisma.$queryRaw<Array<{ chave: string; ids: string[] }>>`
      SELECT LOWER("contatoEmail") AS chave,
             ARRAY_AGG("id" ORDER BY "criadoEm" ASC) AS ids
      FROM "Lead"
      WHERE "empresaId" = ${empresaId} AND "contatoEmail" IS NOT NULL AND "contatoEmail" <> ''
      GROUP BY 1
      HAVING COUNT(*) > 1
      LIMIT ${limite}
    `;

    const grupos = [
      ...porTelefone.map((g) => ({ ...g, motivo: 'telefone' as const })),
      ...porEmail.map((g) => ({ ...g, motivo: 'email' as const })),
    ];
    const todosIds = [...new Set(grupos.flatMap((g) => g.ids))];
    if (todosIds.length === 0) return [];

    const leads = await this.prisma.lead.findMany({
      where: { id: { in: todosIds }, empresaId },
      select: {
        id: true,
        nome: true,
        contatoTelefone: true,
        contatoEmail: true,
        criadoEm: true,
        utmCampaign: true,
      },
    });
    const porId = new Map(leads.map((l) => [l.id, l]));

    return grupos
      .map((g) => {
        // `ids` já vem ordenado por criadoEm ASC → o primeiro é o mais antigo.
        const linhas = g.ids.map((id) => porId.get(id)).filter((l) => !!l);
        return {
          chave: g.chave,
          motivo: g.motivo,
          leads: linhas.map((l, idx) => ({
            id: l.id,
            nome: l.nome,
            contatoTelefone: l.contatoTelefone,
            contatoEmail: l.contatoEmail,
            criadoEm: l.criadoEm.toISOString(),
            utmCampaign: l.utmCampaign,
            maisAntigo: idx === 0,
          })),
        };
      })
      .filter((g) => g.leads.length > 1);
  }

  // ─── Prévia ──────────────────────────────────────────────────────────

  /**
   * Mostra o que vai acontecer ANTES de confirmar. Mesclagem é irreversível na
   * prática (mesmo com desfazer): ninguém deve descobrir o resultado depois.
   */
  async previa(
    user: AuthenticatedUser,
    principalId: string,
    absorvidoId: string,
  ): Promise<{
    principal: { id: string; nome: string };
    absorvido: { id: string; nome: string };
    /** Atribuição que o sobrevivente vai ficar (vem do MAIS ANTIGO). */
    atribuicaoFinal: {
      utmSource: string | null;
      utmMedium: string | null;
      utmCampaign: string | null;
      origemCadastro: string | null;
    };
    atribuicaoMudou: boolean;
    camposPreenchidos: Array<{ campo: string; valor: string }>;
    vinculosMigrados: {
      tags: number;
      historicoEtapas: number;
      conversas: number;
      formularios: number;
    };
  }> {
    const empresaId = this.requireEmpresa(user);
    this.assertPodeMesclar(user);
    const { principal, absorvido } = await this.carregarPar(empresaId, principalId, absorvidoId);

    const atrib = this.resolverAtribuicao(principal, absorvido);
    const campos = this.camposAPreencher(principal, absorvido);
    const [tags, historico, conversas, formularios] = await Promise.all([
      this.prisma.leadTag.count({ where: { leadId: absorvido.id } }),
      this.prisma.leadEtapaHistorico.count({ where: { leadId: absorvido.id } }),
      this.prisma.conversation.count({ where: { leadId: absorvido.id, empresaId } }),
      this.prisma.formularioResposta.count({ where: { leadId: absorvido.id } }),
    ]);

    return {
      principal: { id: principal.id, nome: principal.nome },
      absorvido: { id: absorvido.id, nome: absorvido.nome },
      atribuicaoFinal: atrib,
      atribuicaoMudou:
        atrib.utmCampaign !== principal.utmCampaign ||
        atrib.origemCadastro !== principal.origemCadastro,
      camposPreenchidos: campos.map((c) => ({ campo: c.campo, valor: String(c.valor) })),
      vinculosMigrados: { tags, historicoEtapas: historico, conversas, formularios },
    };
  }

  // ─── Mesclagem (Lead + Lead) ─────────────────────────────────────────

  /**
   * Funde dois leads. O `principalId` sobrevive; o absorvido é apagado DEPOIS de
   * ter todos os vínculos migrados e o estado guardado no snapshot.
   */
  async mesclarLeads(
    user: AuthenticatedUser,
    principalId: string,
    absorvidoId: string,
  ): Promise<{ mesclagemId: string; leadId: string; absorvidoId: string }> {
    const empresaId = this.requireEmpresa(user);
    this.assertPodeMesclar(user);
    const { principal, absorvido } = await this.carregarPar(empresaId, principalId, absorvidoId);

    const atrib = this.resolverAtribuicao(principal, absorvido);
    const campos = this.camposAPreencher(principal, absorvido);
    const patchCampos = Object.fromEntries(campos.map((c) => [c.campo, c.valor]));

    const mesclagemId = await this.prisma.$transaction(async (tx) => {
      // Vínculos migrados ANTES do delete — se algo falhar, a transação volta
      // atrás e o absorvido continua inteiro (nada de estado meio-mesclado).
      const tags = await tx.leadTag.findMany({
        where: { leadId: absorvido.id },
        select: { tagId: true },
      });
      // Tag que o principal já tem não pode duplicar (unique leadId+tagId).
      const tagsDoPrincipal = new Set(
        (
          await tx.leadTag.findMany({ where: { leadId: principal.id }, select: { tagId: true } })
        ).map((t) => t.tagId),
      );
      const tagsMigradas = tags.map((t) => t.tagId).filter((id) => !tagsDoPrincipal.has(id));
      if (tagsMigradas.length > 0) {
        await tx.leadTag.updateMany({
          where: { leadId: absorvido.id, tagId: { in: tagsMigradas } },
          data: { leadId: principal.id },
        });
      }

      const historico = await tx.leadEtapaHistorico.findMany({
        where: { leadId: absorvido.id },
        select: { id: true },
      });
      await tx.leadEtapaHistorico.updateMany({
        where: { leadId: absorvido.id },
        data: { leadId: principal.id },
      });

      const conversas = await tx.conversation.findMany({
        where: { leadId: absorvido.id, empresaId },
        select: { id: true },
      });
      await tx.conversation.updateMany({
        where: { leadId: absorvido.id, empresaId },
        data: { leadId: principal.id },
      });

      const formularios = await tx.formularioResposta.findMany({
        where: { leadId: absorvido.id },
        select: { id: true },
      });
      await tx.formularioResposta.updateMany({
        where: { leadId: absorvido.id },
        data: { leadId: principal.id },
      });

      // Variáveis: merge (o principal manda nas chaves que já tem).
      const varsAbs = this.objeto(absorvido.variaveis);
      const varsPri = this.objeto(principal.variaveis);
      const variaveis = { ...varsAbs, ...varsPri };
      // Atribuição vem do MAIS ANTIGO — inclusive o bloco do JSON.
      const maisAntigo = principal.criadoEm <= absorvido.criadoEm ? principal : absorvido;
      const atribJson = this.objeto(maisAntigo.variaveis).atribuicao;
      if (atribJson) variaveis.atribuicao = atribJson;

      await tx.lead.update({
        where: { id: principal.id },
        data: {
          ...patchCampos,
          utmSource: atrib.utmSource,
          utmMedium: atrib.utmMedium,
          utmCampaign: atrib.utmCampaign,
          origemCadastro: atrib.origemCadastro,
          variaveis: variaveis as Prisma.InputJsonValue,
        },
      });

      const registro = await tx.mesclagemContato.create({
        data: {
          empresaId,
          tipo: 'lead_lead',
          principalId: principal.id,
          absorvidoId: absorvido.id,
          quem: user.id,
          snapshot: {
            absorvido: this.serializar(absorvido),
            // Estado do principal ANTES — pra reverter os campos preenchidos.
            principalAntes: {
              ...Object.fromEntries(campos.map((c) => [c.campo, null])),
              utmSource: principal.utmSource,
              utmMedium: principal.utmMedium,
              utmCampaign: principal.utmCampaign,
              origemCadastro: principal.origemCadastro,
              variaveis: varsPri,
            },
            migrados: {
              tags: tagsMigradas,
              historicoEtapas: historico.map((h) => h.id),
              conversas: conversas.map((c) => c.id),
              formularios: formularios.map((f) => f.id),
            },
          } as Prisma.InputJsonValue,
        },
        select: { id: true },
      });

      // Só agora o absorvido some. LeadTag/LeadEtapaHistorico restantes caem por
      // cascade (são os que não migraram — ex: tag que o principal já tinha).
      await tx.lead.delete({ where: { id: absorvido.id } });
      return registro.id;
    });

    this.logger.log(
      `Mesclagem ${mesclagemId}: lead ${absorvido.id} absorvido por ${principal.id} (empresa ${empresaId})`,
    );
    return { mesclagemId, leadId: principal.id, absorvidoId: absorvido.id };
  }

  // ─── Vínculo (Lead ↔ Cliente) ────────────────────────────────────────

  /**
   * Liga um Lead a um Cliente. NADA é apagado: o Cliente passa a ser a "cara" do
   * contato (dono do cadastro) e o Lead segue guardando a história de aquisição
   * — que é o que alimenta a atribuição e o nó "Conversar com IA".
   */
  async vincularLeadCliente(
    user: AuthenticatedUser,
    leadId: string,
    clienteId: string,
  ): Promise<{ mesclagemId: string; leadId: string; clienteId: string }> {
    const empresaId = this.requireEmpresa(user);
    this.assertPodeMesclar(user);

    const [lead, cliente] = await Promise.all([
      this.prisma.lead.findFirst({
        where: { id: leadId, empresaId },
        select: { id: true, clienteId: true },
      }),
      this.prisma.cliente.findFirst({
        where: { id: clienteId, empresaId },
        select: { id: true },
      }),
    ]);
    if (!lead) throw new NotFoundException('Lead', leadId);
    if (!cliente) throw new NotFoundException('Cliente', clienteId);
    if (lead.clienteId === clienteId) {
      throw new BusinessRuleException('Este lead já está vinculado a este cliente');
    }

    const mesclagemId = await this.prisma.$transaction(async (tx) => {
      await tx.lead.update({ where: { id: lead.id }, data: { clienteId } });
      const r = await tx.mesclagemContato.create({
        data: {
          empresaId,
          tipo: 'lead_cliente',
          principalId: clienteId,
          absorvidoId: lead.id,
          quem: user.id,
          // Vínculo não destrói nada — basta guardar o vínculo anterior.
          snapshot: { clienteIdAnterior: lead.clienteId } as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
      return r.id;
    });

    return { mesclagemId, leadId: lead.id, clienteId };
  }

  // ─── Cliente + Cliente (Fase 2) ──────────────────────────────────────

  /** Só DIRECTOR/ADMIN mescla CLIENTE — envolve dado fiscal e financeiro. */
  private assertPodeMesclarCliente(user: AuthenticatedUser): void {
    if (!['ADMIN', 'DIRECTOR'].includes(user.role)) {
      throw new ForbiddenException(
        'Apenas ADMIN ou Diretor podem mesclar clientes (envolve dado fiscal e financeiro)',
        ErrorCode.INSUFFICIENT_PERMISSIONS,
      );
    }
  }

  /**
   * Guard do CNPJ (decisão do Léo): só mescla se os dois têm o MESMO CNPJ, ou se
   * pelo menos um está sem CNPJ. CNPJ diferente = empresa diferente, mesmo com
   * nome parecido — nunca funde.
   */
  private assertCnpjCompativel(a: { cnpj: string | null }, b: { cnpj: string | null }): void {
    const na = (a.cnpj ?? '').replace(/\D/g, '');
    const nb = (b.cnpj ?? '').replace(/\D/g, '');
    if (na && nb && na !== nb) {
      throw new BusinessRuleException(
        'Estes clientes têm CNPJ diferente — são empresas distintas e não podem ser mesclados',
      );
    }
  }

  /** Grupos de CLIENTES suspeitos de duplicata (CNPJ, telefone ou e-mail). Só lista. */
  async duplicatasClientes(
    user: AuthenticatedUser,
    limite = 50,
  ): Promise<
    Array<{
      chave: string;
      motivo: 'cnpj' | 'telefone' | 'email';
      clientes: Array<{
        id: string;
        nome: string;
        cnpj: string | null;
        telefone: string | null;
        email: string | null;
        criadoEm: string;
        maisAntigo: boolean;
      }>;
    }>
  > {
    const empresaId = this.requireEmpresa(user);
    this.assertPodeMesclarCliente(user);

    const grupoRaw = (col: string, where: string) =>
      this.prisma.$queryRawUnsafe<Array<{ chave: string; ids: string[] }>>(
        `SELECT ${col} AS chave, ARRAY_AGG("id" ORDER BY "criadoEm" ASC) AS ids
         FROM "Cliente" WHERE "empresaId" = $1 AND ${where}
         GROUP BY 1 HAVING COUNT(*) > 1 LIMIT $2`,
        empresaId,
        limite,
      );

    const [porCnpj, porTel, porEmail] = await Promise.all([
      grupoRaw(
        `REGEXP_REPLACE("cnpj", '[^0-9]', '', 'g')`,
        `"cnpj" IS NOT NULL AND LENGTH(REGEXP_REPLACE("cnpj", '[^0-9]', '', 'g')) >= 11`,
      ),
      grupoRaw(
        `RIGHT(REGEXP_REPLACE("telefone", '[^0-9]', '', 'g'), 8)`,
        `"telefone" IS NOT NULL AND LENGTH(REGEXP_REPLACE("telefone", '[^0-9]', '', 'g')) >= 8`,
      ),
      grupoRaw(`LOWER("email")`, `"email" IS NOT NULL AND "email" <> ''`),
    ]);

    const grupos = [
      ...porCnpj.map((g) => ({ ...g, motivo: 'cnpj' as const })),
      ...porTel.map((g) => ({ ...g, motivo: 'telefone' as const })),
      ...porEmail.map((g) => ({ ...g, motivo: 'email' as const })),
    ];
    const ids = [...new Set(grupos.flatMap((g) => g.ids))];
    if (ids.length === 0) return [];
    const clientes = await this.prisma.cliente.findMany({
      where: { id: { in: ids }, empresaId },
      select: { id: true, nome: true, cnpj: true, telefone: true, email: true, criadoEm: true },
    });
    const porId = new Map(clientes.map((c) => [c.id, c]));

    return grupos
      .map((g) => {
        const linhas = g.ids.map((id) => porId.get(id)).filter((c) => !!c);
        return {
          chave: g.chave,
          motivo: g.motivo,
          clientes: linhas.map((c, i) => ({
            id: c.id,
            nome: c.nome,
            cnpj: c.cnpj,
            telefone: c.telefone,
            email: c.email,
            criadoEm: c.criadoEm.toISOString(),
            maisAntigo: i === 0,
          })),
        };
      })
      .filter((g) => g.clientes.length > 1);
  }

  /** Prévia da mesclagem de clientes: o que migra, dinheiro envolvido, conflitos de preço. */
  async previaCliente(user: AuthenticatedUser, principalId: string, absorvidoId: string) {
    const empresaId = this.requireEmpresa(user);
    this.assertPodeMesclarCliente(user);
    const { principal, absorvido } = await this.carregarParCliente(
      empresaId,
      principalId,
      absorvidoId,
    );
    this.assertCnpjCompativel(principal, absorvido);

    const [pedidos, propostas, amostras, precosAbs, precosPri, saldoAbs] = await Promise.all([
      this.prisma.pedido.count({ where: { clienteId: absorvido.id } }),
      this.prisma.proposta.count({ where: { clienteId: absorvido.id } }),
      this.prisma.amostra.count({ where: { clienteId: absorvido.id } }),
      this.prisma.clientePrecoEspecial.findMany({
        where: { clienteId: absorvido.id },
        select: { produtoId: true },
      }),
      this.prisma.clientePrecoEspecial.findMany({
        where: { clienteId: principal.id },
        select: { produtoId: true },
      }),
      this.prisma.saldoFidelidade.findUnique({
        where: { clienteId: absorvido.id },
        select: { pontos: true },
      }),
    ]);
    const produtosPri = new Set(precosPri.map((p) => p.produtoId));
    const conflitosPreco = precosAbs.filter((p) => produtosPri.has(p.produtoId)).length;

    return {
      principal: { id: principal.id, nome: principal.nome, cnpj: principal.cnpj },
      absorvido: { id: absorvido.id, nome: absorvido.nome, cnpj: absorvido.cnpj },
      // Dinheiro que migra pro sobrevivente. NADA é recalculado — comissão já
      // fechada nem é tocada (Comissao é por rep/mês, não tem clienteId).
      migra: { pedidos, propostas, amostras },
      // Preço especial em conflito: o do SOBREVIVENTE vence, o do absorvido é
      // descartado (decisão do Léo). Aqui só avisamos quantos.
      conflitosPreco,
      pontosFidelidadeSomados: saldoAbs?.pontos ?? 0,
    };
  }

  /** Funde dois CLIENTES. Repoint dos 15 dependentes + casos especiais + snapshot. */
  async mesclarClientes(
    user: AuthenticatedUser,
    principalId: string,
    absorvidoId: string,
  ): Promise<{ mesclagemId: string; clienteId: string; absorvidoId: string }> {
    const empresaId = this.requireEmpresa(user);
    this.assertPodeMesclarCliente(user);
    const { principal, absorvido } = await this.carregarParCliente(
      empresaId,
      principalId,
      absorvidoId,
    );
    this.assertCnpjCompativel(principal, absorvido);

    // Campos do absorvido que preenchem buraco no principal (nunca sobrescreve).
    const campos = this.camposAPreencher(principal, absorvido);
    const patchCampos = Object.fromEntries(campos.map((c) => [c.campo, c.valor]));

    const mesclagemId = await this.prisma.$transaction(async (tx) => {
      // 1) Dependentes de repoint SIMPLES (sem constraint). updateMany por clienteId.
      const migradosSimples = await this.repointClienteSimples(tx, absorvido.id, principal.id);

      // 2) ClienteTag — PK composta (clienteId,tagId): migra só as que o principal
      //    não tem; as duplicadas caem por cascade no delete.
      const tagsAbs = await tx.clienteTag.findMany({
        where: { clienteId: absorvido.id },
        select: { tagId: true },
      });
      const tagsPri = new Set(
        (
          await tx.clienteTag.findMany({
            where: { clienteId: principal.id },
            select: { tagId: true },
          })
        ).map((t) => t.tagId),
      );
      const tagsMigradas = tagsAbs.map((t) => t.tagId).filter((id) => !tagsPri.has(id));
      const tagsDescartadas = tagsAbs.map((t) => t.tagId).filter((id) => tagsPri.has(id));
      if (tagsMigradas.length > 0) {
        await tx.clienteTag.updateMany({
          where: { clienteId: absorvido.id, tagId: { in: tagsMigradas } },
          data: { clienteId: principal.id },
        });
      }

      // 3) ClientePrecoEspecial — unique (clienteId,produtoId): o do SOBREVIVENTE
      //    vence. Migra só os produtos que o principal ainda não precifica; guarda
      //    os descartados INTEIROS no snapshot (o delete do absorvido levaria eles).
      const precosAbs = await tx.clientePrecoEspecial.findMany({
        where: { clienteId: absorvido.id },
      });
      const produtosPri = new Set(
        (
          await tx.clientePrecoEspecial.findMany({
            where: { clienteId: principal.id },
            select: { produtoId: true },
          })
        ).map((p) => p.produtoId),
      );
      const precoMigrar = precosAbs.filter((p) => !produtosPri.has(p.produtoId)).map((p) => p.id);
      const precoDescartado = precosAbs.filter((p) => produtosPri.has(p.produtoId));
      if (precoMigrar.length > 0) {
        await tx.clientePrecoEspecial.updateMany({
          where: { id: { in: precoMigrar } },
          data: { clienteId: principal.id },
        });
      }

      // 4) SaldoFidelidade — 1:1 unique: SOMA os pontos no do principal e apaga o
      //    do absorvido (senão o delete falha no unique).
      const saldoAbs = await tx.saldoFidelidade.findUnique({
        where: { clienteId: absorvido.id },
      });
      const pontosAbsorvidos = saldoAbs?.pontos ?? 0;
      if (saldoAbs) {
        await tx.saldoFidelidade.delete({ where: { clienteId: absorvido.id } });
        if (pontosAbsorvidos !== 0) {
          await tx.saldoFidelidade.upsert({
            where: { clienteId: principal.id },
            create: { empresaId, clienteId: principal.id, pontos: pontosAbsorvidos },
            update: { pontos: { increment: pontosAbsorvidos } },
          });
        }
      }

      // 5) Preenche buracos do sobrevivente.
      if (Object.keys(patchCampos).length > 0) {
        await tx.cliente.update({ where: { id: principal.id }, data: patchCampos });
      }

      const registro = await tx.mesclagemContato.create({
        data: {
          empresaId,
          tipo: 'cliente_cliente',
          principalId: principal.id,
          absorvidoId: absorvido.id,
          quem: user.id,
          snapshot: {
            absorvido: this.serializar(absorvido),
            principalAntes: Object.fromEntries(campos.map((c) => [c.campo, null])),
            migradosSimples,
            tagsMigradas,
            tagsDescartadas,
            precoMigrado: precoMigrar,
            // Rows inteiras dos preços descartados — o delete os levaria; guardar
            // é o que permite recriá-los no desfazer.
            precoDescartado: precoDescartado.map((p) => this.serializar(p)),
            pontosAbsorvidos,
          } as Prisma.InputJsonValue,
        },
        select: { id: true },
      });

      // Só agora o absorvido some. Dependentes que sobraram (tags/preços duplicados)
      // caem por cascade.
      await tx.cliente.delete({ where: { id: absorvido.id } });
      return registro.id;
    });

    this.logger.log(
      `Mesclagem ${mesclagemId}: cliente ${absorvido.id} absorvido por ${principal.id} (empresa ${empresaId})`,
    );
    return { mesclagemId, clienteId: principal.id, absorvidoId: absorvido.id };
  }

  /** Dependentes de Cliente SEM constraint de unicidade — repoint por clienteId. */
  private readonly DEPS_CLIENTE_SIMPLES = [
    'pedido',
    'proposta',
    'amostra',
    'ocorrencia',
    'devolucao',
    'internalThread',
    'notaPrivada',
    'documento',
    'agendaItem',
    'campanhaDestinatario',
    'conversation',
    'marketplaceIncident',
    'respostaNPS',
    'movimentoFidelidade',
    'lead',
  ] as const;

  /**
   * Repoint dos dependentes simples de Cliente. Captura os IDS antes de mover (o
   * desfazer precisa deles pra devolver EXATAMENTE o que veio do absorvido, sem
   * arrastar junto o que já era do principal). Retorna {modelo: ids[]}.
   */
  private async repointClienteSimples(
    tx: Prisma.TransactionClient,
    de: string,
    para: string,
  ): Promise<Record<string, string[]>> {
    const out: Record<string, string[]> = {};
    for (const modelo of this.DEPS_CLIENTE_SIMPLES) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const delegate = (tx as any)[modelo];
      const linhas: Array<{ id: string }> = await delegate.findMany({
        where: { clienteId: de },
        select: { id: true },
      });
      if (linhas.length === 0) continue;
      const ids = linhas.map((l) => l.id);
      await delegate.updateMany({ where: { id: { in: ids } }, data: { clienteId: para } });
      out[modelo] = ids;
    }
    return out;
  }

  private async carregarParCliente(empresaId: string, principalId: string, absorvidoId: string) {
    if (principalId === absorvidoId) {
      throw new BusinessRuleException('Não dá pra mesclar um cliente com ele mesmo');
    }
    const clientes = await this.prisma.cliente.findMany({
      where: { id: { in: [principalId, absorvidoId] }, empresaId },
    });
    const principal = clientes.find((c) => c.id === principalId);
    const absorvido = clientes.find((c) => c.id === absorvidoId);
    if (!principal) throw new NotFoundException('Cliente', principalId);
    if (!absorvido) throw new NotFoundException('Cliente', absorvidoId);
    return { principal, absorvido };
  }

  /**
   * Desfaz uma mesclagem de CLIENTES: recria o absorvido com o mesmo id, devolve
   * cada dependente migrado, recria os preços especiais descartados e subtrai os
   * pontos de fidelidade que tinham sido somados.
   */
  private async desfazerCliente(
    m: { id: string; principalId: string; absorvidoId: string },
    snap: Record<string, unknown>,
    empresaId: string,
  ): Promise<void> {
    const absorvido = this.objeto(snap.absorvido);
    const migrados = this.objeto(snap.migradosSimples);
    const ids = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : []);
    const rows = (v: unknown): Record<string, unknown>[] =>
      Array.isArray(v) ? (v as Record<string, unknown>[]) : [];

    await this.prisma.$transaction(async (tx) => {
      // Recria o cliente com o MESMO id — é o que faz os vínculos voltarem a bater.
      await tx.cliente.create({
        data: this.desserializarCliente(absorvido, empresaId),
      });

      // Dependentes simples: devolve EXATAMENTE os ids que vieram do absorvido
      // (guardados por modelo no snapshot) — não arrasta o que já era do principal.
      for (const modelo of Object.keys(migrados)) {
        const lista = ids(migrados[modelo]);
        if (lista.length === 0) continue;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (tx as any)[modelo].updateMany({
          where: { id: { in: lista } },
          data: { clienteId: m.absorvidoId },
        });
      }

      // Tags migradas voltam pro absorvido.
      const tagsMig = ids(snap.tagsMigradas);
      if (tagsMig.length > 0) {
        await tx.clienteTag.updateMany({
          where: { clienteId: m.principalId, tagId: { in: tagsMig } },
          data: { clienteId: m.absorvidoId },
        });
      }
      // Tags descartadas (o principal já tinha) são recriadas no absorvido.
      for (const tagId of ids(snap.tagsDescartadas)) {
        await tx.clienteTag.create({ data: { clienteId: m.absorvidoId, tagId } });
      }

      // Preços migrados voltam; preços descartados são recriados no absorvido.
      const precoMig = ids(snap.precoMigrado);
      if (precoMig.length > 0) {
        await tx.clientePrecoEspecial.updateMany({
          where: { id: { in: precoMig } },
          data: { clienteId: m.absorvidoId },
        });
      }
      for (const p of rows(snap.precoDescartado)) {
        await tx.clientePrecoEspecial.create({
          data: this.desserializarPreco(p),
        });
      }

      // Pontos de fidelidade: subtrai o que foi somado e recria o saldo do absorvido.
      const pontos = typeof snap.pontosAbsorvidos === 'number' ? snap.pontosAbsorvidos : 0;
      if (pontos !== 0) {
        await tx.saldoFidelidade
          .update({
            where: { clienteId: m.principalId },
            data: { pontos: { decrement: pontos } },
          })
          .catch(() => undefined);
        await tx.saldoFidelidade.create({
          data: { empresaId, clienteId: m.absorvidoId, pontos },
        });
      }

      // Devolve o principal ao estado anterior (campos preenchidos no merge).
      if (Object.keys(this.objeto(snap.principalAntes)).length > 0) {
        await tx.cliente.update({
          where: { id: m.principalId },
          data: this.objeto(snap.principalAntes) as Prisma.ClienteUpdateInput,
        });
      }

      await tx.mesclagemContato.update({
        where: { id: m.id },
        data: { desfeitaEm: new Date() },
      });
    });

    this.logger.log(`Mesclagem ${m.id} (cliente) DESFEITA — cliente ${m.absorvidoId} restaurado`);
  }

  // ─── Desfazer ────────────────────────────────────────────────────────

  /** Reverte uma mesclagem: recria o absorvido e devolve cada vínculo migrado. */
  async desfazer(user: AuthenticatedUser, mesclagemId: string): Promise<{ desfeita: true }> {
    const empresaId = this.requireEmpresa(user);

    const m = await this.prisma.mesclagemContato.findFirst({
      where: { id: mesclagemId, empresaId },
    });
    if (!m) throw new NotFoundException('Mesclagem', mesclagemId);
    if (m.desfeitaEm) throw new BusinessRuleException('Esta mesclagem já foi desfeita');
    // Desfazer respeita a MESMA permissão da mesclagem original: cliente é fiscal.
    if (m.tipo === 'cliente_cliente') this.assertPodeMesclarCliente(user);
    else this.assertPodeMesclar(user);

    const snap = this.objeto(m.snapshot);

    if (m.tipo === 'cliente_cliente') {
      await this.desfazerCliente(m, snap, empresaId);
      return { desfeita: true };
    }

    if (m.tipo === 'lead_cliente') {
      const anterior = snap.clienteIdAnterior;
      await this.prisma.$transaction([
        this.prisma.lead.updateMany({
          where: { id: m.absorvidoId, empresaId },
          data: { clienteId: typeof anterior === 'string' ? anterior : null },
        }),
        this.prisma.mesclagemContato.update({
          where: { id: m.id },
          data: { desfeitaEm: new Date() },
        }),
      ]);
      return { desfeita: true };
    }

    const absorvido = this.objeto(snap.absorvido);
    const antes = this.objeto(snap.principalAntes);
    const migrados = this.objeto(snap.migrados);

    await this.prisma.$transaction(async (tx) => {
      // Recria o lead com o MESMO id — é o que faz os vínculos voltarem a bater.
      await tx.lead.create({ data: this.desserializar(absorvido, empresaId) });

      const ids = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : []);
      const tagIds = ids(migrados.tags);
      if (tagIds.length > 0) {
        await tx.leadTag.updateMany({
          where: { leadId: m.principalId, tagId: { in: tagIds } },
          data: { leadId: m.absorvidoId },
        });
      }
      for (const [modelo, lista] of [
        ['leadEtapaHistorico', ids(migrados.historicoEtapas)],
        ['conversation', ids(migrados.conversas)],
        ['formularioResposta', ids(migrados.formularios)],
      ] as const) {
        if (lista.length === 0) continue;
        if (modelo === 'leadEtapaHistorico') {
          await tx.leadEtapaHistorico.updateMany({
            where: { id: { in: lista } },
            data: { leadId: m.absorvidoId },
          });
        } else if (modelo === 'conversation') {
          await tx.conversation.updateMany({
            where: { id: { in: lista }, empresaId },
            data: { leadId: m.absorvidoId },
          });
        } else {
          await tx.formularioResposta.updateMany({
            where: { id: { in: lista } },
            data: { leadId: m.absorvidoId },
          });
        }
      }

      // Devolve o principal ao estado anterior (campos preenchidos + atribuição).
      await tx.lead.update({
        where: { id: m.principalId },
        data: {
          ...(antes as Prisma.LeadUpdateInput),
          variaveis: (antes.variaveis ?? {}) as Prisma.InputJsonValue,
        },
      });

      await tx.mesclagemContato.update({
        where: { id: m.id },
        data: { desfeitaEm: new Date() },
      });
    });

    this.logger.log(`Mesclagem ${mesclagemId} DESFEITA — lead ${m.absorvidoId} restaurado`);
    return { desfeita: true };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────

  private async carregarPar(empresaId: string, principalId: string, absorvidoId: string) {
    if (principalId === absorvidoId) {
      throw new BusinessRuleException('Não dá pra mesclar um contato com ele mesmo');
    }
    const leads = await this.prisma.lead.findMany({
      where: { id: { in: [principalId, absorvidoId] }, empresaId },
    });
    const principal = leads.find((l) => l.id === principalId);
    const absorvido = leads.find((l) => l.id === absorvidoId);
    if (!principal) throw new NotFoundException('Lead', principalId);
    if (!absorvido) throw new NotFoundException('Lead', absorvidoId);
    return { principal, absorvido };
  }

  /**
   * Atribuição do registro MAIS ANTIGO — ele é quem trouxe o contato. Mesmo
   * princípio do 1º-toque-vence que já vale na recaptura de lead duplicado.
   * Se o mais antigo não tem rastreio, cai no outro (melhor ter a campanha de um
   * do que perder as duas).
   */
  private resolverAtribuicao(
    a: {
      criadoEm: Date;
      utmSource: string | null;
      utmMedium: string | null;
      utmCampaign: string | null;
      origemCadastro: string | null;
    },
    b: {
      criadoEm: Date;
      utmSource: string | null;
      utmMedium: string | null;
      utmCampaign: string | null;
      origemCadastro: string | null;
    },
  ) {
    const [velho, novo] = a.criadoEm <= b.criadoEm ? [a, b] : [b, a];
    const temRastreio = !!velho.utmCampaign || !!velho.utmSource || !!velho.utmMedium;
    const fonte = temRastreio ? velho : novo;
    return {
      utmSource: fonte.utmSource,
      utmMedium: fonte.utmMedium,
      utmCampaign: fonte.utmCampaign,
      // Porta de entrada é sempre do mais antigo quando ele tem uma.
      origemCadastro: velho.origemCadastro ?? novo.origemCadastro,
    };
  }

  /**
   * Campos do absorvido que preenchem BURACO no principal. Nunca sobrescreve
   * valor já preenchido — o usuário escolheu quem é o principal, os dados dele
   * mandam.
   */
  private camposAPreencher(
    principal: Record<string, unknown>,
    absorvido: Record<string, unknown>,
  ): Array<{ campo: string; valor: unknown }> {
    const candidatos = [
      'contatoNome',
      'contatoEmail',
      'contatoTelefone',
      'cidade',
      'uf',
      'segmento',
      'observacoes',
      'proximaAcao',
      'clienteId',
      'representanteId',
    ];
    const out: Array<{ campo: string; valor: unknown }> = [];
    for (const campo of candidatos) {
      const vazio =
        principal[campo] === null || principal[campo] === undefined || principal[campo] === '';
      if (
        vazio &&
        absorvido[campo] !== null &&
        absorvido[campo] !== undefined &&
        absorvido[campo] !== ''
      ) {
        out.push({ campo, valor: absorvido[campo] });
      }
    }
    return out;
  }

  private objeto(v: unknown): Record<string, unknown> {
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  }

  /** Lead → JSON serializável (Decimal e Date não sobrevivem crus no snapshot). */
  private serializar(lead: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(lead)) {
      if (v instanceof Date) out[k] = v.toISOString();
      else if (v instanceof Prisma.Decimal) out[k] = v.toString();
      else out[k] = v;
    }
    return out;
  }

  /** JSON do snapshot → payload de create (desfaz a serialização acima). */
  private desserializar(
    snap: Record<string, unknown>,
    empresaId: string,
  ): Prisma.LeadUncheckedCreateInput {
    const datas = [
      'criadoEm',
      'atualizadoEm',
      'etapaDesde',
      'fechadoEm',
      'ultimaMensagemEm',
      'proximoSlaEm',
    ];
    const out: Record<string, unknown> = { ...snap, empresaId };
    for (const d of datas) {
      if (typeof out[d] === 'string') out[d] = new Date(out[d] as string);
    }
    return out as unknown as Prisma.LeadUncheckedCreateInput;
  }

  /** Snapshot de Cliente → payload de create (Decimal/Date de volta). */
  private desserializarCliente(
    snap: Record<string, unknown>,
    empresaId: string,
  ): Prisma.ClienteUncheckedCreateInput {
    const datas = ['criadoEm', 'atualizadoEm', 'ultimoPedidoEm', 'reativacaoDisparadaEm'];
    const out: Record<string, unknown> = { ...snap, empresaId };
    for (const d of datas) {
      if (typeof out[d] === 'string') out[d] = new Date(out[d] as string);
    }
    // limiteCredito é Decimal — Prisma coage string/number no write, mas normaliza.
    if (out.limiteCredito != null)
      out.limiteCredito = new Prisma.Decimal(String(out.limiteCredito));
    return out as unknown as Prisma.ClienteUncheckedCreateInput;
  }

  /** Snapshot de ClientePrecoEspecial → payload de create. */
  private desserializarPreco(
    snap: Record<string, unknown>,
  ): Prisma.ClientePrecoEspecialUncheckedCreateInput {
    const out: Record<string, unknown> = { ...snap };
    for (const d of ['criadoEm', 'atualizadoEm', 'validoAte', 'validoDe']) {
      if (typeof out[d] === 'string') out[d] = new Date(out[d] as string);
    }
    if (out.precoEspecial != null)
      out.precoEspecial = new Prisma.Decimal(String(out.precoEspecial));
    return out as unknown as Prisma.ClientePrecoEspecialUncheckedCreateInput;
  }
}
