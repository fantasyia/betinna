import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '@database/prisma.service';
import { EstoqueService } from '@modules/erp/estoque.service';
import {
  type Acao,
  type LinhaReserva,
  planejarPedido,
  saldoParaEnvio,
} from '@modules/erp/reserva-marketplace';
import {
  type AlvoSku,
  corpoSaldos,
  desdobrar,
  itensMagis5,
  situacaoMagis5,
} from './magis5-estoque';
import { Magis5ClientService } from './magis5.client';
import { BusinessRuleException } from '@shared/errors/app-exception';

const ORIGEM = 'magis5';
const LOTE_ENVIO = 50;
/** Rodada normal relê os pedidos mexidos há 3 dias; a primeira, 30. */
const JANELA_DIAS = 3;
const JANELA_PRIMEIRA_DIAS = 30;

type Tx = Prisma.TransactionClient;

/** Corpo do PUT /magis5/estoque. Campo ausente = mantém o que está. */
export const chaveReservaMagis5Schema = z
  .object({
    ativo: z.boolean(),
    /** Pedido feito antes disto, já com nota e sem reserva, não baixa. */
    desde: z.string().datetime({ offset: true }).optional(),
    deposito: z
      .object({ id: z.string().min(1).max(60), title: z.string().min(1).max(120) })
      .nullable()
      .optional(),
    /** Só estes SKUs sobem (teste com 3 produtos); null = todos. */
    skusEnvio: z.array(z.string().min(1).max(60)).max(5000).nullable().optional(),
    limiteQueda: z.number().int().min(0).max(100_000).optional(),
    /** % do livre que pedido sem pagamento pode segurar (padrão 50). */
    limitePendentePct: z.number().min(0).max(100).optional(),
  })
  .strict();
export type ChaveReservaMagis5Dto = z.infer<typeof chaveReservaMagis5Schema>;

export interface ResultadoReconciliacao {
  pedidos: number;
  acoes: number;
  baixas: number;
  desconhecidos: string[];
  semVinculo: string[];
  kitsSemComposicao: string[];
}

/**
 * Reserva até a NF dos pedidos do Magis5 e envio do saldo (Léo, 25/10 e 14/11).
 *
 * Ordem da rodada (no `Magis5SyncJob`, logo depois da leitura dos pedidos):
 * 1. `reconciliar`: o ledger `EstoqueReservaMarketplace` segue os pedidos
 *    (reserva, libera, e — com a chave ligada — baixa na nota);
 * 2. `enviarSaldos`: só com a chave ligada, manda o disponível das peças.
 * Ler antes de enviar importa: o envio é "saldo por cima".
 */
@Injectable()
export class Magis5EstoqueService {
  private readonly logger = new Logger(Magis5EstoqueService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly estoque: EstoqueService,
    private readonly client: Magis5ClientService,
  ) {}

  /** SKU → peça ou kit do catálogo da empresa. SKU repetido em duas peças fica de fora. */
  async catalogo(empresaId: string): Promise<Map<string, AlvoSku>> {
    const [variacoes, kits] = await Promise.all([
      this.prisma.catalogoVariacao.findMany({
        where: { empresaId, sku: { not: null } },
        select: { sku: true, produtoId: true },
      }),
      this.prisma.catalogoKitItem.findMany({
        where: { empresaId },
        select: {
          sku: true,
          composicaoOk: true,
          kit: { select: { aleatorio: true } },
          componentes: {
            select: { quantidade: true, variacao: { select: { produtoId: true } } },
          },
        },
      }),
    ]);
    const mapa = new Map<string, AlvoSku>();
    const repetidos = new Set<string>();
    for (const v of variacoes) {
      const sku = v.sku!.trim();
      if (mapa.has(sku)) repetidos.add(sku);
      else mapa.set(sku, { tipo: 'peca', produtoId: v.produtoId });
    }
    for (const k of kits) {
      const sku = k.sku.trim();
      if (mapa.has(sku)) {
        repetidos.add(sku);
        continue;
      }
      mapa.set(
        sku,
        k.kit.aleatorio || !k.composicaoOk || k.componentes.length === 0
          ? { tipo: 'kitSemComposicao' }
          : {
              tipo: 'kit',
              componentes: k.componentes.map((c) => ({
                produtoId: c.variacao.produtoId,
                quantidade: c.quantidade,
              })),
            },
      );
    }
    // Ambíguo não é chutado: vira "sem vínculo" e aparece no log.
    for (const sku of repetidos) mapa.delete(sku);
    if (repetidos.size) {
      this.logger.warn(
        `[Magis5 estoque] ${empresaId}: SKU repetido no catálogo, fora da reserva: ${[...repetidos].slice(0, 20).join(', ')}`,
      );
    }
    return mapa;
  }

  /** Ledger acompanha os pedidos do espelho `Magis5Pedido`. Idempotente. */
  async reconciliar(empresaId: string, agora = new Date()): Promise<ResultadoReconciliacao | null> {
    if (!(await this.estoque.ativoNaEmpresa(empresaId))) return null;
    const cfg = await this.estoque.configReservaMagis5(empresaId);
    if (cfg.erro) this.logger.warn(`[Magis5 estoque] ${empresaId}: ${cfg.erro} — segue desligada`);

    const jaTem = await this.prisma.estoqueReservaMarketplace.count({
      where: { empresaId, origem: ORIGEM },
    });
    const dias = jaTem ? JANELA_DIAS : JANELA_PRIMEIRA_DIAS;
    const abertos = await this.prisma.estoqueReservaMarketplace.findMany({
      where: { empresaId, origem: ORIGEM, status: { in: ['ATIVA', 'CONFIRMADA'] } },
      select: { pedidoNumero: true },
      distinct: ['pedidoNumero'],
    });
    const pedidos = await this.prisma.magis5Pedido.findMany({
      where: {
        empresaId,
        OR: [
          { atualizadoEm: { gte: new Date(agora.getTime() - dias * 86_400_000) } },
          { numero: { in: abertos.map((a) => a.pedidoNumero) } },
        ],
      },
      select: { numero: true, pedidoEm: true, dados: true },
    });

    const catalogo = await this.catalogo(empresaId);
    const r: ResultadoReconciliacao = {
      pedidos: pedidos.length,
      acoes: 0,
      baixas: 0,
      desconhecidos: [],
      semVinculo: [],
      kitsSemComposicao: [],
    };
    for (const p of pedidos) {
      const dados = (p.dados ?? {}) as Record<string, unknown>;
      const { situacao, status } = situacaoMagis5(dados);
      if (situacao === 'DESCONHECIDO')
        r.desconhecidos.push(`${p.numero} (${status || 'sem status'})`);
      const { itens } = itensMagis5(dados);
      const { pecas, semVinculo, kitsSemComposicao } = desdobrar(itens, catalogo);
      // Só conta o que afeta estoque: pedido ignorado (Full, vitrine) não é pendência.
      if (
        situacao === 'RESERVAR' ||
        situacao === 'AGUARDANDO_PAGAMENTO' ||
        situacao === 'NF_EMITIDA'
      ) {
        r.semVinculo.push(...semVinculo.map((s) => `${p.numero}:${s}`));
        r.kitsSemComposicao.push(...kitsSemComposicao.map((s) => `${p.numero}:${s}`));
      }
      const existentes = (await this.prisma.estoqueReservaMarketplace.findMany({
        where: { empresaId, origem: ORIGEM, pedidoNumero: p.numero },
        select: { id: true, produtoId: true, quantidade: true, status: true },
      })) as LinhaReserva[];
      const acoes = planejarPedido({
        situacao,
        desejado: pecas,
        existentes,
        ligada: cfg.ligada,
        depoisDoDesde: !!cfg.desde && !!p.pedidoEm && p.pedidoEm >= cfg.desde,
      });
      for (const a of acoes) {
        if (await this.aplicar(empresaId, p.numero, a)) {
          r.acoes++;
          if (a.tipo === 'baixar' || a.tipo === 'baixarDireto') r.baixas++;
        }
      }
    }
    if (r.acoes || r.desconhecidos.length || r.semVinculo.length || r.kitsSemComposicao.length) {
      this.logger.log(
        `[Magis5 estoque] ${empresaId}: ${r.pedidos} pedidos, ${r.acoes} mudanças (${r.baixas} baixas)` +
          (r.desconhecidos.length
            ? ` · status desconhecido: ${r.desconhecidos.slice(0, 10).join(', ')}`
            : '') +
          (r.semVinculo.length
            ? ` · SKU sem vínculo: ${r.semVinculo.slice(0, 10).join(', ')}`
            : '') +
          (r.kitsSemComposicao.length
            ? ` · kit sem composição (não reserva): ${r.kitsSemComposicao.slice(0, 10).join(', ')}`
            : ''),
      );
    }
    return r;
  }

  /** Uma ação, com CAS: rodada concorrente ou repetida não aplica duas vezes. */
  private async aplicar(empresaId: string, pedidoNumero: string, a: Acao): Promise<boolean> {
    const documento = `${ORIGEM}:${pedidoNumero}`;
    switch (a.tipo) {
      case 'criar':
        try {
          await this.prisma.estoqueReservaMarketplace.create({
            data: {
              empresaId,
              origem: ORIGEM,
              pedidoNumero,
              produtoId: a.produtoId,
              quantidade: a.quantidade,
              status: a.pendente ? 'ATIVA' : 'CONFIRMADA',
            },
          });
          return true;
        } catch (err) {
          if (unico(err)) return false;
          throw err;
        }
      case 'confirmar': {
        const u = await this.prisma.estoqueReservaMarketplace.updateMany({
          where: { id: a.id, status: 'ATIVA' },
          data: { status: 'CONFIRMADA', quantidade: a.quantidade },
        });
        return u.count > 0;
      }
      case 'ajustar': {
        const u = await this.prisma.estoqueReservaMarketplace.updateMany({
          where: { id: a.id, status: { in: ['ATIVA', 'CONFIRMADA'] } },
          data: { quantidade: a.quantidade },
        });
        return u.count > 0;
      }
      case 'reabrir': {
        const u = await this.prisma.estoqueReservaMarketplace.updateMany({
          where: { id: a.id, status: 'LIBERADA' },
          data: {
            quantidade: a.quantidade,
            status: a.pendente ? 'ATIVA' : 'CONFIRMADA',
            motivoLiberacao: null,
          },
        });
        return u.count > 0;
      }
      case 'liberar': {
        const u = await this.prisma.estoqueReservaMarketplace.updateMany({
          where: { id: a.id, status: { in: ['ATIVA', 'CONFIRMADA'] } },
          data: { status: 'LIBERADA', motivoLiberacao: a.motivo.slice(0, 300) },
        });
        return u.count > 0;
      }
      case 'baixar':
        return this.prisma.$transaction(async (tx: Tx) => {
          const cas = await tx.estoqueReservaMarketplace.updateMany({
            where: { id: a.id, status: { in: ['ATIVA', 'CONFIRMADA'] } },
            data: { status: 'BAIXADA', quantidade: a.quantidade },
          });
          if (cas.count === 0) return false;
          const mov = await this.saida(tx, empresaId, a.produtoId, a.quantidade, documento);
          await tx.estoqueReservaMarketplace.update({
            where: { id: a.id },
            data: { movimentoId: mov.id },
          });
          return true;
        });
      case 'baixarDireto':
        try {
          return await this.prisma.$transaction(async (tx: Tx) => {
            // A chave única (pedido × peça) barra a segunda saída.
            const linha = await tx.estoqueReservaMarketplace.create({
              data: {
                empresaId,
                origem: ORIGEM,
                pedidoNumero,
                produtoId: a.produtoId,
                quantidade: a.quantidade,
                status: 'BAIXADA',
              },
              select: { id: true },
            });
            const mov = await this.saida(tx, empresaId, a.produtoId, a.quantidade, documento);
            await tx.estoqueReservaMarketplace.update({
              where: { id: linha.id },
              data: { movimentoId: mov.id },
            });
            return true;
          });
        } catch (err) {
          if (unico(err)) return false;
          throw err;
        }
    }
  }

  private saida(tx: Tx, empresaId: string, produtoId: string, q: number, documento: string) {
    return tx.estoqueMovimento.create({
      data: {
        empresaId,
        produtoId,
        tipo: 'SAIDA_PEDIDO',
        quantidade: -q,
        motivo: 'Nota emitida (pedido de marketplace pelo Magis5)',
        documento,
      },
      select: { id: true },
    });
  }

  /**
   * Saldo das PEÇAS (nunca do kit: o Magis5 calcula o kit pela composição) pro
   * Magis5. Só com a chave ligada e depósito configurado; só o que mudou desde
   * o último envio. Queda em massa pra zero para tudo e avisa.
   */
  async enviarSaldos(empresaId: string): Promise<{
    enviados: number;
    motivo?: string;
    previa?: Array<{ sku: string; de: number | null; para: number }>;
  }> {
    if (!(await this.estoque.ativoNaEmpresa(empresaId)))
      return { enviados: 0, motivo: 'ERP desligado' };
    const cfg = await this.estoque.configReservaMagis5(empresaId);
    // Desligada: nem calcula (a prévia está em GET /magis5/estoque).
    if (!cfg.ligada) return { enviados: 0, motivo: cfg.erro ?? 'chave desligada' };
    if (!cfg.deposito) return { enviados: 0, motivo: 'sem depósito do Magis5 configurado' };
    const previa = await this.previaEnvio(empresaId, cfg.skusEnvio);

    const quedas = previa.filter((x) => (x.de ?? 0) > 0 && x.para === 0).length;
    if (quedas > cfg.limiteQueda) {
      const motivo = `${quedas} SKUs cairiam pra zero de uma vez (limite ${cfg.limiteQueda}) — envio parado`;
      this.logger.error(`[Magis5 estoque] ${empresaId}: ${motivo}`);
      return { enviados: 0, motivo, previa };
    }
    let enviados = 0;
    for (let i = 0; i < previa.length; i += LOTE_ENVIO) {
      const lote = previa.slice(i, i + LOTE_ENVIO).map((x) => ({ sku: x.sku, quantidade: x.para }));
      await this.client.put(empresaId, '/callbacks/stocks', corpoSaldos(lote, cfg.deposito));
      // Registro só depois do 200: falhou, a próxima rodada tenta de novo.
      await this.prisma.$transaction(
        lote.map((x) =>
          this.prisma.magis5SaldoEnviado.upsert({
            where: { empresaId_sku: { empresaId, sku: x.sku } },
            create: { empresaId, sku: x.sku, quantidade: x.quantidade },
            update: { quantidade: x.quantidade, enviadoEm: new Date() },
          }),
        ),
      );
      enviados += lote.length;
      this.logger.log(
        `[Magis5 estoque] ${empresaId}: saldo enviado ${lote.map((x) => `${x.sku}=${x.quantidade}`).join(' ')}`,
      );
    }
    return { enviados };
  }

  /** O que mudou desde o último envio, por SKU de peça (disponível, nunca negativo). */
  async previaEnvio(
    empresaId: string,
    skusEnvio: string[] | null,
  ): Promise<Array<{ sku: string; de: number | null; para: number }>> {
    const variacoes = await this.prisma.catalogoVariacao.findMany({
      where: {
        empresaId,
        sku: skusEnvio ? { in: skusEnvio } : { not: null },
      },
      select: { sku: true, produtoId: true },
    });
    // SKU repetido em duas peças não vai (qual das duas seria?).
    const contagem = new Map<string, number>();
    for (const v of variacoes) contagem.set(v.sku!.trim(), (contagem.get(v.sku!.trim()) ?? 0) + 1);
    const unicas = variacoes.filter((v) => contagem.get(v.sku!.trim()) === 1);
    // Sempre com o pedido de marketplace descontado: é o que IRIA pro canal.
    const disp = await this.estoque.disponiveis(
      empresaId,
      unicas.map((v) => v.produtoId),
      undefined,
      true,
    );
    const ultimos = await this.prisma.magis5SaldoEnviado.findMany({
      where: { empresaId },
      select: { sku: true, quantidade: true },
    });
    const ultimo = new Map(ultimos.map((u) => [u.sku, u.quantidade]));
    return unicas
      .map((v) => {
        const sku = v.sku!.trim();
        return {
          sku,
          de: ultimo.get(sku) ?? null,
          para: saldoParaEnvio(disp.get(v.produtoId) ?? 0),
        };
      })
      .filter((x) => x.de !== x.para)
      .sort((a, b) => a.sku.localeCompare(b.sku));
  }

  /**
   * Liga/desliga a chave (`config.erpInterno.reservaMagis5`). Merge no jsonb,
   * sem ler-e-regravar o config inteiro. Ligar sem `desde` = vale a partir de agora.
   */
  async salvarChave(empresaId: string, dto: ChaveReservaMagis5Dto) {
    if (!(await this.estoque.ativoNaEmpresa(empresaId))) {
      throw new BusinessRuleException('O estoque (ERP) não está ligado nesta empresa');
    }
    const atual = (
      await this.prisma.empresa.findUnique({
        where: { id: empresaId },
        select: { config: true },
      })
    )?.config as { erpInterno?: { reservaMagis5?: Record<string, unknown> } } | null;
    const antes = atual?.erpInterno?.reservaMagis5 ?? {};
    const novo: Record<string, unknown> = { ...antes, ...dto };
    if (dto.ativo && !dto.desde && (antes.ativo !== true || typeof antes.desde !== 'string')) {
      novo.desde = new Date().toISOString();
    }
    await this.prisma.$executeRaw`
      UPDATE "Empresa"
      SET "config" = jsonb_set(
        COALESCE("config", '{}'::jsonb),
        '{erpInterno}',
        COALESCE("config"->'erpInterno', '{}'::jsonb) || jsonb_build_object('reservaMagis5', ${JSON.stringify(novo)}::jsonb)
      )
      WHERE "id" = ${empresaId}`;
    this.logger.log(`[Magis5 estoque] ${empresaId}: chave ${JSON.stringify(novo)}`);
    return this.situacao(empresaId);
  }

  /** Resumo pra tela/rota: chave, ledger e o que seria enviado. Só leitura. */
  async situacao(empresaId: string) {
    const cfg = await this.estoque.configReservaMagis5(empresaId);
    const [porStatus, previa] = await Promise.all([
      this.prisma.estoqueReservaMarketplace.groupBy({
        by: ['status'],
        where: { empresaId, origem: ORIGEM },
        _sum: { quantidade: true },
        _count: { _all: true },
      }),
      this.previaEnvio(empresaId, cfg.skusEnvio),
    ]);
    return {
      chave: {
        ligada: cfg.ligada,
        desde: cfg.desde,
        deposito: cfg.deposito,
        skusEnvio: cfg.skusEnvio,
        limiteQueda: cfg.limiteQueda,
        limitePendentePct: cfg.limitePendentePct,
        erro: cfg.erro,
      },
      ledger: porStatus.map((s) => ({
        status: s.status,
        linhas: s._count._all,
        pecas: s._sum.quantidade ?? 0,
      })),
      previaEnvio: { mudariam: previa.length, primeiros: previa.slice(0, 200) },
    };
  }
}

const unico = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
