import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import {
  TinyPedidosService,
  type PedidoTinyDetalhe,
} from '@integrations/tiny/tiny-pedidos.service';
import { TinyContatosService } from '@integrations/tiny/tiny-contatos.service';
import { IntegracoesService } from '@modules/integracoes/integracoes.service';
import { FluxoEventBusService } from '@modules/fluxos/fluxo-event-bus.service';
import { NotificacoesService } from '@modules/notificacoes/notificacoes.service';
import { LeadEtapaSistemaService } from '@modules/leads/lead-etapa-sistema.service';
import { SequenceService } from '@shared/utils/sequence.service';
import { SiteStatusService } from './site-status.service';

export interface ResultadoSyncPedidos {
  lidos: number;
  criados: number;
  atualizados: number;
  semMudanca: number;
  /** Vistos no ERP e deixados de fora por serem mais velhos que a janela. */
  foraDaJanela: number;
  /** Pedidos que entraram, mas com alguma informação que o app não soube casar. */
  avisos: string[];
  erros: number;
}

/** Teto de pedidos por rodada — trava de segurança, não regra de negócio. */
const MAX_POR_RODADA = 500;
/** Janela padrão (dias) da varredura por data de criação. */
const JANELA_PADRAO_DIAS = 30;

/**
 * Situações do Tiny → status do Betinna.
 *
 * `9 não entregue` fica de fora de propósito: não existe status equivalente
 * aqui, e inventar um faria a entrega falhada virar informação calada. Ela é
 * tratada à parte — carimbo na observação + notificação pra gente resolver.
 */
const STATUS_POR_SITUACAO: Record<number, string> = {
  0: 'ENVIADO_ERP', // aberta
  3: 'ENVIADO_ERP', // aprovada
  1: 'EM_SEPARACAO', // faturada
  4: 'EM_SEPARACAO', // preparando envio
  7: 'EM_SEPARACAO', // pronto pro envio
  5: 'ENVIADO', // enviada
  6: 'ENTREGUE', // entregue
  2: 'CANCELADO', // cancelada
  8: 'ENVIADO_ERP', // dados incompletos — existe no ERP, ainda não caminhou
};

/** Situação do Tiny em que a NOTA FISCAL saiu. É o marco da instalação. */
const SITUACAO_FATURADA = 1;
const SITUACAO_NAO_ENTREGUE = 9;
const MARCA_NAO_ENTREGUE = '[ERP] entrega não realizada';

/**
 * Traz os pedidos do ERP PRA CÁ.
 *
 * Até agora a ponte era de mão única: o app criava o pedido e empurrava pro
 * Tiny. Quem vendia pelo site, ou quem lançava direto no ERP, não existia no
 * app — e o pedido empurrado congelava no status do dia em que subiu, porque
 * faturamento, despacho e entrega acontecem lá.
 *
 * **O ERP é a fonte da verdade.** Aqui é espelho: status, valores e rastreio
 * descem do Tiny e sobrescrevem o que estiver por aqui. O caminho contrário
 * (criar/alterar pedido) continua sendo o push, e só ele.
 *
 * **Duas redes, porque uma só deixa buraco:**
 *  1. varredura por janela de criação (pega o que nasceu no ERP);
 *  2. conferência dirigida dos pedidos daqui que ainda não terminaram — por
 *     número, um a um. Sem ela, o pedido criado há 60 dias que foi entregue
 *     hoje ficaria "Enviado" pra sempre, porque saiu da janela.
 *
 * **Visibilidade:** o representante só enxerga o que é dele, e isso não é regra
 * desta classe — é o escopo de rep que já existe na listagem. O que esta classe
 * faz é preencher `representanteId` casando o VENDEDOR do Tiny com o usuário do
 * app; sem casar, o pedido entra sem dono e só admin/diretor veem. Chutar um
 * dono seria pior: comissão é dinheiro de alguém.
 */
/** Código dos Correios/Melhor Envio: 2 letras + 9 dígitos + 2 letras. */
const CODIGO_OBJETO = /^[A-Z]{2}\d{9}[A-Z]{2}$/i;
/** Nomes de forma de envio que passam pelo Melhor Envio (o Olist Envios é ele por baixo). */
const ENVIO_MELHOR_ENVIO = /melhor\s*envio|olist\s*envios/i;

/**
 * Link de rastreio PRA MOSTRAR AO CLIENTE quando o ERP não manda nenhum.
 *
 * O `urlRastreamento` do Tiny é campo livre: vem preenchido quando a
 * transportadora/integração fornece, e vazio no resto — e aí a mensagem de
 * despacho sairia com o código e sem lugar nenhum pra clicar.
 *
 * O Melhor Rastreio resolve pelo código e é **público**: conferido em 03/09
 * renderizando `/rastreio/<codigo>` sem sessão nenhuma (a página redireciona
 * pra `/app/<transportadora>/<codigo>` e mostra o rastreio; "Entrar" é só o
 * cabeçalho). Link que exige login não serve pro cliente final.
 *
 * Só monta quando dá pra ter certeza de que o código é rastreável lá: envio
 * pelo Melhor Envio/Olist Envios, ou código no formato de objeto dos Correios.
 * Fora disso devolve null — link que abre em "não encontrado" é pior que
 * mensagem sem link.
 */
export function linkPublicoRastreio(
  codigo: string | null,
  formaEnvio?: { id?: number; nome?: string } | string,
): string | null {
  if (!codigo) return null;
  const nomeEnvio = typeof formaEnvio === 'string' ? formaEnvio : (formaEnvio?.nome ?? '');
  const rastreavel = ENVIO_MELHOR_ENVIO.test(nomeEnvio) || CODIGO_OBJETO.test(codigo);
  if (!rastreavel) return null;
  return `https://www.melhorrastreio.com.br/rastreio/${encodeURIComponent(codigo)}`;
}

@Injectable()
export class PedidoErpSyncService {
  private readonly logger = new Logger(PedidoErpSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tiny: TinyPedidosService,
    private readonly integracoes: IntegracoesService,
    private readonly sequence: SequenceService,
    private readonly contatos: TinyContatosService,
    private readonly site: SiteStatusService,
    private readonly notificacoes: NotificacoesService,
    private readonly bus: FluxoEventBusService,
    private readonly etapa: LeadEtapaSistemaService,
  ) {}

  async sincronizar(
    empresaId: string,
    opcoes: { dias?: number } = {},
  ): Promise<ResultadoSyncPedidos> {
    const dias = Math.min(Math.max(opcoes.dias ?? JANELA_PADRAO_DIAS, 1), 365);
    const inicioDaRodada = new Date();
    const r: ResultadoSyncPedidos = {
      lidos: 0,
      criados: 0,
      atualizados: 0,
      semMudanca: 0,
      foraDaJanela: 0,
      avisos: [],
      erros: 0,
    };

    const ate = new Date();
    const de = new Date(ate.getTime() - dias * 24 * 60 * 60 * 1000);

    // Rede 1 — o que nasceu no ERP dentro da janela.
    const ids = await this.idsDaJanela(empresaId, de, ate, r);

    // Rede 2 — pedidos daqui que ainda não terminaram e ficaram fora da janela.
    const pendentes = await this.prisma.pedido.findMany({
      where: {
        empresaId,
        numeroErp: { not: null },
        status: { notIn: ['ENTREGUE', 'CANCELADO'] as never },
      },
      select: { numeroErp: true },
      take: MAX_POR_RODADA,
    });
    for (const p of pendentes) {
      if (!p.numeroErp) continue;
      try {
        const achado = await this.tiny.listar(empresaId, { numero: p.numeroErp, limit: 5 });
        const exato = achado.itens.find((i) => String(i.numeroPedido ?? i.id) === p.numeroErp);
        if (exato?.id) ids.add(exato.id);
      } catch (err) {
        // Um pedido que não responde não pode derrubar a rodada inteira: o
        // resto do espelho continua valendo.
        r.erros += 1;
        this.logger.warn(`[erp] não consegui conferir o pedido ${p.numeroErp}: ${this.msg(err)}`);
      }
    }

    const lista = [...ids].slice(0, MAX_POR_RODADA);
    if (ids.size > MAX_POR_RODADA) {
      // Teto silencioso mente: parece que sincronizou tudo.
      const aviso =
        `Teto de ${MAX_POR_RODADA} pedidos por rodada atingido — ` +
        `${ids.size - MAX_POR_RODADA} ficaram pra próxima.`;
      r.avisos.push(aviso);
      this.logger.warn(`[erp] ${aviso}`);
    }

    for (const id of lista) {
      try {
        const detalhe = await this.tiny.obter(empresaId, id);
        r.lidos += 1;
        const efeito = await this.aplicar(empresaId, detalhe, r, de, ate);
        if (efeito === 'criado') r.criados += 1;
        else if (efeito === 'atualizado') r.atualizados += 1;
        else if (efeito === 'foraDaJanela' || efeito === 'jaCancelado') r.foraDaJanela += 1;
        else r.semMudanca += 1;
      } catch (err) {
        r.erros += 1;
        this.logger.warn(`[erp] pedido ${id} falhou: ${this.msg(err)}`);
      }
    }

    if (r.erros === 0) {
      await this.integracoes
        .gravarCursorRecurso(empresaId, 'tiny', 'pedidos', inicioDaRodada)
        .catch(() => undefined);
      await this.integracoes.registrarSaudeOk(empresaId, 'tiny').catch(() => undefined);
    }

    this.logger.log(
      `[erp] sync de pedidos (${dias}d): ${r.lidos} lidos, ${r.criados} criados, ` +
        `${r.atualizados} atualizados, ${r.semMudanca} sem mudança, ` +
        `${r.foraDaJanela} fora da janela, ${r.erros} erros`,
    );
    return r;
  }

  /**
   * Ids dos pedidos do ERP na janela — com plano B quando o filtro de data
   * não responde.
   *
   * O filtro por data existe na API (`dataInicial`/`dataFinal`), mas o formato
   * aceito não está documentado a ponto de merecer confiança cega: na primeira
   * rodada em produção ele devolveu ZERO com um pedido de dois dias atrás
   * sentado lá. E o pior modo de falhar é esse — sem erro, sem exceção, só uma
   * lista vazia que parece "não há pedidos novos".
   *
   * Então: tenta com data; se a primeira página vier vazia, refaz SEM filtro e
   * corta a janela aqui, comparando `dataCriacao`. Custa algumas páginas a mais
   * e devolve um aviso dizendo qual caminho valeu — silêncio aqui viraria
   * "sincronizei" com o ERP inteiro fora do app.
   */
  private async idsDaJanela(
    empresaId: string,
    de: Date,
    ate: Date,
    r: ResultadoSyncPedidos,
  ): Promise<Set<number>> {
    const ids = new Set<number>();

    // Passada 1 — com filtro de data. Rápida e barata quando funciona.
    let offset = 0;
    for (;;) {
      const pagina = await this.tiny.listar(empresaId, {
        dataInicial: this.dataIso(de),
        dataFinal: this.dataIso(ate),
        limit: 100,
        offset,
      });
      for (const p of pagina.itens) if (p.id) ids.add(p.id);
      if (pagina.itens.length < 100 || ids.size >= MAX_POR_RODADA) break;
      offset += 100;
    }

    // Passada 2 — SEM filtro, sempre. Não é plano B: é rede.
    //
    // A listagem do Tiny devolve `dataCriacao` VAZIA, e pedido sem data não casa
    // com filtro de data nenhum. Foi o que aconteceu no primeiro teste em
    // produção: dos três pedidos do ERP, o filtro achou os dois com data e
    // ignorou em silêncio o terceiro. Enquanto a passada 1 devolvesse ALGUMA
    // coisa, o buraco ficava invisível — a tela dizia "sincronizado".
    //
    // Quem decide se o pedido é da janela é o DETALHE (que tem `data`), lá no
    // `aplicar`. Aqui a regra é simples: na dúvida, olha.
    let offsetB = 0;
    let lidosB = 0;
    for (;;) {
      const pagina = await this.tiny.listar(empresaId, { limit: 100, offset: offsetB });
      lidosB += pagina.itens.length;
      for (const p of pagina.itens) if (p.id) ids.add(p.id);
      if (pagina.itens.length < 100 || ids.size >= MAX_POR_RODADA || lidosB >= 2000) break;
      offsetB += 100;
    }
    if (lidosB >= 2000) {
      // Parar de ler sem dizer que parou e o mesmo erro de novo, so que maior.
      const aviso =
        'A varredura leu 2000 pedidos do ERP e parou ai — conta grande demais pra ' +
        'passada completa. Reduza a janela (dias) ou me avise pra paginar por data.';
      r.avisos.push(aviso);
      this.logger.warn('[erp] ' + aviso);
    }
    return ids;
  }

  /**
   * A janela é por DIA, não por hora.
   *
   * O ERP manda data pura ('YYYY-MM-DD'), que aqui vira meio-dia UTC. Comparar
   * isso com o instante exato de agora excluía o pedido feito HOJE de manhã —
   * meio-dia ainda está no futuro. Um pedido de hoje sumindo do sync é
   * exatamente o caso que mais dói.
   */
  private dentroDaJanela(bruto: string | undefined, de: Date, ate: Date): boolean {
    if (!bruto) return true;
    const d = new Date(bruto.length === 10 ? `${bruto}T12:00:00Z` : bruto);
    if (Number.isNaN(d.getTime())) return true;
    const inicio = new Date(this.dataIso(de) + 'T00:00:00Z').getTime();
    const fim = new Date(this.dataIso(ate) + 'T23:59:59Z').getTime();
    const t = d.getTime();
    return t >= inicio && t <= fim;
  }

  /**
   * Sincroniza UM pedido, pelo id do ERP — o caminho do webhook.
   *
   * Janela larga de propósito: webhook de pedido antigo é legítimo (o ERP pode
   * faturar hoje algo criado há meses), e a janela existe pra limitar
   * varredura, não pra recusar fato conhecido.
   */
  async sincronizarUm(
    empresaId: string,
    idTiny: number,
  ): Promise<'criado' | 'atualizado' | 'semMudanca' | 'foraDaJanela' | 'jaCancelado'> {
    const detalhe = await this.tiny.obter(empresaId, idTiny);
    const r: ResultadoSyncPedidos = {
      lidos: 1,
      criados: 0,
      atualizados: 0,
      semMudanca: 0,
      foraDaJanela: 0,
      avisos: [],
      erros: 0,
    };
    const ate = new Date();
    const de = new Date(ate.getTime() - 365 * 24 * 60 * 60 * 1000);
    const efeito = await this.aplicar(empresaId, detalhe, r, de, ate);
    for (const aviso of r.avisos) this.logger.warn(`[erp] ${aviso}`);
    return efeito;
  }

  // ─── Aplicação de um pedido do ERP ──────────────────────────────────────

  private async aplicar(
    empresaId: string,
    d: PedidoTinyDetalhe,
    r: ResultadoSyncPedidos,
    de: Date,
    ate: Date,
  ): Promise<'criado' | 'atualizado' | 'semMudanca' | 'foraDaJanela' | 'jaCancelado'> {
    const numeroErp = String(d.numeroPedido ?? d.id);
    const existente = await this.prisma.pedido.findFirst({
      where: { empresaId, numeroErp },
      select: {
        id: true,
        numero: true,
        status: true,
        observacoes: true,
        total: true,
        rastreioCodigo: true,
        rastreioUrl: true,
        representanteId: true,
        numeroSite: true,
        clienteId: true,
      },
    });

    const status = this.statusDe(d.situacao);
    const rastreioCodigo = d.transportador?.codigoRastreamento?.trim() || null;
    const rastreioUrl =
      d.transportador?.urlRastreamento?.trim() ||
      linkPublicoRastreio(rastreioCodigo, d.transportador?.formaEnvio);
    const total = new Prisma.Decimal(d.valorTotalPedido ?? d.valorTotalProdutos ?? 0);

    if (existente) {
      // Pedido órfão ADOTA o dono quando ele passa a existir.
      //
      // Sem isto, o pedido que entrou sem representante (vendedor ainda não
      // casado no ERP, ou contato ainda não vinculado) ficava órfão pra sempre:
      // arrumar o cadastro depois não trazia dono nenhum, e a comissão daquela
      // venda simplesmente não existia. Só adota quem NÃO tem dono — trocar o
      // dono de um pedido é mexer na comissão de duas pessoas.
      const adotouRep = await this.adotarRepresentante(empresaId, d, existente);

      const mudou =
        (status !== null && status !== existente.status) ||
        rastreioCodigo !== existente.rastreioCodigo ||
        rastreioUrl !== existente.rastreioUrl ||
        !new Prisma.Decimal(existente.total).equals(total);

      const naoEntregue = await this.tratarNaoEntregue(empresaId, d, existente);
      if (!mudou) return naoEntregue || adotouRep ? 'atualizado' : 'semMudanca';

      const viraEntregue = status === 'ENTREGUE' && existente.status !== 'ENTREGUE';
      // O rastreio PASSOU A EXISTIR. É a transição vazio → preenchido, não o
      // status: o ERP às vezes preenche fora de ordem, e amarrar em `ENVIADO`
      // perderia esses casos. Comparar com o que estava guardado é o que
      // garante UMA notificação por pedido — a varredura roda todo dia e
      // reemitir mandaria o mesmo código pro cliente de novo.
      const ganhouRastreio = Boolean(rastreioCodigo) && !existente.rastreioCodigo;
      await this.prisma.pedido.update({
        where: { id: existente.id },
        data: {
          ...(status ? { status: status as never } : {}),
          rastreioCodigo,
          rastreioUrl,
          total,
          // Só carimba a primeira entrega: é a base da janela de devolução.
          ...(viraEntregue ? { entregueEm: new Date() } : {}),
        },
      });
      this.logger.log(
        `[erp] pedido ${existente.numero} (ERP ${numeroErp}): ` +
          `${existente.status} → ${status ?? existente.status}`,
      );
      // NOTA FISCAL emitida = a primeira mensalidade foi faturada, e é isso que
      // move o cliente pra instalação. `somenteDe` limita ao contrato recém
      // assinado: sem ele, a nota do 7º mês de um contrato antigo empurraria
      // pra instalação um lead que voltou a negociar outra coisa.
      if (d.situacao === SITUACAO_FATURADA && status !== existente.status) {
        await this.etapa.mover({
          empresaId,
          clienteId: existente.clienteId,
          marco: 'instalacao',
          somenteDe: 'contratoAssinado',
          origem: 'erp',
          motivo: `NF emitida no pedido ${existente.numero} (ERP ${numeroErp})`,
        });
      }
      if (viraEntregue) await this.dispararEntregue(empresaId, existente.id);
      if (ganhouRastreio) await this.dispararRastreio(empresaId, existente.id);
      // O site é dono da tela do cliente: sem este aviso, quem comprou lá fica
      // sem saber que o pedido foi faturado ou despachado.
      await this.site.notificar({
        numeroSite: existente.numeroSite ?? '',
        status: status ?? existente.status,
        rastreioCodigo,
        rastreioUrl,
      });
      return 'atualizado';
    }

    // ─── Pedido que nasceu no ERP (site, telefone, balcão) ────────────────
    //
    // Corte da janela acontece AQUI, com a data do detalhe — a listagem não
    // devolve data confiável. Pedido velho demais não entra; pedido daqui que
    // já existe (bloco acima) atualiza sempre, independente de idade.
    if (!this.dentroDaJanela(d.data ?? d.dataCriacao, de, ate)) return 'foraDaJanela';

    // Pedido que JÁ chega cancelado e nunca existiu aqui não vira registro: é
    // ruído histórico do ERP. (Se ele existir aqui, o bloco acima atualiza pra
    // CANCELADO normalmente — o que importa é não NASCER morto.) Sem isto, todo
    // pedido cancelado lá volta a aparecer aqui a cada rodada, e apagar do app
    // não adianta nada: o sync seguinte traz de volta.
    if (status === 'CANCELADO') return 'jaCancelado';

    // ── O pedido que estava TRAVADO aqui é ESTE, voltando liberado ──────
    //
    // O ciclo do rep fecha assim: proposta aceita → pedido travado no app →
    // contrato assinado → orçamento no ERP → o Leandro libera e o ERP gera o
    // pedido de venda. Sem esta adoção, esse pedido nasceria como um SEGUNDO
    // registro e o cliente apareceria com dois pedidos do mesmo negócio — um
    // travado pra sempre, outro "nascido no ERP", cada um com sua comissão.
    const daProposta = this.propostaDaObservacao(d);
    if (daProposta) {
      const travado = await this.prisma.pedido.findFirst({
        where: { empresaId, propostaNumero: daProposta, status: 'AGUARDANDO_LIBERACAO' },
        select: { id: true, numero: true, representanteId: true },
      });
      if (travado) {
        await this.prisma.pedido.update({
          where: { id: travado.id },
          data: {
            numeroErp,
            status: (status ?? 'ENVIADO_ERP') as never,
            total,
            rastreioCodigo,
            rastreioUrl,
            enviadoErpEm: new Date(),
            // O ERP é quem sabe o vendedor depois que o Leandro atribuiu — mas
            // só adota quem ainda não tem dono (trocar dono mexe na comissão de
            // duas pessoas).
            ...(travado.representanteId
              ? {}
              : { representanteId: await this.resolverRepresentante(empresaId, d) }),
          },
        });
        this.logger.log(
          `[erp] pedido ${travado.numero} LIBERADO no ERP (nº ${numeroErp}) — saiu de AGUARDANDO_LIBERACAO`,
        );
        await this.notificarLiberado(
          empresaId,
          travado.id,
          travado.numero,
          travado.representanteId,
        );
        return 'atualizado';
      }
    }

    const cliente = await this.resolverCliente(empresaId, d);
    const representanteId = await this.resolverRepresentante(empresaId, d);
    if (!representanteId && d.vendedor) {
      r.avisos.push(
        `Pedido ${numeroErp}: vendedor "${this.nomeVendedor(d) ?? '—'}" não casou com ` +
          'nenhum usuário do app — entrou sem representante (só admin/diretor enxergam). ' +
          'Vincule o contato do ERP ao usuário (Usuários → contato no ERP) pra casar sem depender do nome.',
      );
    }

    const itens = await this.montarItens(empresaId, d, numeroErp, r);
    const seq = await this.sequence.next(empresaId, 'pedido');
    const numero = `PED-${seq.toString().padStart(4, '0')}`;
    const criadoEm = this.dataDoPedido(d);
    const comissaoPct = await this.comissaoPct(representanteId);

    const criado = await this.prisma.pedido.create({
      data: {
        empresaId,
        numero,
        numeroErp,
        clienteId: cliente.id,
        representanteId,
        // ORIGEM é o que decide a comissão de originação (6% rep / 12% canal),
        // então ela precisa dizer a verdade sobre a VENDA, não sobre qual
        // sistema digitou o pedido. Pedido com vendedor que é representante
        // daqui é venda por representante — inclusive o que voltou do ERP
        // depois da aprovação de uma proposta nossa. Sem dono, é canal.
        origem: representanteId ? 'REP_APP' : 'ERP',
        status: (status ?? 'ENVIADO_ERP') as never,
        subtotal: new Prisma.Decimal(d.valorTotalProdutos ?? d.valorTotalPedido ?? 0),
        total,
        comissao: total.mul(comissaoPct).div(100),
        rastreioCodigo,
        rastreioUrl,
        propostaNumero: this.propostaDaObservacao(d),
        observacoes: d.observacoes?.slice(0, 2000) || null,
        // Data do ERP, não a de agora: comissão e relatório fecham por período, e
        // importar tudo com a data de hoje jogaria venda de outro mês pra cá.
        criadoEm,
        enviadoErpEm: criadoEm,
        ...(status === 'ENTREGUE' ? { entregueEm: criadoEm } : {}),
        ...(itens.length > 0 ? { itens: { create: itens } } : {}),
      },
      select: { id: true, numero: true },
    });
    this.logger.log(`[erp] pedido ${criado.numero} importado do ERP (nº ${numeroErp})`);
    await this.tratarNaoEntregue(empresaId, d, {
      id: criado.id,
      numero: criado.numero,
      observacoes: null,
    });
    return 'criado';
  }

  /**
   * `9 não entregue` é conversa de gente, não status.
   *
   * O carimbo na observação é o que evita a notificação diária: o ERP vai
   * continuar respondendo 9 até alguém resolver, e avisar todo dia é o mesmo
   * que não avisar.
   */
  private async tratarNaoEntregue(
    empresaId: string,
    d: PedidoTinyDetalhe,
    pedido: { id: string; numero: string; observacoes: string | null },
  ): Promise<boolean> {
    if (d.situacao !== SITUACAO_NAO_ENTREGUE) return false;
    if (pedido.observacoes?.includes(MARCA_NAO_ENTREGUE)) return false;

    const carimbo =
      `${MARCA_NAO_ENTREGUE} — ${new Date().toLocaleDateString('pt-BR')}. ` +
      'Verifique a expedição no ERP.';
    await this.prisma.pedido.update({
      where: { id: pedido.id },
      data: { observacoes: pedido.observacoes ? `${pedido.observacoes}\n${carimbo}` : carimbo },
    });
    await this.notificacoes
      .criarParaRole({
        empresaId,
        roles: ['ADMIN', 'DIRECTOR'],
        tipo: 'GENERICO',
        prioridade: 'ALTA',
        titulo: 'Entrega não realizada',
        mensagem:
          `O ERP marcou o pedido ${pedido.numero} como NÃO ENTREGUE. ` +
          'Precisa de decisão humana (reenvio, contato ou devolução).',
        link: `/pedidos?busca=${encodeURIComponent(pedido.numero)}`,
        metadata: { pedidoId: pedido.id, situacaoErp: SITUACAO_NAO_ENTREGUE },
      })
      .catch(() => 0);
    return true;
  }

  /**
   * Avisa que o rastreio existe — no DESPACHO, que é quando o cliente quer.
   *
   * Leva `rastreioCodigo` e `rastreioUrl` no payload de propósito: o nó de
   * WhatsApp interpola do contexto e não vai ao banco. Sem os dois campos aqui,
   * a mensagem sairia sem o código, que é a única coisa que ela precisa dizer.
   */
  private async dispararRastreio(empresaId: string, pedidoId: string): Promise<void> {
    const p = await this.prisma.pedido.findUnique({
      where: { id: pedidoId },
      select: {
        id: true,
        numero: true,
        numeroSite: true,
        total: true,
        clienteId: true,
        representanteId: true,
        rastreioCodigo: true,
        rastreioUrl: true,
        cliente: { select: { id: true, nome: true } },
      },
    });
    if (!p?.rastreioCodigo) return;
    void this.bus.disparar(empresaId, 'PEDIDO_RASTREIO_DISPONIVEL', {
      pedidoId: p.id,
      // `numeroSite` primeiro: quem comprou pelo site conhece o SB…, não o
      // PED-…. Mandar o número interno faria a mensagem citar algo que a
      // pessoa nunca viu.
      pedido: { id: p.id, numero: p.numeroSite ?? p.numero, total: Number(p.total) },
      clienteId: p.clienteId,
      cliente: { id: p.cliente.id, nome: p.cliente.nome },
      representanteId: p.representanteId,
      rastreioCodigo: p.rastreioCodigo,
      rastreioUrl: p.rastreioUrl,
    });
    this.logger.log(`[erp] pedido ${p.numero}: rastreio disponível (${p.rastreioCodigo})`);
  }

  private async dispararEntregue(empresaId: string, pedidoId: string): Promise<void> {
    const p = await this.prisma.pedido.findUnique({
      where: { id: pedidoId },
      select: {
        id: true,
        numero: true,
        total: true,
        clienteId: true,
        representanteId: true,
        cliente: { select: { id: true, nome: true } },
      },
    });
    if (!p) return;
    void this.bus.disparar(empresaId, 'PEDIDO_ENTREGUE', {
      pedidoId: p.id,
      pedido: { id: p.id, numero: p.numero, total: Number(p.total) },
      clienteId: p.clienteId,
      cliente: { id: p.cliente.id, nome: p.cliente.nome },
      representanteId: p.representanteId,
    });
  }

  // ─── Resolução de cliente / rep / itens ─────────────────────────────────

  /**
   * Acha o cliente ou cria — por id do ERP, depois por CPF/CNPJ.
   *
   * Documento antes de nome pelo mesmo motivo do push: nome varia ("Somatec",
   * "SOMATEC LTDA") e cada variação viraria um cliente novo, espalhando
   * histórico e carteira por cadastros diferentes.
   */
  private async resolverCliente(empresaId: string, d: PedidoTinyDetalhe): Promise<{ id: string }> {
    const codigoErp = d.cliente?.id != null ? String(d.cliente.id) : null;
    const doc = (d.cliente?.cpfCnpj ?? '').replace(/\D/g, '');

    if (codigoErp) {
      const porErp = await this.prisma.cliente.findFirst({
        where: { empresaId, codigoErp },
        select: { id: true },
      });
      if (porErp) return porErp;
    }
    if (doc) {
      const porDoc = await this.prisma.cliente.findFirst({
        where: { empresaId, cnpj: doc },
        select: { id: true },
      });
      if (porDoc) {
        // Vincula o código do ERP na primeira vez que os dois se encontram.
        if (codigoErp) {
          await this.prisma.cliente
            .update({ where: { id: porDoc.id }, data: { codigoErp } })
            .catch(() => undefined);
        }
        return porDoc;
      }
    }

    return this.prisma.cliente.create({
      data: {
        empresaId,
        codigoErp,
        nome: d.cliente?.nome?.trim() || `Cliente ERP ${codigoErp ?? '—'}`,
        cnpj: doc || null,
        email: d.cliente?.email || null,
        telefone: d.cliente?.celular || d.cliente?.fone || null,
        cidade: d.cliente?.cidade || null,
        uf: d.cliente?.uf || null,
      },
      select: { id: true },
    });
  }

  /**
   * Dá dono ao pedido que entrou órfão, quando o ERP já sabe quem é.
   *
   * Recalcula a comissão junto: comissão zerada num pedido com rep é pior que
   * pedido sem rep — parece resolvido e paga nada.
   */
  private async adotarRepresentante(
    empresaId: string,
    d: PedidoTinyDetalhe,
    existente: { id: string; numero: string; representanteId: string | null; total: unknown },
  ): Promise<boolean> {
    if (existente.representanteId) return false;
    const representanteId = await this.resolverRepresentante(empresaId, d);
    if (!representanteId) return false;

    const pct = await this.comissaoPct(representanteId);
    const total = new Prisma.Decimal(existente.total as Prisma.Decimal);
    await this.prisma.pedido.update({
      where: { id: existente.id },
      // Ganhou dono → é venda por representante, e a originação enxerga isso.
      data: { representanteId, origem: 'REP_APP', comissao: total.mul(pct).div(100) },
    });
    this.logger.log(
      `[erp] pedido ${existente.numero} adotou o representante ${representanteId} (comissão ${pct}%)`,
    );
    return true;
  }

  /**
   * Casa o VENDEDOR do Tiny com o usuário do app.
   *
   * **Pelo CONTATO primeiro.** O vendedor do Tiny é um contato, e o contato tem
   * id — que é o que `Usuario.contatoErpId` guarda. Nome é a segunda opção
   * porque é frágil de verdade: no primeiro teste em produção o vendedor
   * "REP TESTE" não casou com o usuário "TESTE · Automação", e o pedido entrou
   * sem dono (some da tela do rep, comissão sem destinatário).
   *
   * Sem casar de nenhum jeito, o pedido fica sem representante de propósito:
   * atribuir ao rep errado mexeria na comissão de duas pessoas.
   */
  private async resolverRepresentante(
    empresaId: string,
    d: PedidoTinyDetalhe,
  ): Promise<string | null> {
    const usuarios = await this.prisma.usuario.findMany({
      where: { empresas: { some: { empresaId } }, role: { in: ['REP', 'GERENTE'] } },
      select: { id: true, nome: true, contatoErpId: true },
    });

    const contatoDoVendedor =
      d.vendedor?.contato?.id ??
      (d.vendedor?.id
        ? await this.contatos.acharContatoDoVendedor(empresaId, d.vendedor.id)
        : null);
    if (contatoDoVendedor) {
      const porContato = usuarios.filter(
        (u) => u.contatoErpId && Number(u.contatoErpId) === Number(contatoDoVendedor),
      );
      if (porContato.length === 1) return porContato[0].id;
    }

    const nome = this.nomeVendedor(d);
    if (!nome) return null;
    const alvo = this.normalizar(nome);
    const casados = usuarios.filter((u) => this.normalizar(u.nome) === alvo);
    // Dois usuários com o mesmo nome: não dá pra decidir, e decidir errado é
    // comissão na conta do outro.
    return casados.length === 1 ? casados[0].id : null;
  }

  private async montarItens(
    empresaId: string,
    d: PedidoTinyDetalhe,
    numeroErp: string,
    r: ResultadoSyncPedidos,
  ): Promise<Prisma.PedidoItemCreateWithoutPedidoInput[]> {
    const saida: Prisma.PedidoItemCreateWithoutPedidoInput[] = [];
    for (const item of d.itens ?? []) {
      const sku = item.produto?.sku?.trim();
      const produto = sku
        ? await this.prisma.produto.findFirst({ where: { empresaId, sku }, select: { id: true } })
        : null;
      if (!produto) {
        // O pedido entra mesmo assim: o valor total vem do ERP, então o
        // dinheiro fica certo — o que falta é a linha do item. Sumir com o
        // pedido inteiro por causa de um SKU desconhecido seria pior.
        r.avisos.push(
          `Pedido ${numeroErp}: SKU "${sku ?? '—'}" não existe no catálogo do app — ` +
            'item não importado.',
        );
        continue;
      }
      const quantidade = Math.max(1, Math.trunc(item.quantidade ?? 1));
      const precoUnitario = new Prisma.Decimal(item.valorUnitario ?? 0);
      saida.push({
        produto: { connect: { id: produto.id } },
        quantidade,
        precoUnitario,
        total: precoUnitario.mul(quantidade),
      });
    }
    return saida;
  }

  /** Comissão do rep no pedido importado — 0 quando não há dono definido. */
  private async comissaoPct(representanteId: string | null): Promise<number> {
    if (!representanteId) return 0;
    const rep = await this.prisma.usuario.findUnique({
      where: { id: representanteId },
      select: { comissaoPadrao: true },
    });
    return rep?.comissaoPadrao ?? 0;
  }

  // ─── Utilidades ─────────────────────────────────────────────────────────

  /**
   * De qual proposta o pedido nasceu.
   *
   * O pedido que o ERP gera a partir de um orçamento **não tem campo de
   * origem** — o único rastro é a observação, que ele herda do orçamento. Por
   * isso o app grava `[PROP-0001]` no COMEÇO dela: assim dá pra achar por
   * código, e não só lendo.
   */
  /** Quem vendeu precisa saber que o negócio saiu do limbo. */
  private async notificarLiberado(
    empresaId: string,
    pedidoId: string,
    numero: string,
    representanteId: string | null,
  ): Promise<void> {
    if (!representanteId) return;
    await this.notificacoes
      .criarParaUsuario({
        empresaId,
        usuarioId: representanteId,
        tipo: 'GENERICO',
        prioridade: 'ALTA',
        titulo: `Pedido ${numero} liberado no ERP`,
        mensagem: 'O contrato foi aprovado e o pedido saiu da espera — já é venda.',
        link: `/pedidos/${pedidoId}`,
      })
      .catch(() => undefined);
  }

  private propostaDaObservacao(d: PedidoTinyDetalhe): string | null {
    const texto = `${d.observacoesInternas ?? ''} ${d.observacoes ?? ''}`;
    return /\[(PROP-\d+)\]/.exec(texto)?.[1] ?? null;
  }

  private statusDe(situacao: number | undefined): string | null {
    if (situacao == null) return null;
    return STATUS_POR_SITUACAO[situacao] ?? null;
  }

  private nomeVendedor(d: PedidoTinyDetalhe): string | null {
    // O nome do vendedor mora no contato vinculado; `nome` direto aparece em
    // parte das respostas. Aceita os dois pra não depender de qual vem.
    return d.vendedor?.nome?.trim() || d.vendedor?.contato?.nome?.trim() || null;
  }

  private dataDoPedido(d: PedidoTinyDetalhe): Date {
    const bruto = d.data ?? d.dataCriacao;
    if (bruto) {
      // Data pura ('YYYY-MM-DD') vira meio-dia UTC: à meia-noite, o fuso do
      // Brasil jogaria o pedido pro dia anterior e o mês de fechamento junto.
      const dt = new Date(bruto.length === 10 ? `${bruto}T12:00:00Z` : bruto);
      if (!Number.isNaN(dt.getTime())) return dt;
    }
    return new Date();
  }

  private normalizar(v: string): string {
    return v
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  private dataIso(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  private msg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
