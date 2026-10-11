import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { BusinessRuleException, NotFoundException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import type { EnvioCarrinho } from '@integrations/melhorenvio/melhorenvio.client';
import { FreteService } from './frete.service';
import {
  faltandoNoRemetente,
  pecasPorCaixa,
  soDigitos,
  umaCaixaPorEnvio,
  type CaixaDoPedido,
  type ConfigFrete,
  type ItemDeclarado,
  type Remetente,
} from './frete';

const regra = (msg: string) => new BusinessRuleException(msg, ErrorCode.BUSINESS_RULE_VIOLATION);

/** Pedido pode ter etiqueta impressa a partir de pago. */
const STATUS_COM_ETIQUETA = new Set(['PAGO', 'EM_SEPARACAO', 'ENVIADO']);
/** Uma emissão que começou e não terminou em 3 min é considerada abandonada. */
const EMISSAO_TRAVADA_MS = 3 * 60_000;

/** O que fica gravado em `Pedido.entrega.etiqueta` — a memória entre cliques. */
export interface EstadoEtiqueta {
  criando?: string;
  ids?: string[];
  carrinhoEm?: string;
  compradaEm?: string;
  totalC?: number | null;
  geradaEm?: string;
  url?: string;
  impressaEm?: string;
}

interface EntregaPedido {
  retirada?: boolean;
  freteAConfirmar?: boolean;
  cep?: string;
  endereco?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
  servico?: { id: number; nome: string; transportadora: string };
  valor?: number;
  volumes?: Array<{ embalagem: string; pecas: number; pesoKg: number }>;
  etiqueta?: EstadoEtiqueta;
}

/**
 * Etiqueta do Melhor Envio pelo pedido (Léo, 11/10: "um botão pra imprimir a
 * etiqueta dentro do nosso app"). Um clique faz os 4 passos — carrinho, compra
 * com o SALDO da carteira, geração e impressão — com declaração de conteúdo.
 *
 * Cada passo concluído é gravado no pedido ANTES do próximo. Clique repetido,
 * erro no meio ou duas pessoas ao mesmo tempo: continua de onde parou e nunca
 * compra a etiqueta duas vezes. Já impressa: reimprime sem cobrar.
 */
@Injectable()
export class EtiquetaService {
  private readonly logger = new Logger(EtiquetaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly frete: FreteService,
  ) {}

  /** Pausa entre gerar e imprimir (a geração no Melhor Envio é assíncrona). Injetável nos testes. */
  protected esperar(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async imprimir(
    user: AuthenticatedUser,
    pedidoId: string,
  ): Promise<{ url: string; etiquetas: number; totalC: number | null; reimpressao: boolean }> {
    const empresaId = user.empresaIdAtiva ?? user.empresaIds?.[0];
    if (!empresaId) throw regra('Empresa não definida');
    const pedido = await this.prisma.pedido.findFirst({
      where: { id: pedidoId, empresaId },
      include: {
        cliente: { select: { nome: true, cnpj: true, email: true, telefone: true } },
        itens: { include: { produto: { select: { nome: true } } } },
      },
    });
    if (!pedido) throw new NotFoundException('Pedido', pedidoId);
    if (!STATUS_COM_ETIQUETA.has(pedido.status)) {
      throw regra('A etiqueta sai depois que o pedido está pago');
    }
    const entrega = (pedido.entrega ?? {}) as EntregaPedido;
    if (entrega.retirada) throw regra('Pedido com retirada em mãos não tem etiqueta');
    if (entrega.freteAConfirmar || !entrega.servico?.id || !entrega.volumes?.length) {
      throw regra(
        'Pedido sem frete do Melhor Envio (frete a combinar) — não dá pra emitir etiqueta',
      );
    }

    const { me, cfg } = await this.frete.paraEtiqueta(empresaId);
    let et: EstadoEtiqueta = entrega.etiqueta ?? {};
    const reimpressao = !!et.impressaEm;

    // 1) CARRINHO — com trava: só um clique monta os envios.
    if (!et.ids?.length) {
      const falta = faltandoNoRemetente(cfg.remetente);
      if (falta.length) {
        throw regra(
          `Complete o remetente em Vitrine → Configuração → Frete (falta: ${falta.join(', ')})`,
        );
      }
      const envios = this.montarEnvios(pedido, entrega, cfg);
      const travou = await this.prisma.$executeRaw`
        UPDATE "Pedido"
        SET "entrega" = jsonb_set("entrega", '{etiqueta}', ${JSON.stringify({ criando: new Date().toISOString() })}::jsonb, true)
        WHERE "id" = ${pedido.id} AND "empresaId" = ${empresaId}
          AND (NOT ("entrega" ? 'etiqueta')
               OR (("entrega"->'etiqueta'->>'criando') IS NOT NULL
                   AND ("entrega"->'etiqueta'->>'criando')::timestamptz < ${new Date(Date.now() - EMISSAO_TRAVADA_MS)}
                   AND ("entrega"->'etiqueta'->'ids') IS NULL))`;
      if (travou === 0) {
        throw regra(
          'A etiqueta deste pedido já está sendo emitida — aguarde um instante e abra de novo',
        );
      }
      const ids: string[] = [];
      try {
        for (const e of envios) ids.push((await me.adicionarAoCarrinho(e)).id);
      } catch (err) {
        // Libera a trava: o próximo clique monta de novo. Envio que chegou a
        // entrar no carrinho fica lá SEM pagar (não custa nada) — avisado.
        await this.gravar(pedido.id, empresaId, null);
        const sobrou = ids.length
          ? ` (${ids.length} envio(s) ficaram no carrinho do Melhor Envio, sem pagar)`
          : '';
        throw regra(`${err instanceof Error ? err.message : String(err)}${sobrou}`);
      }
      et = { ids, carrinhoEm: new Date().toISOString() };
      await this.gravar(pedido.id, empresaId, et);
    }
    const ids = et.ids as string[];

    // 2) COMPRA — debita o saldo da carteira do Melhor Envio. Uma vez só.
    if (!et.compradaEm) {
      const { totalC } = await me.comprar(ids);
      et = { ...et, compradaEm: new Date().toISOString(), totalC };
      await this.gravar(pedido.id, empresaId, et);
      this.logger.log(
        `[etiqueta] pedido ${pedido.numero}: ${ids.length} etiqueta(s) comprada(s) (${totalC === null ? '?' : (totalC / 100).toFixed(2)})`,
      );
    }

    // 3) GERAÇÃO
    if (!et.geradaEm) {
      const r = await me.gerar(ids);
      const falhas = r.filter((x) => !x.ok && !/j[áa] (foi )?gerad/i.test(x.mensagem));
      if (falhas.length) {
        throw regra(
          `Etiqueta comprada, mas o Melhor Envio não gerou: ${falhas.map((f) => f.mensagem).join('; ')} — tente de novo em instantes (não cobra outra vez)`,
        );
      }
      et = { ...et, geradaEm: new Date().toISOString() };
      await this.gravar(pedido.id, empresaId, et);
      await this.esperar(1500);
    }

    // 4) IMPRESSÃO — o link da etiqueta (PDF no Melhor Envio).
    const url = await me.imprimir(ids);
    et = { ...et, url, impressaEm: new Date().toISOString() };
    await this.gravar(pedido.id, empresaId, et);
    return { url, etiquetas: ids.length, totalC: et.totalC ?? null, reimpressao };
  }

  /** Grava (ou apaga, com null) `entrega.etiqueta` — atômico, só essa chave. */
  private async gravar(pedidoId: string, empresaId: string, et: EstadoEtiqueta | null) {
    if (et === null) {
      await this.prisma.$executeRaw`
        UPDATE "Pedido" SET "entrega" = "entrega" - 'etiqueta'
        WHERE "id" = ${pedidoId} AND "empresaId" = ${empresaId}`;
      return;
    }
    await this.prisma.$executeRaw`
      UPDATE "Pedido"
      SET "entrega" = jsonb_set("entrega", '{etiqueta}', ${JSON.stringify(et)}::jsonb, true)
      WHERE "id" = ${pedidoId} AND "empresaId" = ${empresaId}`;
  }

  /** Os envios do carrinho: um por caixa (Correios/J&T/Loggi) ou um com todas. */
  montarEnvios(
    pedido: {
      numero: string;
      cliente: {
        nome: string;
        cnpj: string | null;
        email: string | null;
        telefone: string | null;
      } | null;
      itens: Array<{
        quantidade: number;
        total: Prisma.Decimal | number;
        produto: { nome: string } | null;
      }>;
    },
    entrega: EntregaPedido,
    cfg: ConfigFrete,
  ): EnvioCarrinho[] {
    const cli = pedido.cliente;
    const doc = soDigitos(cli?.cnpj);
    if (doc.length !== 11 && doc.length !== 14) {
      throw regra('O cliente do pedido está sem CPF/CNPJ — o Melhor Envio exige pra etiqueta');
    }
    const fone = soDigitos(cli?.telefone);
    if (fone.length < 10) throw regra('O cliente do pedido está sem telefone com DDD');
    for (const [k, rot] of [
      ['cep', 'CEP'],
      ['endereco', 'rua'],
      ['numero', 'número'],
      ['cidade', 'cidade'],
      ['uf', 'UF'],
    ] as const) {
      if (!String(entrega[k] ?? '').trim()) throw regra(`Endereço de entrega sem ${rot}`);
    }

    const embalagens = [cfg.embalagemIndividual, ...(cfg.caixas ?? [])].filter(Boolean);
    const caixas: CaixaDoPedido[] = (entrega.volumes ?? []).map((v) => {
      const e = embalagens.find((x) => x?.nome === v.embalagem);
      if (!e?.comprimentoCm || !e.larguraCm || !e.alturaCm) {
        throw regra(
          `A embalagem "${v.embalagem}" não está mais cadastrada no frete — confira as caixas`,
        );
      }
      return {
        comprimentoCm: e.comprimentoCm,
        larguraCm: e.larguraCm,
        alturaCm: e.alturaCm,
        pesoKg: v.pesoKg,
        pecas: v.pecas,
      };
    });
    const itens: ItemDeclarado[] = pedido.itens.map((i) => ({
      nome: (i.produto?.nome ?? 'Peça').slice(0, 100),
      quantidade: i.quantidade,
      unitarioC: Math.round((Number(i.total) / Math.max(1, i.quantidade)) * 100),
    }));

    const r = cfg.remetente as Remetente;
    const from = {
      name: (r.nome ?? '').trim(),
      phone: soDigitos(r.telefone),
      email: (r.email ?? '').trim(),
      document: '',
      company_document: soDigitos(r.cnpj),
      // Declaração de conteúdo (Léo, 11/10): sem nota → sem inscrição estadual.
      state_register: '',
      address: (r.endereco ?? '').trim(),
      complement: (r.complemento ?? '').trim(),
      number: (r.numero ?? '').trim(),
      district: (r.bairro ?? '').trim(),
      city: (r.cidade ?? '').trim(),
      country_id: 'BR',
      postal_code: soDigitos(r.cep),
      state_abbr: (r.uf ?? '').toUpperCase(),
    };
    const to = {
      name: (cli?.nome ?? '').trim(),
      phone: fone,
      email: (cli?.email ?? '').trim(),
      document: doc.length === 11 ? doc : '',
      company_document: doc.length === 14 ? doc : '',
      state_register: '',
      address: String(entrega.endereco).trim(),
      complement: String(entrega.complemento ?? '').trim(),
      number: String(entrega.numero).trim(),
      district: String(entrega.bairro ?? '').trim() || 'Centro',
      city: String(entrega.cidade).trim(),
      country_id: 'BR',
      postal_code: soDigitos(entrega.cep),
      state_abbr: String(entrega.uf).toUpperCase(),
    };
    const declarar = cfg.declararValor !== false;
    const envio = (cx: CaixaDoPedido[], produtos: ItemDeclarado[]): EnvioCarrinho => {
      const somaC = produtos.reduce((s, p) => s + p.unitarioC * p.quantidade, 0);
      return {
        service: entrega.servico!.id,
        from,
        to,
        products: produtos.map((p) => ({
          name: p.nome,
          quantity: String(p.quantidade),
          unitary_value: (p.unitarioC / 100).toFixed(2),
        })),
        volumes: cx.map((c) => ({
          height: Math.ceil(c.alturaCm),
          width: Math.ceil(c.larguraCm),
          length: Math.ceil(c.comprimentoCm),
          weight: Math.max(0.01, c.pesoKg),
        })),
        options: {
          insurance_value: declarar ? somaC / 100 : 0,
          receipt: false,
          own_hand: false,
          reverse: false,
          non_commercial: true,
          platform: 'Betinna',
          reminder: `Pedido ${pedido.numero}`,
        },
      };
    };
    if (caixas.length > 1 && umaCaixaPorEnvio(entrega.servico!.transportadora)) {
      const porCaixa = pecasPorCaixa(itens, caixas);
      return caixas.map((c, i) => envio([c], porCaixa[i]));
    }
    return [envio(caixas, itens)];
  }
}
