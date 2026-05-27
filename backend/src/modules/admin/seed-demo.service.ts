import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { NotFoundException } from '@shared/errors/app-exception';

/**
 * SeedDemoService
 * ─────────────────────────────────────────────────────────────────────
 * Gera dataset de demonstração realista pra uma empresa específica.
 * Útil pra:
 *  - Onboarding de novo cliente (mostra o app populado antes da migração real)
 *  - Demos de venda (apresentação comercial sem expor dados de outro tenant)
 *  - QA / Playwright (estado conhecido sem depender de OMIE/marketplaces)
 *
 * Regras:
 *  - Todos os records criados aqui são marcados `isDemo = true` no banco
 *  - `wipe()` deleta APENAS registros com `isDemo = true` (jamais toca dado real)
 *  - `run()` é idempotente — chama wipe antes de re-seedar
 *  - Não cria Usuarios (depende do Supabase Auth) — usa reps existentes da empresa
 *  - Sem dependência de faker / lib externa — datasets determinísticos hardcoded
 *
 * Dataset alvo (multiplier=1):
 *  - 50 clientes (cidades/estados variados, prazos diferentes)
 *  - 200 produtos (linhas/categorias diversas, preços realistas)
 *  - 300 pedidos espalhados em 3 meses (status variados, itens reais)
 *  - 50 propostas (status variados)
 *  - 30 conversas Inbox (WhatsApp, com mensagens)
 *  - 1 pesquisa NPS + 100 respostas (categorias DETRATOR/PASSIVO/PROMOTOR)
 *  - 20 amostras (envio + follow-up)
 *  - 3 meses de comissões fechadas (uma por rep ativo da empresa)
 */
@Injectable()
export class SeedDemoService {
  private readonly logger = new Logger(SeedDemoService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Public API ─────────────────────────────────────────────────────

  async status(empresaId: string): Promise<SeedDemoStatus> {
    await this.assertEmpresa(empresaId);
    const [
      clientes,
      produtos,
      pedidos,
      propostas,
      amostras,
      comissoes,
      conversations,
      respostasNps,
    ] = await Promise.all([
      this.prisma.cliente.count({ where: { empresaId, isDemo: true } }),
      this.prisma.produto.count({ where: { empresaId, isDemo: true } }),
      this.prisma.pedido.count({ where: { empresaId, isDemo: true } }),
      this.prisma.proposta.count({ where: { empresaId, isDemo: true } }),
      this.prisma.amostra.count({ where: { empresaId, isDemo: true } }),
      this.prisma.comissao.count({ where: { empresaId, isDemo: true } }),
      this.prisma.conversation.count({ where: { empresaId, isDemo: true } }),
      this.prisma.respostaNPS.count({
        where: { isDemo: true, pesquisa: { empresaId } },
      }),
    ]);
    return {
      empresaId,
      total:
        clientes +
        produtos +
        pedidos +
        propostas +
        amostras +
        comissoes +
        conversations +
        respostasNps,
      detail: {
        clientes,
        produtos,
        pedidos,
        propostas,
        amostras,
        comissoes,
        conversations,
        respostasNps,
      },
    };
  }

  async wipe(empresaId: string): Promise<SeedDemoStatus['detail']> {
    await this.assertEmpresa(empresaId);
    this.logger.warn(`[seed-demo] WIPE empresa=${empresaId}`);

    /**
     * Best-effort: cada delete numa try/catch isolado.
     *
     * Antes: 8 deleteMany numa única `$transaction` atômica. Se um falhasse
     * por FK violation (ex: PedidoItem.produto não tem cascade, e algum pedido
     * REAL usa um produto DEMO), TODA a transação abortava com 500 —
     * sem feedback útil pro usuário.
     *
     * Agora: cada operação é independente. O que dá pra deletar, vai.
     * O que falhar, loga warning e continua. Usuário pode clicar de novo
     * pra tentar limpar o que sobrou (após resolver as dependências).
     */
    const safe = async (
      label: string,
      op: () => Promise<{ count: number }>,
    ): Promise<number> => {
      try {
        const r = await op();
        return r.count;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`[seed-demo wipe] falha em ${label}: ${msg}`);
        return 0;
      }
    };

    // 1) Limpa PedidoItem que aponta pra produto demo SEM cascade.
    //    PropostaItem não tem FK pro Produto no schema (só snapshot), não precisa.
    await safe('pedidoItem(órfão de produto demo)', () =>
      this.prisma.pedidoItem.deleteMany({
        where: { produto: { empresaId, isDemo: true } },
      }),
    );

    // 2) Limpa registros marcados isDemo=true (ordem: dependentes primeiro)
    const respostasNps = await safe('respostasNPS', () =>
      this.prisma.respostaNPS.deleteMany({
        where: { isDemo: true, pesquisa: { empresaId } },
      }),
    );
    const amostras = await safe('amostras', () =>
      this.prisma.amostra.deleteMany({ where: { empresaId, isDemo: true } }),
    );
    const comissoes = await safe('comissoes', () =>
      this.prisma.comissao.deleteMany({ where: { empresaId, isDemo: true } }),
    );
    const conversations = await safe('conversations', () =>
      this.prisma.conversation.deleteMany({ where: { empresaId, isDemo: true } }),
    );
    const propostas = await safe('propostas', () =>
      this.prisma.proposta.deleteMany({ where: { empresaId, isDemo: true } }),
    );
    const pedidos = await safe('pedidos', () =>
      this.prisma.pedido.deleteMany({ where: { empresaId, isDemo: true } }),
    );
    const produtos = await safe('produtos', () =>
      this.prisma.produto.deleteMany({ where: { empresaId, isDemo: true } }),
    );
    const clientes = await safe('clientes', () =>
      this.prisma.cliente.deleteMany({ where: { empresaId, isDemo: true } }),
    );

    // 3) Limpa pesquisas NPS órfãs de demo (best-effort também)
    await safe('pesquisaNPS-demo', () =>
      this.prisma.pesquisaNPS.deleteMany({
        where: { empresaId, slug: { startsWith: 'demo-nps-' } },
      }),
    );

    return {
      clientes,
      produtos,
      pedidos,
      propostas,
      amostras,
      comissoes,
      conversations,
      respostasNps,
    };
  }

  async run(empresaId: string, multiplier = 1): Promise<SeedDemoStatus['detail']> {
    await this.assertEmpresa(empresaId);
    if (multiplier < 0.1 || multiplier > 5) {
      throw new Error('multiplier deve estar entre 0.1 e 5 (proteção runaway)');
    }
    this.logger.log(`[seed-demo] RUN empresa=${empresaId} multiplier=${multiplier}`);

    // Idempotência: limpa antes de re-seedar
    await this.wipe(empresaId);

    // Quantidades alvo (escaladas pelo multiplier)
    const N = {
      clientes: Math.round(50 * multiplier),
      produtos: Math.round(200 * multiplier),
      pedidos: Math.round(300 * multiplier),
      propostas: Math.round(50 * multiplier),
      conversations: Math.round(30 * multiplier),
      respostasNps: Math.round(100 * multiplier),
      amostras: Math.round(20 * multiplier),
    };

    // 1. Clientes
    const clientesCount = await this.seedClientes(empresaId, N.clientes);
    const clienteIds = await this.prisma.cliente.findMany({
      where: { empresaId, isDemo: true },
      select: { id: true, nome: true },
    });

    // 2. Produtos
    const produtosCount = await this.seedProdutos(empresaId, N.produtos);
    const produtos = await this.prisma.produto.findMany({
      where: { empresaId, isDemo: true },
      select: { id: true, nome: true, precoTabela: true, sku: true },
    });

    // 3. Reps disponíveis (usa quem já existir; se nenhum, usa null)
    const reps = await this.prisma.usuario.findMany({
      where: { empresas: { some: { empresaId } }, role: { in: ['REP', 'GERENTE'] } },
      select: { id: true, nome: true, comissaoPadrao: true },
      take: 10,
    });

    // 4. Pedidos com itens
    const pedidosCount = await this.seedPedidos(empresaId, clienteIds, produtos, reps, N.pedidos);

    // 5. Propostas
    const propostasCount = await this.seedPropostas(
      empresaId,
      clienteIds,
      produtos,
      reps,
      N.propostas,
    );

    // 6. Conversas + mensagens
    const conversationsCount = await this.seedConversations(empresaId, clienteIds, N.conversations);

    // 7. NPS
    const respostasNpsCount = await this.seedNps(empresaId, clienteIds, N.respostasNps);

    // 8. Amostras
    const amostrasCount = await this.seedAmostras(
      empresaId,
      clienteIds,
      produtos,
      reps,
      N.amostras,
    );

    // 9. Comissões (1 por rep × 3 meses)
    const comissoesCount = await this.seedComissoes(empresaId, reps);

    return {
      clientes: clientesCount,
      produtos: produtosCount,
      pedidos: pedidosCount,
      propostas: propostasCount,
      conversations: conversationsCount,
      respostasNps: respostasNpsCount,
      amostras: amostrasCount,
      comissoes: comissoesCount,
    };
  }

  // ─── Internos ───────────────────────────────────────────────────────

  private async assertEmpresa(empresaId: string): Promise<void> {
    const emp = await this.prisma.empresa.findUnique({ where: { id: empresaId } });
    if (!emp) {
      throw new NotFoundException('Empresa', empresaId);
    }
  }

  private async seedClientes(empresaId: string, n: number): Promise<number> {
    const data = Array.from({ length: n }, (_, i) => {
      const c = CLIENTES_DEMO[i % CLIENTES_DEMO.length];
      const idx = i + 1;
      return {
        empresaId,
        codigoOmie: `DEMO-CLI-${String(idx).padStart(4, '0')}`,
        nome: `${c.nome} ${idx}`,
        cnpj: this.gerarCnpj(idx),
        email: `contato${idx}@${c.dominio}`,
        telefone: this.gerarTelefone(idx),
        segmento: c.segmento,
        cep: c.cep,
        cidade: c.cidade,
        uf: c.uf,
        regiao: c.regiao,
        status: 'ATIVO' as const,
        score: 30 + ((i * 7) % 70),
        prazoPagamento: [15, 30, 45, 60][i % 4],
        limiteCredito: 5000 + (i % 10) * 1500,
        isDemo: true,
      };
    });
    const res = await this.prisma.cliente.createMany({ data, skipDuplicates: true });
    return res.count;
  }

  private async seedProdutos(empresaId: string, n: number): Promise<number> {
    const data = Array.from({ length: n }, (_, i) => {
      const p = PRODUTOS_DEMO[i % PRODUTOS_DEMO.length];
      const idx = i + 1;
      const precoTabela = p.precoBase + (i % 10) * 2.5;
      return {
        empresaId,
        codigoOmie: `DEMO-PRD-${String(idx).padStart(4, '0')}`,
        sku: `DEMO-${p.skuPrefix}-${String(idx).padStart(3, '0')}`,
        nome: `${p.nome} ${idx}`,
        descricao: p.descricao,
        marca: p.marca,
        linha: p.linha,
        categoria: p.categoria,
        unidade: p.unidade,
        precoTabela,
        precoFabrica: Number((precoTabela * 0.7).toFixed(2)),
        popularidade: i % 100,
        estoque: 50 + ((i * 13) % 500),
        ativo: true,
        isDemo: true,
      };
    });
    const res = await this.prisma.produto.createMany({ data, skipDuplicates: true });
    return res.count;
  }

  private async seedPedidos(
    empresaId: string,
    clientes: Array<{ id: string; nome: string }>,
    produtos: Array<{ id: string; nome: string; precoTabela: number; sku: string | null }>,
    reps: Array<{ id: string; nome: string }>,
    n: number,
  ): Promise<number> {
    if (clientes.length === 0 || produtos.length === 0) return 0;
    // PedidoStatus enum oficial: RASCUNHO | AGUARDANDO_APROVACAO | ENVIADO_OMIE
    //                          | PAGO | EM_SEPARACAO | ENVIADO | ENTREGUE | CANCELADO
    const statusDist: Array<
      'RASCUNHO' | 'ENVIADO_OMIE' | 'PAGO' | 'ENVIADO' | 'ENTREGUE' | 'CANCELADO'
    > = [
      'ENTREGUE',
      'ENTREGUE',
      'ENTREGUE',
      'PAGO',
      'ENVIADO_OMIE',
      'ENVIADO',
      'RASCUNHO',
      'CANCELADO',
    ];
    const agora = Date.now();
    const tresMesesMs = 3 * 30 * 24 * 60 * 60 * 1000;

    // Numero único por empresa — usa timestamp + idx pra evitar colisão
    // com pedidos reais ou outros demos
    const baseNumero = `DEMO-${Math.floor(agora / 1000) % 100000}`;

    let created = 0;
    for (let i = 0; i < n; i++) {
      const cliente = clientes[i % clientes.length];
      const rep = reps.length > 0 ? reps[i % reps.length] : null;
      const status = statusDist[i % statusDist.length];
      const criadoEm = new Date(agora - Math.floor(Math.random() * tresMesesMs));
      const qtdItens = 1 + (i % 4);
      const itens: Array<{
        produtoId: string;
        quantidade: number;
        precoUnitario: number;
        desconto: number;
        total: number;
      }> = [];
      let subtotal = 0;
      for (let j = 0; j < qtdItens; j++) {
        const prod = produtos[(i + j * 7) % produtos.length];
        const quantidade = 1 + ((i + j) % 10);
        const desconto = (i + j) % 3 === 0 ? 5 : 0; // 33% têm 5% off
        const totalItem = quantidade * prod.precoTabela * (1 - desconto / 100);
        itens.push({
          produtoId: prod.id,
          quantidade,
          precoUnitario: prod.precoTabela,
          desconto,
          total: Number(totalItem.toFixed(2)),
        });
        subtotal += totalItem;
      }
      const descontoGeral = i % 5 === 0 ? 3 : 0;
      const total = Number((subtotal * (1 - descontoGeral / 100)).toFixed(2));
      const comissao = Number((total * 0.05).toFixed(2));

      try {
        await this.prisma.pedido.create({
          data: {
            empresaId,
            clienteId: cliente.id,
            representanteId: rep?.id ?? null,
            numero: `${baseNumero}-${String(i + 1).padStart(5, '0')}`,
            origem: 'REP_APP',
            status,
            // PagamentoForma só tem BOLETO | PIX no schema atual.
            formaPagamento: (['BOLETO', 'PIX'] as const)[i % 2],
            condicaoPagamento: ['avista', '30dias', '30_60', '30_60_90'][i % 4],
            subtotal: Number(subtotal.toFixed(2)),
            descontoGeral,
            total,
            comissao,
            criadoEm,
            atualizadoEm: criadoEm,
            enviadoOmieEm: status === 'ENVIADO_OMIE' || status === 'ENTREGUE' ? criadoEm : null,
            isDemo: true,
            itens: { create: itens },
          },
        });
        created++;
      } catch (err) {
        // numero duplicado pode acontecer em re-runs rápidos — segue em frente
        this.logger.warn(`[seed-demo] skip pedido idx=${i}: ${(err as Error).message}`);
      }
    }
    return created;
  }

  private async seedPropostas(
    empresaId: string,
    clientes: Array<{ id: string; nome: string }>,
    produtos: Array<{ id: string; nome: string; precoTabela: number; sku: string | null }>,
    reps: Array<{ id: string; nome: string }>,
    n: number,
  ): Promise<number> {
    if (clientes.length === 0 || produtos.length === 0) return 0;
    // PropostaStatus enum: RASCUNHO | ENVIADA | NEGOCIACAO | AGUARDANDO_ASSINATURA | ACEITA | RECUSADA | EXPIRADA
    const statusDist: Array<
      'RASCUNHO' | 'ENVIADA' | 'NEGOCIACAO' | 'ACEITA' | 'RECUSADA' | 'EXPIRADA'
    > = [
      'ENVIADA',
      'ENVIADA',
      'NEGOCIACAO',
      'ACEITA',
      'ACEITA',
      'RECUSADA',
      'EXPIRADA',
      'RASCUNHO',
    ];
    const agora = Date.now();
    const baseNumero = `DEMO-PROP-${Math.floor(agora / 1000) % 100000}`;
    let created = 0;
    for (let i = 0; i < n; i++) {
      const cliente = clientes[i % clientes.length];
      const rep = reps.length > 0 ? reps[i % reps.length] : null;
      const status = statusDist[i % statusDist.length];
      const qtd = 2 + (i % 3);
      let subtotal = 0;
      const itens: Array<{
        produtoId: string;
        produtoNome: string;
        quantidade: number;
        precoUnitario: number;
        desconto: number;
        total: number;
      }> = [];
      for (let j = 0; j < qtd; j++) {
        const prod = produtos[(i * 3 + j) % produtos.length];
        const quantidade = 1 + (j % 5);
        const totalItem = quantidade * prod.precoTabela;
        itens.push({
          produtoId: prod.id,
          produtoNome: prod.nome,
          quantidade,
          precoUnitario: prod.precoTabela,
          desconto: 0,
          total: Number(totalItem.toFixed(2)),
        });
        subtotal += totalItem;
      }
      const valor = Number(subtotal.toFixed(2));
      try {
        await this.prisma.proposta.create({
          data: {
            empresaId,
            clienteId: cliente.id,
            representanteId: rep?.id ?? null,
            numero: `${baseNumero}-${String(i + 1).padStart(4, '0')}`,
            status,
            probabilidade: 30 + ((i * 11) % 60),
            validoAte: new Date(agora + 30 * 24 * 60 * 60 * 1000),
            subtotal: valor,
            valor,
            comissaoEstimada: Number((valor * 0.05).toFixed(2)),
            isDemo: true,
            itens: { create: itens },
          },
        });
        created++;
      } catch (err) {
        this.logger.warn(`[seed-demo] skip proposta idx=${i}: ${(err as Error).message}`);
      }
    }
    return created;
  }

  private async seedConversations(
    empresaId: string,
    clientes: Array<{ id: string; nome: string }>,
    n: number,
  ): Promise<number> {
    if (clientes.length === 0) return 0;
    let created = 0;
    for (let i = 0; i < n; i++) {
      const cliente = clientes[i % clientes.length];
      const canal = (['WHATSAPP', 'INSTAGRAM', 'FACEBOOK', 'EMAIL'] as const)[i % 4];
      const peerId = `demo-peer-${canal}-${i + 1}`;
      const mensagens = MENSAGENS_DEMO[i % MENSAGENS_DEMO.length];
      try {
        await this.prisma.conversation.create({
          data: {
            empresaId,
            canal,
            peerId,
            peerNome: cliente.nome,
            clienteId: cliente.id,
            status: i % 4 === 0 ? 'RESOLVIDA' : 'ABERTA',
            categoria: (['GERAL', 'PRE_VENDA', 'POS_VENDA'] as const)[i % 3],
            naoLidas: i % 4 === 0 ? 0 : 1 + (i % 3),
            ultimaMsgEm: new Date(Date.now() - i * 3600 * 1000),
            ultimaMsgPreview: mensagens[mensagens.length - 1].slice(0, 140),
            isDemo: true,
            mensagens: {
              create: mensagens.map((conteudo, idx) => ({
                direction: idx % 2 === 0 ? 'INBOUND' : 'OUTBOUND',
                tipo: 'TEXT',
                conteudo,
                status: 'DELIVERED',
                criadoEm: new Date(Date.now() - (i * 3600 + (mensagens.length - idx) * 60) * 1000),
              })),
            },
          },
        });
        created++;
      } catch (err) {
        this.logger.warn(`[seed-demo] skip conversation idx=${i}: ${(err as Error).message}`);
      }
    }
    return created;
  }

  private async seedNps(
    empresaId: string,
    clientes: Array<{ id: string; nome: string }>,
    n: number,
  ): Promise<number> {
    if (clientes.length === 0) return 0;
    // Cria/garante uma pesquisa demo
    const slug = `demo-nps-${empresaId.slice(0, 8)}`;
    const pesquisa = await this.prisma.pesquisaNPS.upsert({
      where: { slug },
      create: {
        empresaId,
        slug,
        titulo: 'NPS Demo — Pesquisa de Satisfação',
        descricao: 'Pesquisa gerada por seed-demo (não usar em produção real).',
        ativo: true,
      },
      update: {},
    });

    const respostas = Array.from({ length: n }, (_, i) => {
      const cliente = clientes[i % clientes.length];
      const nota = (i * 3) % 11; // 0..10 distribuído
      const categoria = nota >= 9 ? 'PROMOTOR' : nota >= 7 ? 'PASSIVO' : 'DETRATOR';
      const comentario = COMENTARIOS_NPS[categoria][i % COMENTARIOS_NPS[categoria].length];
      return {
        pesquisaId: pesquisa.id,
        nota,
        comentario,
        clienteId: cliente.id,
        categoria,
        criadoEm: new Date(Date.now() - i * 6 * 3600 * 1000),
        isDemo: true,
      };
    });
    const res = await this.prisma.respostaNPS.createMany({ data: respostas });
    return res.count;
  }

  private async seedAmostras(
    empresaId: string,
    clientes: Array<{ id: string; nome: string }>,
    produtos: Array<{ id: string; nome: string; precoTabela: number; sku: string | null }>,
    reps: Array<{ id: string; nome: string }>,
    n: number,
  ): Promise<number> {
    if (clientes.length === 0 || produtos.length === 0) return 0;
    const data = Array.from({ length: n }, (_, i) => {
      const cliente = clientes[i % clientes.length];
      const produto = produtos[i % produtos.length];
      const rep = reps.length > 0 ? reps[i % reps.length] : null;
      const enviadoEm = new Date(Date.now() - i * 2 * 24 * 3600 * 1000);
      const followUpEm = new Date(enviadoEm.getTime() + 7 * 24 * 3600 * 1000);
      return {
        empresaId,
        clienteId: cliente.id,
        produtoNome: produto.nome,
        valor: Number((produto.precoTabela * 0.5).toFixed(2)),
        notaFiscal: `DEMO-NF-${String(i + 1).padStart(4, '0')}`,
        enviadoEm,
        followUpEm,
        // AmostraStatus enum: ENVIADA | AGUARDANDO_FOLLOWUP | CONVERTIDA | NAO_CONVERTEU | VENCIDA
        status: (['ENVIADA', 'CONVERTIDA', 'CONVERTIDA', 'NAO_CONVERTEU'] as const)[i % 4],
        representanteNome: rep?.nome ?? null,
        isDemo: true,
      };
    });
    const res = await this.prisma.amostra.createMany({ data });
    return res.count;
  }

  private async seedComissoes(
    empresaId: string,
    reps: Array<{ id: string; nome: string; comissaoPadrao?: number | null }>,
  ): Promise<number> {
    if (reps.length === 0) return 0;
    const agora = new Date();
    const meses = [
      { ano: agora.getFullYear(), mes: agora.getMonth() }, // mês passado (0-indexed)
      { ano: agora.getFullYear(), mes: agora.getMonth() - 1 },
      { ano: agora.getFullYear(), mes: agora.getMonth() - 2 },
    ].map(({ ano, mes }) => {
      // Normaliza mês negativo
      if (mes < 0) {
        return { ano: ano - 1, mes: 12 + mes + 1 };
      }
      return { ano, mes: mes + 1 }; // 1-indexed
    });

    const data: Array<{
      empresaId: string;
      representanteId: string;
      tipo: 'REP' | 'GERENTE';
      percentual: number;
      mes: number;
      ano: number;
      totalVendas: number;
      totalComissao: number;
      qtdPedidos: number;
      pago: boolean;
      isDemo: boolean;
    }> = [];
    let idx = 0;
    for (const m of meses) {
      for (const rep of reps) {
        const totalVendas = 15000 + (((idx + 1) * 1750) % 80000);
        const percentual = rep.comissaoPadrao ?? 5;
        const totalComissao = Number((totalVendas * (percentual / 100)).toFixed(2));
        data.push({
          empresaId,
          representanteId: rep.id,
          tipo: 'REP',
          percentual,
          mes: m.mes,
          ano: m.ano,
          totalVendas: Number(totalVendas.toFixed(2)),
          totalComissao,
          qtdPedidos: 8 + (idx % 12),
          pago: idx % 3 !== 0, // 2/3 pagas, 1/3 pendente
          isDemo: true,
        });
        idx++;
      }
    }
    const res = await this.prisma.comissao.createMany({ data, skipDuplicates: true });
    return res.count;
  }

  private gerarCnpj(idx: number): string {
    const base = (10000000 + ((idx * 7919) % 89999999)).toString();
    return `${base.slice(0, 2)}.${base.slice(2, 5)}.${base.slice(5, 8)}/0001-${String((idx * 13) % 100).padStart(2, '0')}`;
  }

  private gerarTelefone(idx: number): string {
    const ddd = (11 + ((idx * 3) % 88)).toString().padStart(2, '0');
    const num = 90000000 + ((idx * 7919) % 9999999);
    return `+55${ddd}${num}`;
  }
}

// ─── Tipos públicos ─────────────────────────────────────────────────────

export interface SeedDemoStatus {
  empresaId: string;
  total: number;
  detail: {
    clientes: number;
    produtos: number;
    pedidos: number;
    propostas: number;
    amostras: number;
    comissoes: number;
    conversations: number;
    respostasNps: number;
  };
}

// ─── Datasets determinísticos ───────────────────────────────────────────

const CLIENTES_DEMO = [
  {
    nome: 'Padaria do Bairro',
    dominio: 'padariademo.com.br',
    segmento: 'PADARIA',
    cidade: 'São Paulo',
    uf: 'SP',
    regiao: 'Sudeste',
    cep: '01310-100',
  },
  {
    nome: 'Mercado Central',
    dominio: 'mercadocentral.com.br',
    segmento: 'MERCADO',
    cidade: 'Rio de Janeiro',
    uf: 'RJ',
    regiao: 'Sudeste',
    cep: '20040-020',
  },
  {
    nome: 'Restaurante Sabor',
    dominio: 'sabor.com.br',
    segmento: 'RESTAURANTE',
    cidade: 'Belo Horizonte',
    uf: 'MG',
    regiao: 'Sudeste',
    cep: '30130-010',
  },
  {
    nome: 'Distribuidora Norte',
    dominio: 'distnorte.com.br',
    segmento: 'DISTRIBUIDOR',
    cidade: 'Manaus',
    uf: 'AM',
    regiao: 'Norte',
    cep: '69010-100',
  },
  {
    nome: 'Lanchonete da Praça',
    dominio: 'lancheria.com.br',
    segmento: 'LANCHONETE',
    cidade: 'Curitiba',
    uf: 'PR',
    regiao: 'Sul',
    cep: '80010-010',
  },
  {
    nome: 'Hotel Plaza',
    dominio: 'hotelplaza.com.br',
    segmento: 'HOTEL',
    cidade: 'Recife',
    uf: 'PE',
    regiao: 'Nordeste',
    cep: '50010-000',
  },
  {
    nome: 'Confeitaria Doce',
    dominio: 'docebrasil.com.br',
    segmento: 'CONFEITARIA',
    cidade: 'Porto Alegre',
    uf: 'RS',
    regiao: 'Sul',
    cep: '90010-100',
  },
  {
    nome: 'Pizzaria Bella',
    dominio: 'pizzariabella.com.br',
    segmento: 'PIZZARIA',
    cidade: 'Salvador',
    uf: 'BA',
    regiao: 'Nordeste',
    cep: '40010-000',
  },
  {
    nome: 'Conveniência 24h',
    dominio: 'conv24h.com.br',
    segmento: 'CONVENIENCIA',
    cidade: 'Fortaleza',
    uf: 'CE',
    regiao: 'Nordeste',
    cep: '60010-010',
  },
  {
    nome: 'Buffet Eventos',
    dominio: 'buffeteventos.com.br',
    segmento: 'BUFFET',
    cidade: 'Brasília',
    uf: 'DF',
    regiao: 'Centro-Oeste',
    cep: '70040-010',
  },
];

const PRODUTOS_DEMO = [
  {
    nome: 'Óleo de Girassol 900ml',
    descricao: 'Óleo refinado em garrafa pet de 900ml',
    marca: 'Soya',
    linha: 'Alimentos',
    categoria: 'Óleos',
    unidade: 'UN',
    precoBase: 8.5,
    skuPrefix: 'OLE',
  },
  {
    nome: 'Açúcar Refinado 1kg',
    descricao: 'Pacote de 1kg açúcar cristal refinado',
    marca: 'União',
    linha: 'Alimentos',
    categoria: 'Açúcares',
    unidade: 'UN',
    precoBase: 5.2,
    skuPrefix: 'ACU',
  },
  {
    nome: 'Farinha de Trigo 5kg',
    descricao: 'Farinha tipo 1 saco 5kg',
    marca: 'Dona Benta',
    linha: 'Alimentos',
    categoria: 'Farinhas',
    unidade: 'UN',
    precoBase: 18.9,
    skuPrefix: 'FAR',
  },
  {
    nome: 'Leite Integral 1L',
    descricao: 'Leite UHT integral caixa 1 litro',
    marca: 'Italac',
    linha: 'Bebidas',
    categoria: 'Laticínios',
    unidade: 'UN',
    precoBase: 4.8,
    skuPrefix: 'LEI',
  },
  {
    nome: 'Refrigerante Cola 2L',
    descricao: 'Garrafa pet 2 litros sabor cola',
    marca: 'Coca-Cola',
    linha: 'Bebidas',
    categoria: 'Refrigerantes',
    unidade: 'UN',
    precoBase: 9.9,
    skuPrefix: 'REF',
  },
  {
    nome: 'Detergente Neutro 500ml',
    descricao: 'Detergente líquido neutro 500ml',
    marca: 'Ypê',
    linha: 'Limpeza',
    categoria: 'Detergentes',
    unidade: 'UN',
    precoBase: 3.5,
    skuPrefix: 'DET',
  },
  {
    nome: 'Sabão em Pó 1kg',
    descricao: 'Sabão em pó concentrado 1kg',
    marca: 'Omo',
    linha: 'Limpeza',
    categoria: 'Lavar Roupa',
    unidade: 'UN',
    precoBase: 14.5,
    skuPrefix: 'SAB',
  },
  {
    nome: 'Café Torrado 500g',
    descricao: 'Café torrado e moído pacote 500g',
    marca: 'Melitta',
    linha: 'Bebidas',
    categoria: 'Cafés',
    unidade: 'UN',
    precoBase: 18.0,
    skuPrefix: 'CAF',
  },
  {
    nome: 'Embalagem Saco 5kg',
    descricao: 'Saco kraft natural 5kg pacote 100un',
    marca: 'EmbalaFácil',
    linha: 'Embalagens',
    categoria: 'Sacos',
    unidade: 'PCT',
    precoBase: 45.0,
    skuPrefix: 'EMB',
  },
  {
    nome: 'Caixa Pizza 35cm',
    descricao: 'Caixa de pizza papelão 35cm pacote 50un',
    marca: 'EmbalaFácil',
    linha: 'Embalagens',
    categoria: 'Caixas',
    unidade: 'PCT',
    precoBase: 38.0,
    skuPrefix: 'CXP',
  },
  {
    nome: 'Água Sanitária 2L',
    descricao: 'Água sanitária 2,5% galão 2 litros',
    marca: 'Q.boa',
    linha: 'Limpeza',
    categoria: 'Desinfetantes',
    unidade: 'UN',
    precoBase: 4.2,
    skuPrefix: 'AGU',
  },
  {
    nome: 'Sal Refinado 1kg',
    descricao: 'Sal refinado iodado pacote 1kg',
    marca: 'Cisne',
    linha: 'Alimentos',
    categoria: 'Sal',
    unidade: 'UN',
    precoBase: 2.8,
    skuPrefix: 'SAL',
  },
];

const MENSAGENS_DEMO: string[][] = [
  [
    'Oi, tudo bem?',
    'Olá! Em que posso ajudar?',
    'Vocês têm óleo de girassol disponível?',
    'Sim! Quer fazer o pedido?',
    'Quero 20 caixas, por favor.',
  ],
  ['Bom dia', 'Bom dia! Como posso ajudar?', 'Preciso de farinha de trigo urgente'],
  [
    'Boa tarde',
    'Olá! Tudo certo?',
    'Vocês entregam em Manaus?',
    'Sim, frete CIF acima de R$ 5.000.',
  ],
  ['Tem desconto à vista?', 'Sim, 3% pagando no boleto à vista.', 'Fechado!'],
  [
    'Pedido chegou faltando 2 caixas',
    'Vou verificar com o transportador. Pode me passar o número da nota?',
  ],
];

const COMENTARIOS_NPS = {
  PROMOTOR: [
    'Excelente atendimento!',
    'Produtos de qualidade, entrega rápida.',
    'Recomendo a todos os colegas.',
    'Sempre que preciso atende muito bem.',
  ],
  PASSIVO: [
    'Bom, mas o prazo de entrega poderia melhorar.',
    'Produtos ok, atendimento mediano.',
    'Esperava algo um pouco melhor.',
  ],
  DETRATOR: [
    'Entrega atrasou 2 vezes seguidas.',
    'Produto chegou com avaria.',
    'Atendimento muito demorado.',
    'Difícil falar com o representante.',
  ],
} as const;
