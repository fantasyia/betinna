import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { type CampanhaCanal, Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { PrismaService } from '@database/prisma.service';
import {
  BusinessRuleException,
  ForbiddenException,
  NotFoundException,
} from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { RepScopeService } from '@shared/scope/rep-scope.service';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { type Paginated, buildPaginated } from '@shared/types/pagination';
import { CAMPANHA_ENVIO_QUEUE, type CampanhaEnvioJobData } from './campanha-envio.types';
import type {
  AgendarCampanhaDto,
  CreateCampanhaDto,
  ListCampanhasDto,
  UpdateCampanhaDto,
} from './campanhas.dto';

// ─── Tipos retornados ─────────────────────────────────────────────────────────

const campanhaInclude = {
  criadoPor: { select: { id: true, nome: true } },
  _count: { select: { destinatarios: true } },
} satisfies Prisma.CampanhaInclude;

// PERF: cap nos destinatarios. findById é retornado por disparar/pausar/cancelar/update (15
// call-sites) — sem take, cada AÇÃO puxava/serializava a campanha INTEIRA (milhares de linhas +
// join em cliente). O front descarta o retorno das ações (faz refetch) e o detalhe mostra a lista
// via GET separado; cap em 1000 bounda o pior caso (o _count dá o total real). Paginação dedicada
// de destinatarios = follow-up.
const DESTINATARIOS_DETALHE_CAP = 1000;
/** Teto de audiência pra campanha com IA: cada destinatário = 1 chamada LLM (custo real). */
const MAX_DESTINATARIOS_IA = 5000;

const campanhaDetalheInclude = {
  ...campanhaInclude,
  destinatarios: {
    take: DESTINATARIOS_DETALHE_CAP,
    orderBy: { criadoEm: Prisma.SortOrder.asc },
    select: {
      id: true,
      clienteId: true,
      cliente: { select: { nome: true } },
      email: true,
      telefone: true,
      status: true,
      erro: true,
      enviadoEm: true,
      lido: true,
      lidoEm: true,
    },
  },
} satisfies Prisma.CampanhaInclude;

type CampanhaList = Prisma.CampanhaGetPayload<{ include: typeof campanhaInclude }>;
type CampanhaDetalhe = Prisma.CampanhaGetPayload<{ include: typeof campanhaDetalheInclude }>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Sanitiza e formata telefone para JID do WhatsApp (55XX9XXXXYYYY@s.whatsapp.net). */
export function toWhatsAppJid(telefone: string): string {
  const digits = telefone.replace(/\D/g, '');
  const withCountry = digits.startsWith('55') ? digits : `55${digits}`;
  return `${withCountry}@s.whatsapp.net`;
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class CampanhasService {
  private readonly logger = new Logger(CampanhasService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repScope: RepScopeService,
    @InjectQueue(CAMPANHA_ENVIO_QUEUE) private readonly queue: Queue<CampanhaEnvioJobData>,
  ) {}

  // ─── Auth helpers ────────────────────────────────────────────────────────

  private requireEmpresa(user: AuthenticatedUser): string {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    return user.empresaIdAtiva;
  }

  /** REP/GERENTE não acessa campanhas — somente ADMIN/DIRECTOR/SAC/GERENTE com permissão. */
  private async baseWhere(user: AuthenticatedUser): Promise<Prisma.CampanhaWhereInput> {
    const empresaId = this.requireEmpresa(user);
    const where: Prisma.CampanhaWhereInput = { empresaId };
    // REP vê somente as campanhas que criou
    const scope = await this.repScope.getRepIds(user);
    if (scope !== null && user.role === 'REP') {
      where.criadoPorId = user.id;
    }
    return where;
  }

  // ─── CRUD ────────────────────────────────────────────────────────────────

  async list(user: AuthenticatedUser, params: ListCampanhasDto): Promise<Paginated<CampanhaList>> {
    const where: Prisma.CampanhaWhereInput = { ...(await this.baseWhere(user)) };
    const conds: Prisma.CampanhaWhereInput[] = [];

    if (params.status) conds.push({ status: params.status });
    if (params.canal) conds.push({ canal: params.canal });
    if (params.search) {
      conds.push({ nome: { contains: params.search, mode: 'insensitive' } });
    }
    if (conds.length > 0) where.AND = conds;

    const [total, data] = await Promise.all([
      this.prisma.campanha.count({ where }),
      this.prisma.campanha.findMany({
        where,
        skip: (params.page - 1) * params.limit,
        take: params.limit,
        orderBy: { criadoEm: 'desc' },
        include: campanhaInclude,
      }),
    ]);
    return buildPaginated(data, total, params.page, params.limit);
  }

  async findById(user: AuthenticatedUser, id: string): Promise<CampanhaDetalhe> {
    const c = await this.prisma.campanha.findFirst({
      where: { id, ...(await this.baseWhere(user)) },
      include: campanhaDetalheInclude,
    });
    if (!c) throw new NotFoundException('Campanha', id);
    return c;
  }

  async create(user: AuthenticatedUser, dto: CreateCampanhaDto): Promise<CampanhaDetalhe> {
    const empresaId = this.requireEmpresa(user);
    const status = dto.agendadoPara ? 'AGENDADA' : 'RASCUNHO';

    const campanha = await this.prisma.campanha.create({
      data: {
        empresaId,
        criadoPorId: user.id,
        nome: dto.nome,
        canal: dto.canal,
        status,
        segTagIds: dto.segTagIds,
        segRepIds: dto.segRepIds,
        segClienteIds: dto.segClienteIds,
        assunto: dto.assunto,
        mensagemWa: dto.mensagemWa,
        mensagemEmail: dto.mensagemEmail,
        objetivo: dto.objetivo,
        usarIaPersonalizacao: dto.usarIaPersonalizacao,
        agendadoPara: dto.agendadoPara,
      },
      select: { id: true },
    });

    this.logger.log(`Campanha "${dto.nome}" criada como ${status} por ${user.nome}`);
    return this.findById(user, campanha.id);
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateCampanhaDto,
  ): Promise<CampanhaDetalhe> {
    const existing = await this.findById(user, id);
    if (existing.status !== 'RASCUNHO') {
      throw new BusinessRuleException(
        'Apenas campanhas em RASCUNHO podem ser editadas. Cancele e recrie para alterar.',
      );
    }
    await this.prisma.campanha.update({ where: { id }, data: dto });
    return this.findById(user, id);
  }

  async remove(user: AuthenticatedUser, id: string): Promise<void> {
    const existing = await this.findById(user, id);
    if (!['RASCUNHO', 'CANCELADA'].includes(existing.status)) {
      throw new BusinessRuleException(
        'Apenas campanhas em RASCUNHO ou CANCELADA podem ser excluídas.',
      );
    }
    await this.prisma.campanha.delete({ where: { id } });
  }

  // ─── Workflow ────────────────────────────────────────────────────────────

  async agendar(
    user: AuthenticatedUser,
    id: string,
    dto: AgendarCampanhaDto,
  ): Promise<CampanhaDetalhe> {
    const existing = await this.findById(user, id);
    if (!['RASCUNHO', 'PAUSADA'].includes(existing.status)) {
      throw new BusinessRuleException(`Campanha em ${existing.status} não pode ser agendada`);
    }
    await this.prisma.campanha.update({
      where: { id },
      data: { status: 'AGENDADA', agendadoPara: dto.agendadoPara },
    });
    return this.findById(user, id);
  }

  /**
   * Dispara a campanha imediatamente:
   * 1. Resolve destinatários pelo segmento
   * 2. Cria registros CampanhaDestinatario (PENDENTE)
   * 3. Enfileira 1 job BullMQ por destinatário
   * 4. Muda status → ENVIANDO
   */
  async disparar(user: AuthenticatedUser, id: string): Promise<CampanhaDetalhe> {
    const campanha = await this.findById(user, id);

    if (!['RASCUNHO', 'AGENDADA'].includes(campanha.status)) {
      throw new BusinessRuleException(
        `Campanha em status ${campanha.status} não pode ser disparada`,
        ErrorCode.CAMPANHA_NAO_PODE_DISPARAR,
      );
    }

    // AUDITORIA P0-3: lock otimista — só uma chamada concorrente passa.
    // Move status RASCUNHO/AGENDADA → ENVIANDO em uma transação atômica.
    const claim = await this.prisma.campanha.updateMany({
      where: { id, status: { in: ['RASCUNHO', 'AGENDADA'] } },
      data: { status: 'ENVIANDO', iniciadoEm: new Date() },
    });
    if (claim.count === 0) {
      throw new BusinessRuleException(
        'Campanha já está em disparo (concorrência) ou status mudou',
        ErrorCode.CAMPANHA_NAO_PODE_DISPARAR,
      );
    }

    const destinatarios = await this.resolverDestinatarios(campanha);
    if (destinatarios.length === 0) {
      // Reverte status pra estado prévio coerente (RASCUNHO)
      await this.prisma.campanha.update({
        where: { id },
        data: { status: 'RASCUNHO', iniciadoEm: null },
      });
      throw new BusinessRuleException(
        'Nenhum destinatário encontrado para o segmento configurado',
        ErrorCode.CAMPANHA_SEM_DESTINATARIOS,
      );
    }

    // Teto de audiência quando há personalização por IA: cada destinatário custa 1 chamada
    // LLM. Sem cap, uma campanha gigante estoura custo/tempo. (Campanha sem IA = interpolação
    // simples, sem esse custo → não limitada aqui.)
    if (campanha.usarIaPersonalizacao && destinatarios.length > MAX_DESTINATARIOS_IA) {
      await this.prisma.campanha.update({
        where: { id },
        data: { status: 'RASCUNHO', iniciadoEm: null },
      });
      throw new BusinessRuleException(
        `Campanha com personalização por IA é limitada a ${MAX_DESTINATARIOS_IA} destinatários ` +
          `(encontrados ${destinatarios.length}). Refine o segmento ou desligue a IA.`,
        ErrorCode.CAMPANHA_NAO_PODE_DISPARAR,
      );
    }

    // Remove pendentes anteriores (re-disparo seguro)
    await this.prisma.campanhaDestinatario.deleteMany({
      where: { campanhaId: id, status: 'PENDENTE' },
    });

    // CAÇADA-BUG #7: após deletar os PENDENTE, o que sobra são destinatários JÁ PROCESSADOS
    // (ENVIADO/LIDO/ERRO) de um disparo anterior (ex.: campanha pausada no meio e reagendada).
    // Recriar o segmento INTEIRO geraria uma linha nova (= nova chave de idempotência) pra quem já
    // recebeu → mensagem duplicada em massa. Excluímos esses clientes da recriação. Reenvio de ERRO
    // é feito pelo fluxo dedicado `reenviar-erros`, não pelo disparar.
    const jaProcessados = await this.prisma.campanhaDestinatario.findMany({
      where: { campanhaId: id },
      select: { clienteId: true },
    });
    const clientesJaProcessados = new Set(
      jaProcessados.map((d) => d.clienteId).filter((c): c is string => !!c),
    );
    const novosDestinatarios = destinatarios.filter((d) => !clientesJaProcessados.has(d.clienteId));

    // Cria todos os destinatários em bulk (só os que ainda não foram atingidos nesta campanha)
    await this.prisma.campanhaDestinatario.createMany({
      data: novosDestinatarios.map((d) => ({
        campanhaId: id,
        clienteId: d.clienteId,
        email: d.email,
        telefone: d.telefone,
      })),
    });

    // Carrega IDs criados para enfileirar
    const criados = await this.prisma.campanhaDestinatario.findMany({
      where: { campanhaId: id, status: 'PENDENTE' },
      select: { id: true },
    });

    // Enfileira jobs com retry (idempotency garante anti-duplicação no processor)
    // Auditoria 2026-05-15 P0-1+P0-5: retry seguro porque processor faz claim
    // idempotente ANTES de cada envio externo.
    await Promise.all(
      criados.map((d, i) =>
        this.queue.add(
          'enviar',
          { campanhaId: id, destinatarioId: d.id },
          {
            delay: i * 1500, // 1.5s entre cada mensagem (anti-spam WA)
            attempts: 3,
            backoff: { type: 'exponential', delay: 5_000 },
            removeOnComplete: { count: 500 },
            removeOnFail: { count: 200 },
          },
        ),
      ),
    );

    this.logger.log(
      `Campanha "${campanha.nome}" disparada · ${criados.length} destinatários · canal ${campanha.canal}`,
    );
    return this.findById(user, id);
  }

  async pausar(user: AuthenticatedUser, id: string): Promise<CampanhaDetalhe> {
    const existing = await this.findById(user, id);
    if (existing.status !== 'ENVIANDO') {
      throw new BusinessRuleException('Somente campanhas em ENVIANDO podem ser pausadas');
    }
    await this.prisma.campanha.update({ where: { id }, data: { status: 'PAUSADA' } });
    return this.findById(user, id);
  }

  async cancelar(user: AuthenticatedUser, id: string): Promise<CampanhaDetalhe> {
    const existing = await this.findById(user, id);
    if (['ENVIADA', 'CANCELADA'].includes(existing.status)) {
      throw new BusinessRuleException(`Campanha em ${existing.status} não pode ser cancelada`);
    }
    await this.prisma.campanha.update({ where: { id }, data: { status: 'CANCELADA' } });
    return this.findById(user, id);
  }

  /**
   * Reenfileira o envio APENAS para os destinatários que deram ERRO.
   * Só vale pra campanha já ENVIADA. Lock otimista ENVIADA→ENVIANDO garante que
   * só uma chamada concorrente passa; o processor finaliza de volta pra ENVIADA
   * quando os PENDENTE acabarem.
   *
   * Nota: em WHATSAPP_EMAIL onde o WA foi enviado mas o e-mail falhou, a
   * idempotência (TTL 24h) evita reenviar o WA — desde que o reenvio aconteça
   * dentro da janela. Após 24h o WA poderia reenviar.
   */
  async reenviarErros(user: AuthenticatedUser, id: string): Promise<CampanhaDetalhe> {
    const campanha = await this.findById(user, id);

    if (campanha.status !== 'ENVIADA') {
      throw new BusinessRuleException(
        'Apenas campanhas já enviadas (ENVIADA) podem ter as falhas reenviadas.',
      );
    }

    const comErro = await this.prisma.campanhaDestinatario.findMany({
      where: { campanhaId: id, status: 'ERRO' },
      select: { id: true },
    });
    if (comErro.length === 0) {
      throw new BusinessRuleException('Nenhuma falha para reenviar nesta campanha.');
    }

    // Lock otimista: ENVIADA → ENVIANDO. Só uma chamada concorrente passa.
    const claim = await this.prisma.campanha.updateMany({
      where: { id, status: 'ENVIADA' },
      data: { status: 'ENVIANDO', finalizadoEm: null },
    });
    if (claim.count === 0) {
      throw new BusinessRuleException('Campanha mudou de estado (concorrência) — tente de novo.');
    }

    // Reseta os que deram erro → PENDENTE (limpa erro/enviadoEm pra reprocessar).
    await this.prisma.campanhaDestinatario.updateMany({
      where: { campanhaId: id, status: 'ERRO' },
      data: { status: 'PENDENTE', erro: null, enviadoEm: null },
    });

    // Re-enfileira só as falhas resetadas (mesmas opções do disparar).
    await Promise.all(
      comErro.map((d, i) =>
        this.queue.add(
          'enviar',
          { campanhaId: id, destinatarioId: d.id },
          {
            delay: i * 1500,
            attempts: 3,
            backoff: { type: 'exponential', delay: 5_000 },
            removeOnComplete: { count: 500 },
            removeOnFail: { count: 200 },
          },
        ),
      ),
    );

    this.logger.log(`Campanha "${campanha.nome}" · reenfileiradas ${comErro.length} falha(s)`);
    return this.findById(user, id);
  }

  // ─── Métricas ────────────────────────────────────────────────────────────

  async metricas(
    user: AuthenticatedUser,
    id: string,
  ): Promise<{
    total: number;
    pendentes: number;
    enviados: number;
    lidos: number;
    erros: number;
    taxaEnvio: number;
    taxaLeitura: number;
  }> {
    await this.findById(user, id); // valida acesso

    const grupos = await this.prisma.campanhaDestinatario.groupBy({
      by: ['status'],
      where: { campanhaId: id },
      _count: { _all: true },
    });

    const byStatus: Record<string, number> = {};
    for (const g of grupos) byStatus[g.status] = g._count._all;

    const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
    const pendentes = byStatus['PENDENTE'] ?? 0;
    const enviados = byStatus['ENVIADO'] ?? 0;
    const lidos = byStatus['LIDO'] ?? 0;
    const erros = byStatus['ERRO'] ?? 0;

    return {
      total,
      pendentes,
      enviados,
      lidos,
      erros,
      taxaEnvio: total > 0 ? Math.round(((enviados + lidos) / total) * 100) : 0,
      taxaLeitura: enviados + lidos > 0 ? Math.round((lidos / (enviados + lidos)) * 100) : 0,
    };
  }

  async resumo(user: AuthenticatedUser): Promise<{
    total: number;
    rascunhos: number;
    agendadas: number;
    enviando: number;
    enviadas: number;
    alcanceUltimos30d: number;
  }> {
    const where = await this.baseWhere(user);
    const trintaDiasAtras = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [grupos, totalDestinatarios] = await Promise.all([
      this.prisma.campanha.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      }),
      this.prisma.campanhaDestinatario.count({
        where: {
          campanha: { ...where, criadoEm: { gte: trintaDiasAtras } },
          status: { in: ['ENVIADO', 'LIDO'] },
        },
      }),
    ]);

    const byStatus: Record<string, number> = {};
    for (const g of grupos) byStatus[g.status] = g._count._all;

    return {
      // Total de campanhas (soma de todos os status) — o front exibe no card "Total".
      total: grupos.reduce((soma, g) => soma + g._count._all, 0),
      rascunhos: byStatus['RASCUNHO'] ?? 0,
      agendadas: byStatus['AGENDADA'] ?? 0,
      enviando: byStatus['ENVIANDO'] ?? 0,
      enviadas: byStatus['ENVIADA'] ?? 0,
      // Renomeado de totalDestinatariosUltimos30d → alcanceUltimos30d (contrato do front).
      alcanceUltimos30d: totalDestinatarios,
    };
  }

  // ─── Interno ─────────────────────────────────────────────────────────────

  /**
   * Resolve o segmento da campanha em lista de destinatários com contatos.
   * Internamente chamado por disparar() e pelo scheduler.
   */
  async resolverDestinatarios(campanha: {
    empresaId: string;
    canal: CampanhaCanal;
    segTagIds: string[];
    segRepIds: string[];
    segClienteIds: string[];
  }): Promise<Array<{ clienteId: string; email: string | null; telefone: string | null }>> {
    const needsWa = campanha.canal !== 'EMAIL';
    const needsEmail = campanha.canal !== 'WHATSAPP';

    const where: Prisma.ClienteWhereInput = {
      empresaId: campanha.empresaId,
      omieStatus: 'ATIVO',
    };

    if (campanha.segClienteIds.length > 0) {
      where.id = { in: campanha.segClienteIds };
    } else {
      const and: Prisma.ClienteWhereInput[] = [];
      if (campanha.segTagIds.length > 0) {
        and.push({ tags: { some: { tagId: { in: campanha.segTagIds } } } });
      }
      if (campanha.segRepIds.length > 0) {
        and.push({ representanteId: { in: campanha.segRepIds } });
      }
      if (and.length > 0) where.AND = and;
    }

    // Exige ao menos um contato válido para o canal
    const orContact: Prisma.ClienteWhereInput[] = [];
    if (needsWa) orContact.push({ telefone: { not: null } });
    if (needsEmail) orContact.push({ email: { not: null } });
    if (orContact.length > 0) where.OR = orContact;

    const clientes = await this.prisma.cliente.findMany({
      where,
      // #R5 — ORDEM ESTÁVEL: o dedup abaixo elege sempre o MESMO clienteId entre re-disparos. Sem isto
      // (ordem de plano do Postgres), um re-disparo (campanha pausada+reagendada) podia eleger OUTRO
      // clienteId pro mesmo contato → ele não constava nos jaProcessados → a MESMA pessoa recebia 2x.
      orderBy: { id: 'asc' },
      select: { id: true, email: true, telefone: true },
    });

    // CAÇADA-BUG #38 + #R5: dedup por CONTATO e POR CANAL. Dois clientes com o mesmo telefone/e-mail
    // (matriz/filial, ou duplicata de import — sem unique de fone) geravam envio 2x pra mesma pessoa.
    // telefone e e-mail deduplicam SEPARADAMENTE: no canal duplo, deduplicar por um contato só fazia
    // (a) 2 clientes de mesmo e-mail e fones distintos mandarem e-mail 2x, e (b) 2 de mesmo fone e
    // e-mails distintos derrubarem o 2º inteiro — o e-mail exclusivo dele nunca saía. Vence o 1º
    // (ordem estável). Contato duplicado no canal → anula SÓ aquele contato (não o destinatário todo).
    const telsVistos = new Set<string>();
    const emailsVistos = new Set<string>();
    const destinatarios: Array<{
      clienteId: string;
      email: string | null;
      telefone: string | null;
    }> = [];
    for (const c of clientes) {
      // Trim + `|| null`: telefone/e-mail em branco ('') passa o filtro `not: null` do banco; sem isto
      // virava JID/e-mail inválido e um destinatário sem contato era marcado ENVIADO sem enviar nada.
      const foneRaw = needsWa ? c.telefone?.trim() || null : null;
      const emailRaw = needsEmail ? c.email?.trim() || null : null;
      let telefone = foneRaw ? toWhatsAppJid(foneRaw) : null;
      let email = emailRaw;
      if (telefone) {
        if (telsVistos.has(telefone))
          telefone = null; // outro destinatário já cobre esse WhatsApp
        else telsVistos.add(telefone);
      }
      if (email) {
        const chaveEmail = email.toLowerCase();
        if (emailsVistos.has(chaveEmail))
          email = null; // outro destinatário já cobre esse e-mail
        else emailsVistos.add(chaveEmail);
      }
      // Sem contato útil pra NENHUM canal → não cria destinatário (nada de ENVIADO fantasma).
      if (!telefone && !email) continue;
      destinatarios.push({ clienteId: c.id, email, telefone });
    }
    return destinatarios;
  }

  /**
   * Finaliza campanha quando todos os destinatários foram processados.
   * Chamado pelo processor após cada envio.
   */
  async tentarFinalizarCampanha(campanhaId: string): Promise<void> {
    const pendentes = await this.prisma.campanhaDestinatario.count({
      where: { campanhaId, status: 'PENDENTE' },
    });
    if (pendentes === 0) {
      await this.prisma.campanha.updateMany({
        where: { id: campanhaId, status: 'ENVIANDO' },
        data: { status: 'ENVIADA', finalizadoEm: new Date() },
      });
      this.logger.log(`Campanha ${campanhaId} finalizada`);
    }
  }
}
