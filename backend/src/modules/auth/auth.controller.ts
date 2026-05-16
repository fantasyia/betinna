import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle, seconds } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { timingSafeEqual } from 'node:crypto';
import type {
  CanalOrigem,
  ClienteStatus,
  LeadEtapa,
  PagamentoForma,
  PedidoStatus,
} from '@prisma/client';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { EnvService } from '@config/env.service';
import { PrismaService } from '@database/prisma.service';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { Public } from '@shared/decorators/public.decorator';
import { ForbiddenException, UnauthorizedException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { RefreshTokenService } from './refresh-token.service';

/**
 * Comparação constant-time pra evitar timing attack em tokens de bootstrap.
 *
 * Se strings têm comprimentos diferentes, dummy compare pra manter tempo
 * constante mesmo na rejeição (Node `timingSafeEqual` lança RangeError em
 * tamanhos diferentes — bypassamos comparando dummy de mesmo tamanho).
 */
function safeTokenEquals(provided: string, expected: string): boolean {
  const providedBuf = Buffer.from(provided, 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');
  if (providedBuf.length !== expectedBuf.length) {
    // Compara dummy de mesmo tamanho pra não vazar comprimento via timing
    timingSafeEqual(expectedBuf, expectedBuf);
    return false;
  }
  return timingSafeEqual(providedBuf, expectedBuf);
}

const refreshTrackSchema = z.object({
  refreshToken: z.string().min(20),
});
type RefreshTrackDto = z.infer<typeof refreshTrackSchema>;

const bootstrapSchema = z.object({
  email: z.string().email(),
  nome: z.string().min(2).max(150).optional().default('Diretor Betinna'),
  empresaNome: z.string().min(2).max(200).optional().default('Indústria Alimentos'),
  empresaCnpj: z.string().optional().default('00.000.000/0001-00'),
});
type BootstrapDto = z.infer<typeof bootstrapSchema>;

const seedDemoSchema = z.object({
  /** Opção: rodar mesmo se já há clientes (sobrescreve). Default: idempotente */
  force: z.boolean().optional().default(false),
});
type SeedDemoDto = z.infer<typeof seedDemoSchema>;

@ApiTags('auth')
@ApiBearerAuth()
@Controller('auth')
// Auditoria Sprint 2: rate limit estrito em endpoints de auth.
// 10 req/15min por IP — bloqueia brute force / token enumeration.
@Throttle({ default: { limit: 10, ttl: seconds(15 * 60) } })
export class AuthController {
  constructor(
    private readonly refreshTokens: RefreshTokenService,
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
  ) {}

  @Get('me')
  @ApiOperation({
    summary: 'Retorna o usuário autenticado (validação do JWT + carregamento do contexto)',
  })
  me(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }

  /**
   * Logout — invalida cache do AuthGuard + refresh tracking.
   * Frontend DEVE também chamar `supabase.auth.signOut()` para invalidar
   * o refresh token no Supabase (revoke).
   */
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Logout: invalida cache local + tracking de refresh' })
  async logout(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.refreshTokens.signOut(user);
  }

  /**
   * Endpoint de defesa em profundidade — frontend chama APÓS um refresh
   * bem-sucedido para registrar o novo `refreshToken` como o ATUAL.
   *
   * Se um token antigo for apresentado depois, detectamos reuse e
   * invalidamos todas as sessões do usuário.
   *
   * Supabase Auth já implementa rotation internamente; este endpoint é
   * camada EXTRA para detectar reuse no nosso lado.
   */
  @Post('refresh-track')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Registra novo refresh token como atual (chamado após refreshSession do Supabase)',
  })
  async trackRefresh(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(refreshTrackSchema)) dto: RefreshTrackDto,
  ): Promise<void> {
    // Hardening 2026-05-16 (ALTA-2): operação atômica CAS via Lua substitui
    // pair (assertCurrent + markCurrent) que tinha race condition entre tabs.
    await this.refreshTokens.registerCurrent(user.id, dto.refreshToken);
  }

  /**
   * Bootstrap one-time pra sincronizar admin Supabase Auth → Postgres
   * quando o seed não consegue rodar via CLI (ambientes restritos).
   *
   * Segurança:
   *  - Endpoint só funciona se BOOTSTRAP_TOKEN estiver setado no env
   *  - Requer header `Authorization: Bearer <BOOTSTRAP_TOKEN>` matching
   *  - SÓ executa se o banco estiver com 0 usuários (first-run check)
   *  - Idempotente em si — se rodar 2x não duplica registros
   *
   * Após primeira execução bem-sucedida, ao final, a flag de "0 users"
   * naturalmente se torna false (você acabou de criar 1) → endpoint vira
   * inativo automaticamente. Tem que apagar a env var BOOTSTRAP_TOKEN
   * depois ou apenas confiar no first-run check.
   */
  @Post('bootstrap')
  @Public()
  // Rate limit estrito — endpoint privilegiado
  @Throttle({ default: { limit: 3, ttl: seconds(15 * 60) } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'One-time admin bootstrap (sync Supabase Auth → Postgres). Requer header Authorization: Bearer BOOTSTRAP_TOKEN.',
  })
  async bootstrap(
    @Body(new ZodValidationPipe(bootstrapSchema)) dto: BootstrapDto,
    @Headers('authorization') auth: string | undefined,
  ): Promise<{
    ok: true;
    userId: string;
    empresaId: string;
    message: string;
  }> {
    const expectedToken = process.env.BOOTSTRAP_TOKEN;
    if (!expectedToken || expectedToken.length < 16) {
      throw new ForbiddenException(
        'Bootstrap endpoint não configurado (BOOTSTRAP_TOKEN ausente)',
        ErrorCode.AUTH_USER_DISABLED,
      );
    }
    const provided = (auth ?? '').replace(/^Bearer\s+/i, '').trim();
    // CRIT-1 fix: timing-safe compare evita ataque caractere-a-caractere
    if (!safeTokenEquals(provided, expectedToken)) {
      throw new UnauthorizedException('Token de bootstrap inválido', ErrorCode.AUTH_REQUIRED);
    }

    // First-run check — só permite quando ainda não há nenhum Usuario.
    // Isso evita uso indevido depois do go-live.
    const existingCount = await this.prisma.usuario.count();
    if (existingCount > 0) {
      throw new ForbiddenException(
        `Bootstrap só funciona em banco vazio. Já existem ${existingCount} usuário(s) — endpoint desabilitado automaticamente.`,
        ErrorCode.AUTH_USER_DISABLED,
      );
    }

    // Resolve Supabase user pelo email (usando service role key)
    const supabaseUrl = this.env.get('SUPABASE_URL');
    const serviceKey = this.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceKey) {
      throw new ForbiddenException(
        'Supabase não configurado no backend',
        ErrorCode.AUTH_USER_DISABLED,
      );
    }
    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: usersData, error: listErr } = await supabase.auth.admin.listUsers();
    if (listErr) {
      throw new ForbiddenException(
        `Falha ao listar usuários do Supabase: ${listErr.message}`,
        ErrorCode.AUTH_USER_DISABLED,
      );
    }
    const supabaseUser = usersData?.users?.find(
      (u) => u.email?.toLowerCase() === dto.email.toLowerCase(),
    );
    if (!supabaseUser) {
      throw new ForbiddenException(
        `Usuário ${dto.email} não encontrado no Supabase Auth. Crie via Authentication → Users antes.`,
        ErrorCode.AUTH_USER_DISABLED,
      );
    }

    // Cria empresa + usuario + link em uma transação
    const result = await this.prisma.$transaction(async (tx) => {
      const empresa = await tx.empresa.upsert({
        where: { cnpj: dto.empresaCnpj },
        update: {},
        create: {
          nome: dto.empresaNome,
          cnpj: dto.empresaCnpj,
          ramo: 'Alimentos B2B',
          cidade: 'São Paulo',
          uf: 'SP',
          subtitulo: 'Matriz',
          plano: 'Enterprise',
          ativo: true,
        },
      });

      const usuario = await tx.usuario.create({
        data: {
          id: supabaseUser.id,
          email: dto.email,
          nome: dto.nome,
          role: 'ADMIN',
          status: 'ATIVO',
          empresas: { create: { empresaId: empresa.id } },
        },
      });

      return { empresaId: empresa.id, userId: usuario.id };
    });

    return {
      ok: true,
      userId: result.userId,
      empresaId: result.empresaId,
      message: `Admin sincronizado com sucesso. Pode fazer login com ${dto.email}.`,
    };
  }

  /**
   * Popula o banco com dados de exemplo pra ver o sistema funcionando.
   *
   * Cria: tags, produtos, clientes, leads, amostras, ocorrências, pedidos.
   * Tudo vinculado à empresa do admin que rodou /bootstrap.
   *
   * Mesma segurança do /bootstrap:
   *  - Requer BOOTSTRAP_TOKEN matching
   *  - Idempotente por default (skip se já há > 0 clientes)
   *  - Use `force: true` no body pra sobrescrever
   */
  @Post('seed-demo')
  @Public()
  @Throttle({ default: { limit: 3, ttl: seconds(15 * 60) } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Popula o banco com dados de exemplo. Requer BOOTSTRAP_TOKEN.',
  })
  async seedDemo(
    @Body(new ZodValidationPipe(seedDemoSchema)) dto: SeedDemoDto,
    @Headers('authorization') auth: string | undefined,
  ): Promise<{ ok: true; created: Record<string, number>; message: string }> {
    const expectedToken = process.env.BOOTSTRAP_TOKEN;
    if (!expectedToken || expectedToken.length < 16) {
      throw new ForbiddenException(
        'Endpoint não configurado (BOOTSTRAP_TOKEN ausente)',
        ErrorCode.AUTH_USER_DISABLED,
      );
    }
    const provided = (auth ?? '').replace(/^Bearer\s+/i, '').trim();
    // CRIT-1 fix: timing-safe compare
    if (!safeTokenEquals(provided, expectedToken)) {
      throw new UnauthorizedException('Token inválido', ErrorCode.AUTH_REQUIRED);
    }

    // Pega o primeiro user ADMIN e a primeira empresa (assume que /bootstrap já rodou)
    const admin = await this.prisma.usuario.findFirst({
      where: { role: 'ADMIN' },
      include: { empresas: { select: { empresaId: true } } },
    });
    if (!admin || admin.empresas.length === 0) {
      throw new ForbiddenException(
        'Nenhum admin com empresa encontrado. Rode /auth/bootstrap primeiro.',
        ErrorCode.AUTH_USER_DISABLED,
      );
    }
    const empresaId = admin.empresas[0].empresaId;

    // Idempotência
    if (!dto.force) {
      const existingClientes = await this.prisma.cliente.count({ where: { empresaId } });
      if (existingClientes > 0) {
        throw new ForbiddenException(
          `Empresa já tem ${existingClientes} clientes. Use force:true pra rodar de novo.`,
          ErrorCode.AUTH_USER_DISABLED,
        );
      }
    }

    const created = {
      tags: 0,
      produtos: 0,
      clientes: 0,
      leads: 0,
      amostras: 0,
      ocorrencias: 0,
      pedidos: 0,
    };

    // ─── Tags ──────────────────────────────────────────────────────────
    const tagsData = [
      { nome: 'VIP', cor: '#facc15' },
      { nome: 'Premium', cor: '#7c3aed' },
      { nome: 'Inadimplente', cor: '#dc2626' },
      { nome: 'Novo cliente', cor: '#16a34a' },
    ];
    const tags = await Promise.all(
      tagsData.map((t) => this.prisma.tag.create({ data: { ...t, empresaId } }).catch(() => null)),
    );
    created.tags = tags.filter(Boolean).length;

    // ─── Produtos ──────────────────────────────────────────────────────
    const produtosData = [
      {
        nome: 'Açúcar Cristal 5kg',
        sku: 'ACU-CR-5KG',
        marca: 'União',
        categoria: 'Açúcares',
        linha: 'Doces',
        precoTabela: 28.5,
        precoFabrica: 22,
        estoque: 250,
        popularidade: 95,
      },
      {
        nome: 'Café Torrado 500g',
        sku: 'CAF-TR-500',
        marca: 'Pilão',
        categoria: 'Bebidas',
        linha: 'Café',
        precoTabela: 18.9,
        precoFabrica: 14,
        estoque: 180,
        popularidade: 88,
      },
      {
        nome: 'Óleo de Soja 900ml',
        sku: 'OLE-SO-900',
        marca: 'Soya',
        categoria: 'Óleos',
        linha: 'Cozinha',
        precoTabela: 7.5,
        precoFabrica: 5.8,
        estoque: 420,
        popularidade: 92,
      },
      {
        nome: 'Farinha de Trigo 1kg',
        sku: 'FAR-TR-1KG',
        marca: 'Dona Benta',
        categoria: 'Farinhas',
        linha: 'Panificação',
        precoTabela: 6.2,
        precoFabrica: 4.5,
        estoque: 350,
        popularidade: 80,
      },
      {
        nome: 'Arroz Branco 5kg',
        sku: 'ARR-BR-5KG',
        marca: 'Camil',
        categoria: 'Cereais',
        linha: 'Grãos',
        precoTabela: 32.0,
        precoFabrica: 25,
        estoque: 180,
        popularidade: 90,
      },
      {
        nome: 'Feijão Carioca 1kg',
        sku: 'FEI-CA-1KG',
        marca: 'Camil',
        categoria: 'Cereais',
        linha: 'Grãos',
        precoTabela: 9.8,
        precoFabrica: 7.5,
        estoque: 220,
        popularidade: 75,
      },
      {
        nome: 'Macarrão Espaguete 500g',
        sku: 'MAC-ES-500',
        marca: 'Renata',
        categoria: 'Massas',
        linha: 'Massas Secas',
        precoTabela: 5.2,
        precoFabrica: 3.8,
        estoque: 380,
        popularidade: 70,
      },
      {
        nome: 'Molho Tomate Tradicional 340g',
        sku: 'MOL-TO-340',
        marca: 'Pomarola',
        categoria: 'Molhos',
        linha: 'Tomate',
        precoTabela: 4.5,
        precoFabrica: 3.2,
        estoque: 280,
        popularidade: 65,
      },
    ];
    const produtos = await Promise.all(
      produtosData.map((p) =>
        this.prisma.produto.create({ data: { ...p, empresaId, ativo: true } }).catch(() => null),
      ),
    );
    created.produtos = produtos.filter(Boolean).length;

    // ─── Clientes ──────────────────────────────────────────────────────
    const clientesData: Array<{
      nome: string;
      cnpj: string;
      cidade: string;
      uf: string;
      segmento: string;
      status: ClienteStatus;
      score: number;
    }> = [
      {
        nome: 'Padaria do Zé',
        cnpj: '11.222.333/0001-44',
        cidade: 'São Paulo',
        uf: 'SP',
        segmento: 'Padaria',
        status: 'ATIVO',
        score: 85,
      },
      {
        nome: 'Restaurante Sabor & Arte',
        cnpj: '22.333.444/0001-55',
        cidade: 'Campinas',
        uf: 'SP',
        segmento: 'Restaurante',
        status: 'ATIVO',
        score: 90,
      },
      {
        nome: 'Mercado Central',
        cnpj: '33.444.555/0001-66',
        cidade: 'Rio de Janeiro',
        uf: 'RJ',
        segmento: 'Mercado',
        status: 'ATIVO',
        score: 75,
      },
      {
        nome: 'Hotel Boutique Vista',
        cnpj: '44.555.666/0001-77',
        cidade: 'Florianópolis',
        uf: 'SC',
        segmento: 'Hotelaria',
        status: 'NOVO',
        score: 60,
      },
      {
        nome: 'Cafeteria Aroma Bom',
        cnpj: '55.666.777/0001-88',
        cidade: 'Belo Horizonte',
        uf: 'MG',
        segmento: 'Cafeteria',
        status: 'NOVO',
        score: 50,
      },
      {
        nome: 'Lanchonete do Joaquim',
        cnpj: '66.777.888/0001-99',
        cidade: 'Salvador',
        uf: 'BA',
        segmento: 'Lanchonete',
        status: 'ATIVO',
        score: 70,
      },
    ];
    const clientes = await Promise.all(
      clientesData.map((c) =>
        this.prisma.cliente
          .create({
            data: { ...c, empresaId, representanteId: admin.id, prazoPagamento: 30 },
          })
          .catch(() => null),
      ),
    );
    created.clientes = clientes.filter(Boolean).length;

    // ─── Leads ─────────────────────────────────────────────────────────
    const leadsData: Array<{
      nome: string;
      cidade: string;
      uf: string;
      segmento: string;
      valorEstimado: number;
      canalOrigem: CanalOrigem;
      etapa: LeadEtapa;
      score: number;
    }> = [
      {
        nome: 'Distribuidora SP',
        cidade: 'São Paulo',
        uf: 'SP',
        segmento: 'Distribuição',
        valorEstimado: 25000,
        canalOrigem: 'WHATSAPP',
        etapa: 'NOVO',
        score: 70,
      },
      {
        nome: 'Indústria de Doces RJ',
        cidade: 'Rio de Janeiro',
        uf: 'RJ',
        segmento: 'Indústria',
        valorEstimado: 45000,
        canalOrigem: 'EMAIL',
        etapa: 'QUALIFICANDO',
        score: 85,
      },
      {
        nome: 'Rede de Padarias MG',
        cidade: 'Belo Horizonte',
        uf: 'MG',
        segmento: 'Padaria',
        valorEstimado: 80000,
        canalOrigem: 'INDICACAO',
        etapa: 'PROPOSTA',
        score: 90,
      },
      {
        nome: 'Hotel Premium SC',
        cidade: 'Florianópolis',
        uf: 'SC',
        segmento: 'Hotelaria',
        valorEstimado: 35000,
        canalOrigem: 'FORMULARIO',
        etapa: 'NEGOCIACAO',
        score: 75,
      },
      {
        nome: 'Restaurante Top BA',
        cidade: 'Salvador',
        uf: 'BA',
        segmento: 'Restaurante',
        valorEstimado: 15000,
        canalOrigem: 'WHATSAPP',
        etapa: 'GANHO',
        score: 100,
      },
    ];
    const agora = new Date();
    const leads = await Promise.all(
      leadsData.map((l, idx) =>
        this.prisma.lead
          .create({
            data: {
              ...l,
              empresaId,
              representanteId: admin.id,
              etapaDesde: new Date(agora.getTime() - (idx + 1) * 7 * 24 * 60 * 60 * 1000),
            },
          })
          .catch(() => null),
      ),
    );
    created.leads = leads.filter(Boolean).length;

    // ─── Amostras ──────────────────────────────────────────────────────
    const clientesCriados = clientes.filter(Boolean) as Array<{ id: string }>;
    if (clientesCriados.length > 0) {
      const amostras = await Promise.all([
        this.prisma.amostra
          .create({
            data: {
              empresaId,
              clienteId: clientesCriados[0].id,
              representanteNome: admin.nome,
              produtoNome: 'Açúcar Cristal 5kg',
              valor: 25,
              enviadoEm: new Date(agora.getTime() - 5 * 24 * 60 * 60 * 1000),
              followUpEm: new Date(agora.getTime() + 2 * 24 * 60 * 60 * 1000),
              status: 'AGUARDANDO_FOLLOWUP',
            },
          })
          .catch(() => null),
        this.prisma.amostra
          .create({
            data: {
              empresaId,
              clienteId: clientesCriados[1].id,
              representanteNome: admin.nome,
              produtoNome: 'Café Torrado 500g',
              valor: 18,
              enviadoEm: new Date(agora.getTime() - 30 * 24 * 60 * 60 * 1000),
              followUpEm: new Date(agora.getTime() - 25 * 24 * 60 * 60 * 1000),
              status: 'CONVERTIDA',
            },
          })
          .catch(() => null),
      ]);
      created.amostras = amostras.filter(Boolean).length;
    }

    // ─── Ocorrências ───────────────────────────────────────────────────
    if (clientesCriados.length > 0) {
      const oc1 = await this.prisma.ocorrencia
        .create({
          data: {
            empresaId,
            clienteId: clientesCriados[0].id,
            responsavelId: admin.id,
            numero: 'OCO-001',
            tipo: 'ENTREGA',
            severidade: 'media',
            titulo: 'Atraso na entrega — pedido #DEMO-001',
            descricao:
              'Cliente reclamou que o pedido chegou 3 dias atrasado. Transportadora informou problema na rota.',
            slaVenceEm: new Date(agora.getTime() + 2 * 24 * 60 * 60 * 1000),
            status: 'EM_ANDAMENTO',
          },
        })
        .catch(() => null);
      const oc2 = await this.prisma.ocorrencia
        .create({
          data: {
            empresaId,
            clienteId: clientesCriados[1].id,
            numero: 'OCO-002',
            tipo: 'QUALIDADE',
            severidade: 'alta',
            titulo: 'Produto vencido encontrado',
            descricao:
              'Cliente recebeu lote com data de validade próxima do vencimento. Pediu troca.',
            slaVenceEm: new Date(agora.getTime() - 5 * 60 * 60 * 1000), // VENCIDO!
            status: 'ABERTA',
          },
        })
        .catch(() => null);
      created.ocorrencias = [oc1, oc2].filter(Boolean).length;
    }

    // ─── Pedidos ───────────────────────────────────────────────────────
    const produtosCriados = produtos.filter(Boolean) as Array<{ id: string; precoTabela: number }>;
    if (clientesCriados.length > 0 && produtosCriados.length >= 2) {
      const subtotal = produtosCriados[0].precoTabela * 10 + produtosCriados[1].precoTabela * 5;
      const ped1 = await this.prisma.pedido
        .create({
          data: {
            empresaId,
            clienteId: clientesCriados[0].id,
            representanteId: admin.id,
            numero: 'DEMO-001',
            subtotal,
            descontoGeral: 0,
            total: subtotal,
            formaPagamento: 'BOLETO' as PagamentoForma,
            condicaoPagamento: '30dias',
            status: 'ENTREGUE' as PedidoStatus,
            enviadoOmieEm: new Date(agora.getTime() - 15 * 24 * 60 * 60 * 1000),
            itens: {
              create: [
                {
                  produtoId: produtosCriados[0].id,
                  quantidade: 10,
                  precoUnitario: produtosCriados[0].precoTabela,
                  desconto: 0,
                  total: produtosCriados[0].precoTabela * 10,
                },
                {
                  produtoId: produtosCriados[1].id,
                  quantidade: 5,
                  precoUnitario: produtosCriados[1].precoTabela,
                  desconto: 0,
                  total: produtosCriados[1].precoTabela * 5,
                },
              ],
            },
          },
        })
        .catch(() => null);

      const ped2 = await this.prisma.pedido
        .create({
          data: {
            empresaId,
            clienteId: clientesCriados[2].id,
            representanteId: admin.id,
            numero: 'DEMO-002',
            subtotal: produtosCriados[2].precoTabela * 20,
            descontoGeral: 0,
            total: produtosCriados[2].precoTabela * 20,
            formaPagamento: 'PIX' as PagamentoForma,
            condicaoPagamento: 'avista',
            status: 'PAGO' as PedidoStatus,
            itens: {
              create: [
                {
                  produtoId: produtosCriados[2].id,
                  quantidade: 20,
                  precoUnitario: produtosCriados[2].precoTabela,
                  desconto: 0,
                  total: produtosCriados[2].precoTabela * 20,
                },
              ],
            },
          },
        })
        .catch(() => null);
      created.pedidos = [ped1, ped2].filter(Boolean).length;
    }

    return {
      ok: true,
      created,
      message: `Seed demo criado: ${Object.entries(created)
        .map(([k, v]) => `${v} ${k}`)
        .join(', ')}. Recarregue o frontend pra ver os dados.`,
    };
  }
}
