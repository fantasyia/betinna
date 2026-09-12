import { Injectable, Logger } from '@nestjs/common';
import { EnvService } from '@config/env.service';
import { PrismaService } from '@database/prisma.service';
import { HttpClientService } from '@shared/http/http-client.service';
import { HttpClientError } from '@shared/http/http-client.types';

export interface StatusParaSite {
  numeroSite: string;
  status: string;
  rastreioCodigo?: string | null;
  rastreioUrl?: string | null;
}

/** O que a varredura precisa saber do pedido pra decidir se o site está atrasado. */
export interface PedidoParaSite {
  id: string;
  numeroSite: string | null;
  status: string;
  rastreioCodigo: string | null;
  rastreioUrl: string | null;
  siteStatusEnviado: string | null;
  siteRastreioEnviado: string | null;
}

/**
 * `null` = nada a fazer (site já sabe, ou pedido não tem tela lá).
 * `true` = o site aceitou agora. `false` = falhou e ficou registrado pra reenvio.
 */
export type ResultadoSincronizacao = boolean | null;

/**
 * O resultado de UMA tentativa de avisar o site.
 *
 * ⚠️ Era um `boolean`, e o booleano era o problema: ele não distingue "o site
 * teve um soluço, tenta de novo" de "o site nunca vai aceitar isto". Quem só
 * sabe que falhou só tem uma opção — reenviar pra sempre.
 */
export type ResultadoNotificacao = { ok: true } | { ok: false; transitorio: boolean };

/**
 * Situação do Betinna → o vocabulário que o SITE fala.
 *
 * As duas pontas não usam as mesmas palavras, e não deveriam mesmo: aqui o
 * status é de operação (`ENVIADO_ERP` quer dizer "subiu pro Tiny"), lá é o que
 * o cliente lê na tela. Mandar o nome de cá fazia a rota do site recusar TUDO
 * com 400 — o `enum` dela só conhece as cinco palavras abaixo.
 *
 * Os quatro primeiros colapsam em `recebido` de propósito: pro cliente,
 * enquanto ninguém separou a mercadoria, o pedido está recebido. Distinguir
 * "aguardando aprovação" de "pago" na tela dele não informa, preocupa.
 */
const STATUS_PARA_SITE: Record<string, string> = {
  RASCUNHO: 'recebido',
  AGUARDANDO_APROVACAO: 'recebido',
  ENVIADO_ERP: 'recebido',
  PAGO: 'recebido',
  EM_SEPARACAO: 'em_separacao',
  ENVIADO: 'enviado',
  ENTREGUE: 'entregue',
  CANCELADO: 'cancelado',
};

/**
 * Avisa o SITE quando a situação ou o rastreio do pedido mudam.
 *
 * O site é dono da tela do cliente — é lá que a pessoa vai olhar "cadê meu
 * pedido". Sem este retorno, o pedido pago some do ponto de vista dela até
 * alguém responder no WhatsApp; com ele, a tela conta a verdade sozinha.
 *
 * **Best-effort no MOMENTO, nunca no RESULTADO.** Site fora do ar não pode
 * derrubar a sincronização com o ERP — o estado real mora aqui, e a rodada não
 * espera. Mas o fracasso é GRAVADO (`siteErro`/`siteErroEm`) e reenviado depois
 * pelo `SiteStatusRetryJob`.
 *
 * ⚠️ Aqui morava uma mentira que custou o defeito: o comentário dizia "a rodada
 * seguinte reenvia", e ela NÃO reenviava. O sync do ERP só chega no aviso
 * quando `mudou` — e `mudou` compara o ERP com o NOSSO banco, que já tinha sido
 * atualizado antes do push. Push falhado ⇒ rodada seguinte via ERP == banco ⇒
 * `semMudanca` ⇒ o aviso nunca mais saía, e o site ficava com o status velho
 * para sempre, sem erro em lugar nenhum. Quem escreve "a próxima rodada
 * resolve" precisa apontar a linha que faz a próxima rodada acontecer.
 */
@Injectable()
export class SiteStatusService {
  private readonly logger = new Logger(SiteStatusService.name);

  constructor(
    private readonly env: EnvService,
    private readonly http: HttpClientService,
    private readonly prisma: PrismaService,
  ) {}

  /** `false` quando não há site configurado — o tenant simplesmente não tem um. */
  get configurado(): boolean {
    return Boolean(this.env.get('SITE_PEDIDOS_STATUS_URL')) && Boolean(this.segredo);
  }

  private get segredo(): string {
    return this.env.get('SITE_PEDIDOS_STATUS_SECRET') ?? '';
  }

  /**
   * ⚠️ TRANSITÓRIO × PERMANENTE — a distinção que decide se o retry faz sentido.
   *
   * 🔴 Sem ela, QUALQUER falha entrava na fila do `SiteStatusRetryJob`, que roda
   * de minuto em minuto e não tem contador de tentativas nem backoff. Um pedido
   * que falhasse por motivo permanente — segredo errado (401), pedido que não
   * existe no site (404) — seria reenviado **para sempre**, martelando o site e
   * enchendo o log com um erro que nunca vai parar sozinho.
   *
   * 📌 O arquivo já acertava este princípio logo abaixo, com todas as letras:
   * *"reenviar eternamente algo que o site nunca vai aceitar é um loop mudo"* —
   * mas só para status sem equivalente. O erro HTTP ficou de fora.
   *
   * O que conta como transitório é o que o site (ou a rede) diz que vale repetir:
   * `503` do soluço de banco (que o site devolve de propósito, com
   * `Retry-After: 30`), `429` de throttle, `5xx` em geral, e `status 0` — que é
   * como o `HttpClientService` marca timeout e falha de rede.
   */
  private static transitorio(err: unknown): boolean {
    if (!(err instanceof HttpClientError)) return true; // erro desconhecido: não desiste
    return err.status === 0 || err.status === 429 || err.status >= 500;
  }

  async notificar(dados: StatusParaSite): Promise<ResultadoNotificacao> {
    if (!this.configurado) return { ok: false, transitorio: false };
    // Pedido que não nasceu no site não tem tela lá pra atualizar.
    if (!dados.numeroSite) return { ok: false, transitorio: false };

    // Status que não tem palavra equivalente no site não vira chamada: a rota
    // de lá recusaria com 400 e o log ficaria cheio de erro que não é erro.
    const statusSite = STATUS_PARA_SITE[dados.status];
    if (!statusSite) {
      this.logger.warn(
        `[site] status "${dados.status}" sem equivalente — ${dados.numeroSite} não avisado`,
      );
      return { ok: false, transitorio: false };
    }

    try {
      await this.http.post(this.env.get('SITE_PEDIDOS_STATUS_URL'), {
        body: {
          numero: dados.numeroSite,
          status: statusSite,
          rastreioCodigo: dados.rastreioCodigo ?? null,
          rastreioUrl: dados.rastreioUrl ?? null,
        },
        headers: { 'x-pedidos-secret': this.segredo },
        // Site fora do ar não pode segurar a rodada: 1 tentativa e segue.
        retries: 1,
        timeoutMs: 8000,
      });
      this.logger.log(`[site] ${dados.numeroSite} → ${statusSite} avisado`);
      return { ok: true };
    } catch (err) {
      const transitorio = SiteStatusService.transitorio(err);
      const codigo = err instanceof HttpClientError ? err.status : '?';
      this.logger.warn(
        `[site] não consegui avisar ${dados.numeroSite} (HTTP ${codigo}, ` +
          `${transitorio ? 'transitório — vai reenviar' : 'PERMANENTE — não reenvia'}): ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      return { ok: false, transitorio };
    }
  }

  /**
   * Deixa o site em dia com UM pedido — e registra o resultado no próprio pedido.
   *
   * É o único ponto que deve ser chamado por quem muda pedido: `notificar()`
   * sozinho é transporte, e transporte que não anota o fracasso foi exatamente
   * o defeito. Idempotente de propósito — chamar duas vezes com o site já em
   * dia não gera chamada nenhuma (devolve `null`), que é o que permite a
   * varredura rodar de minuto em minuto sem martelar o site.
   */
  async sincronizarPedido(pedido: PedidoParaSite): Promise<ResultadoSincronizacao> {
    if (!this.configurado) return null;
    // Pedido que não nasceu no site não tem tela lá pra atualizar.
    if (!pedido.numeroSite) return null;

    // Status sem palavra equivalente no site não vira chamada: a rota de lá
    // recusaria com 400. NÃO é erro, então também não marca pra reenvio —
    // reenviar eternamente algo que o site nunca vai aceitar é um loop mudo.
    const statusSite = STATUS_PARA_SITE[pedido.status];
    if (!statusSite) return null;

    const rastreio = pedido.rastreioCodigo ?? null;
    if (statusSite === pedido.siteStatusEnviado && rastreio === pedido.siteRastreioEnviado) {
      // O site já sabe. Nada a fazer — e nada a limpar: se havia erro, ele foi
      // limpo no push que deu certo.
      return null;
    }

    const r = await this.notificar({
      numeroSite: pedido.numeroSite,
      status: pedido.status,
      rastreioCodigo: pedido.rastreioCodigo,
      rastreioUrl: pedido.rastreioUrl,
    });

    if (r.ok) {
      await this.prisma.pedido.update({
        where: { id: pedido.id },
        data: {
          siteStatusEnviado: statusSite,
          siteRastreioEnviado: rastreio,
          siteErro: null,
          siteErroEm: null,
        },
      });
      return true;
    }

    // ⚠️ O QUE NÃO PODE ACONTECER É ISTO FICAR SÓ NO LOG.
    //
    // O site devolve 503 + `Retry-After: 30` num soluço de banco justamente pra
    // autorizar a repetição (conserto de 09/09, SOMATEC-WEB-3). Sem gravar
    // aqui, ninguém escutava esse 503: o log rotacionava e sobrava um pedido
    // cuja tela mente pro cliente. Gravado, o `SiteStatusRetryJob` reenvia.
    //
    // 🔴 Mas SÓ o transitório entra na fila. `siteErroEm` é o que o retry
    // procura, e ele roda de minuto em minuto sem contador de tentativas nem
    // backoff — então carimbar aqui uma falha PERMANENTE (401 de segredo errado,
    // 404 de pedido que não existe no site) criaria um reenvio eterno.
    //
    // O erro permanente ainda fica registrado em `siteErro`, com o motivo: some
    // da fila, não some do prontuário. Quem olhar o pedido vê o que houve; o
    // cron não vê nada pra fazer.
    const motivo = `falha avisando o site: ${statusSite}${rastreio ? ` / ${rastreio}` : ''}`;
    await this.prisma.pedido.update({
      where: { id: pedido.id },
      data: r.transitorio
        ? { siteErro: motivo, siteErroEm: new Date() }
        : { siteErro: `PERMANENTE — ${motivo} (não será reenviado)`, siteErroEm: null },
    });
    return false;
  }
}
