import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { type SupabaseClient, createClient } from '@supabase/supabase-js';
import { EnvService } from '@config/env.service';
import { PrismaService } from '@database/prisma.service';
import {
  BusinessRuleException,
  ForbiddenException,
  IntegrationException,
  NotFoundException,
} from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { RepScopeService } from '@shared/scope/rep-scope.service';
import {
  type ComissaoDivergente,
  ContratoComissoesService,
} from '@modules/comissoes/contrato-comissoes.service';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { type Paginated, buildPaginated } from '@shared/types/pagination';
import type { ListContratosDto } from './contratos.dto';

/** Mesmo bucket em que o retorno da assinatura guarda o PDF. */
const BUCKET = 'contratos-assinados';
/** 1h: tempo de abrir e baixar, não de guardar o link. */
const URL_EXPIRA_S = 60 * 60;

/**
 * Os contratos, do lado de quem vende.
 *
 * O contrato assinado existia só como registro do fluxo de assinatura: o
 * documento ficava na ClickSign e o PDF num bucket privado, e o representante
 * não tinha como abrir o que o cliente dele assinou. Quando o cliente ligasse
 * perguntando um prazo, a resposta estaria em três sistemas — nenhum deles o
 * app.
 *
 * O rep vê os contratos da CARTEIRA dele (mesma regra de propostas e pedidos);
 * gestão vê todos.
 */
@Injectable()
export class ContratosService {
  private readonly logger = new Logger(ContratosService.name);
  private readonly storage: SupabaseClient;

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly repScope: RepScopeService,
    private readonly comissoes: ContratoComissoesService,
  ) {
    this.storage = createClient(
      this.env.get('SUPABASE_URL'),
      this.env.get('SUPABASE_SERVICE_ROLE_KEY'),
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
  }

  private requireEmpresa(user: AuthenticatedUser): string {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    return user.empresaIdAtiva;
  }

  private async where(user: AuthenticatedUser): Promise<Prisma.ContratoWhereInput> {
    const where: Prisma.ContratoWhereInput = { empresaId: this.requireEmpresa(user) };
    const escopo = await this.repScope.getRepIds(user);
    if (escopo !== null) where.representanteId = { in: escopo };
    return where;
  }

  async list(user: AuthenticatedUser, params: ListContratosDto): Promise<Paginated<unknown>> {
    const where = await this.where(user);
    if (params.status) where.status = params.status;
    if (params.clienteId) where.clienteId = params.clienteId;
    if (params.search) {
      where.OR = [
        { cliente: { nome: { contains: params.search, mode: 'insensitive' } } },
        { proposta: { numero: { contains: params.search, mode: 'insensitive' } } },
      ];
    }

    const [total, data] = await Promise.all([
      this.prisma.contrato.count({ where }),
      this.prisma.contrato.findMany({
        where,
        skip: (params.page - 1) * params.limit,
        take: params.limit,
        orderBy: { criadoEm: 'desc' },
        include: {
          cliente: { select: { id: true, nome: true, cnpj: true } },
          proposta: { select: { id: true, numero: true, modalidade: true } },
          representante: { select: { id: true, nome: true } },
        },
      }),
    ]);
    return buildPaginated(data, total, params.page, params.limit);
  }

  async findById(user: AuthenticatedUser, id: string) {
    const contrato = await this.prisma.contrato.findFirst({
      where: { ...(await this.where(user)), id },
      include: {
        cliente: { select: { id: true, nome: true, cnpj: true, email: true, telefone: true } },
        proposta: {
          select: {
            id: true,
            numero: true,
            modalidade: true,
            valor: true,
            signatarioNome: true,
            signatarioEmail: true,
            itens: { select: { produtoNome: true, quantidade: true, total: true } },
          },
        },
        representante: { select: { id: true, nome: true } },
      },
    });
    if (!contrato) throw new NotFoundException('Contrato', id);
    return contrato;
  }

  /**
   * Link temporário pro PDF assinado.
   *
   * O bucket é privado de propósito — contrato tem CNPJ, valor e assinatura de
   * gente. URL assinada de 1h é o suficiente pra abrir e baixar; guardar o link
   * não serve de nada, e é isso que se quer.
   */
  async pdf(
    user: AuthenticatedUser,
    id: string,
  ): Promise<{ url: string; expiraEmSegundos: number; nome: string }> {
    const contrato = await this.findById(user, id);
    if (!contrato.documentoUrl) {
      throw new BusinessRuleException(
        contrato.status === 'ASSINADO'
          ? 'Contrato assinado, mas o PDF não chegou a ser guardado. Baixe pela ClickSign.'
          : 'Contrato ainda não foi assinado — não existe PDF assinado.',
      );
    }
    const { data, error } = await this.storage.storage
      .from(BUCKET)
      .createSignedUrl(contrato.documentoUrl, URL_EXPIRA_S);
    if (error || !data?.signedUrl) {
      throw new IntegrationException(
        `Não consegui gerar o link do contrato: ${error?.message ?? 'sem retorno'}`,
      );
    }
    return {
      url: data.signedUrl,
      expiraEmSegundos: URL_EXPIRA_S,
      nome: `contrato-${contrato.proposta.numero}.pdf`,
    };
  }
  /**
   * Refaz as comissões do contrato pela regra ATUAL do tenant.
   *
   * Confere o tenant antes: recalcular contrato de outra empresa mexeria em
   * dinheiro que não é de quem pediu.
   */
  async recalcularComissoes(
    empresaId: string,
    contratoId: string,
  ): Promise<{ contratoId: string; linhas: number; divergentes: ComissaoDivergente[] }> {
    const contrato = await this.prisma.contrato.findFirst({
      where: { id: contratoId, empresaId },
      select: { id: true },
    });
    if (!contrato) throw new NotFoundException('Contrato', contratoId);

    const divergentes = await this.comissoes.recalcular(contratoId);

    const linhas = await this.prisma.contratoComissao.count({ where: { contratoId } });
    // `divergentes` = o que o recálculo NÃO pôde corrigir porque já virou conta a
    // pagar no ERP. Vai na resposta porque é a única coisa aqui que exige ação
    // humana — e a API do Tiny não altera nem apaga conta.
    return { contratoId, linhas, divergentes };
  }
}
