import { Injectable, Logger } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { EnvService } from '@config/env.service';
import { PrismaService } from '@database/prisma.service';
import { InboxService } from '@modules/inbox/inbox.service';

/** O que chega de um provedor de e-mail de entrada, já normalizado. */
export interface EmailRecebido {
  de: string;
  deNome?: string;
  para: string[];
  assunto: string;
  texto: string;
  messageId?: string;
  data?: Date;
}

export interface ResultadoEntrada {
  efeito: 'registrado' | 'duplicado' | 'sem-tenant' | 'sem-remetente' | 'sem-conteudo';
  empresaId?: string;
  conversationId?: string;
}

/**
 * Resposta de e-mail virando EVENTO — o buraco que deixava a régua falando
 * sozinha.
 *
 * A Inbox era alimentada só por WhatsApp e marketplace. Quem respondia um
 * e-mail da régua de nutrição não gerava evento nenhum: não parava a sequência,
 * não saía de `em-nutrição`, não virava tarefa — e a régua seguia mandando os
 * próximos e-mails pra quem já tinha respondido. É o pior tipo de automação:
 * a que persegue quem já deu sinal de vida.
 *
 * Metade do caminho já existia — o hook da Inbox resolve o lead **por e-mail**
 * e dispara `LEAD_RESPONDEU`. Faltava quem alimentasse. É isto aqui: um ponto
 * de entrada único e agnóstico de provedor, porque quem entrega o e-mail
 * (inbound do Resend, Cloudflare Email Routing, um encaminhador) é decisão de
 * infraestrutura que pode mudar sem que o app precise saber.
 *
 * ⚠️ O webhook do Resend que já existe NÃO serve pra isto: ele cobre entrega,
 * abertura, clique e bounce. Resposta é outro caminho, e exige MX próprio.
 */
@Injectable()
export class EmailInboundService {
  private readonly logger = new Logger(EmailInboundService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly inbox: InboxService,
  ) {}

  /**
   * Segredo compartilhado, comparado em tempo constante.
   *
   * Sem segredo configurado NADA entra: uma rota aberta de ingestão deixaria
   * qualquer um inventar "resposta" de um lead e, com isso, parar réguas e
   * criar tarefa pra representante. É o mesmo raciocínio do webhook do Resend.
   */
  segredoConfere(recebido?: string): boolean {
    const esperado = this.env.get('EMAIL_INBOUND_SECRET');
    if (!esperado || !recebido) return false;
    const a = createHash('sha256').update(esperado).digest();
    const b = createHash('sha256').update(recebido).digest();
    return timingSafeEqual(a, b);
  }

  /**
   * Normaliza o corpo do provedor.
   *
   * Três formatos aceitos de propósito: o do inbound do Resend
   * (`{type, data:{...}}`), o "cru" (campos na raiz) e o de um encaminhador
   * simples. Cada provedor nomeia os campos do seu jeito, e trocar de provedor
   * não pode virar migração de código.
   */
  normalizar(bruto: Record<string, unknown>): EmailRecebido | null {
    const raiz = (bruto?.data as Record<string, unknown>) ?? bruto ?? {};
    const de = this.soEndereco(this.primeiro(raiz.from ?? raiz.de ?? raiz.sender));
    if (!de) return null;
    const paraBruto = raiz.to ?? raiz.para ?? raiz.recipient ?? raiz.destinatario;
    const para = (Array.isArray(paraBruto) ? paraBruto : [paraBruto])
      .map((p) => this.soEndereco(String(p ?? '')))
      .filter((p): p is string => !!p);
    const assunto = String(raiz.subject ?? raiz.assunto ?? '').trim();
    const texto = this.cortarCitacao(
      String(raiz.text ?? raiz.texto ?? raiz['text-plain'] ?? this.semHtml(raiz.html)),
    );
    const quando = raiz.date ?? raiz.data ?? raiz.timestamp;
    const dt = quando ? new Date(String(quando)) : undefined;
    return {
      de,
      deNome: this.soNome(this.primeiro(raiz.from ?? raiz.de ?? raiz.sender)),
      para,
      assunto,
      texto,
      messageId: raiz.messageId ? String(raiz.messageId) : this.cabecalhoId(raiz),
      data: dt && !Number.isNaN(dt.getTime()) ? dt : undefined,
    };
  }

  /**
   * Registra a resposta na Inbox — e é o `processarMensagemEntrante` que, pelo
   * hook já existente, dispara o `LEAD_RESPONDEU`.
   */
  async registrar(bruto: Record<string, unknown>): Promise<ResultadoEntrada> {
    const email = this.normalizar(bruto);
    if (!email) return { efeito: 'sem-remetente' };

    const empresaId = await this.tenantDoDestinatario(email.para);
    if (!empresaId) {
      // 200 mesmo assim: provedor que recebe erro reentrega pra sempre um
      // e-mail que a gente conscientemente ignora (spam, endereço velho).
      this.logger.warn(`E-mail de entrada sem tenant (para: ${email.para.join(', ') || '?'})`);
      return { efeito: 'sem-tenant' };
    }

    const conteudo = [email.assunto, email.texto].filter(Boolean).join('\n\n').trim();
    if (!conteudo) return { efeito: 'sem-conteudo', empresaId };

    const r = await this.inbox.processarMensagemEntrante({
      empresaId,
      canal: 'EMAIL',
      // O endereço é a identidade do peer neste canal — é por ele que o hook
      // acha o lead e que a próxima resposta cai na MESMA conversa.
      peerId: email.de,
      peerNome: email.deNome || email.de,
      peerEmail: email.de,
      tipo: 'TEXT',
      conteudo,
      ...(email.messageId ? { externalId: email.messageId } : {}),
      ...(email.data ? { data: email.data } : {}),
    });

    this.logger.log(
      `Resposta por e-mail de ${email.de} registrada (empresa ${empresaId}, conversa ${r.conversationId})`,
    );
    return {
      efeito: r.duplicada ? 'duplicado' : 'registrado',
      empresaId,
      conversationId: r.conversationId,
    };
  }

  /**
   * De qual tenant é o endereço que RECEBEU.
   *
   * Ordem: endereço declarado em `config.emailInbound.enderecos` (explícito) e
   * depois o `replyTo` do tenant — que é pra onde a resposta naturalmente vai.
   * Multi-tenant obriga: sem isso, a resposta de um cliente cairia na caixa de
   * outra empresa.
   */
  private async tenantDoDestinatario(para: string[]): Promise<string | null> {
    if (para.length === 0) return null;
    const alvos = para.map((p) => p.toLowerCase());
    const empresas = await this.prisma.empresa
      .findMany({ where: { ativo: true }, select: { id: true, config: true } })
      .catch(() => [] as Array<{ id: string; config: unknown }>);
    for (const e of empresas) {
      const cfg = (e.config as Record<string, unknown> | null) ?? {};
      const inbound = (cfg.emailInbound as { enderecos?: unknown } | undefined)?.enderecos;
      const lista = (Array.isArray(inbound) ? inbound : []).map((x) => String(x).toLowerCase());
      const replyTo = String(
        (cfg.emailTransacional as { replyTo?: string } | undefined)?.replyTo ?? '',
      ).toLowerCase();
      if (replyTo) lista.push(replyTo);
      if (lista.some((end) => end && alvos.includes(end))) return e.id;
    }
    return null;
  }

  // ─── Parsing ─────────────────────────────────────────────────────────

  private primeiro(v: unknown): string {
    return String((Array.isArray(v) ? v[0] : v) ?? '').trim();
  }

  /** `Fulano <a@b.com>` → `a@b.com`. */
  private soEndereco(v: string): string | null {
    const m = /<([^>]+)>/.exec(v);
    const end = (m ? m[1] : v).trim().toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(end) ? end : null;
  }

  /** `Fulano <a@b.com>` → `Fulano`. */
  private soNome(v: string): string | undefined {
    const m = /^\s*"?([^"<]+?)"?\s*</.exec(v);
    return m ? m[1].trim() : undefined;
  }

  private semHtml(html: unknown): string {
    return String(html ?? '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .trim();
  }

  private cabecalhoId(raiz: Record<string, unknown>): string | undefined {
    const h = raiz.headers as Record<string, unknown> | undefined;
    const id = h?.['message-id'] ?? h?.['Message-ID'] ?? raiz['message-id'];
    return id ? String(id) : undefined;
  }

  /**
   * Corta a thread citada abaixo da resposta.
   *
   * Sem isso, cada resposta chega com o e-mail inteiro colado embaixo — e o que
   * o fluxo (ou a IA) lê é o texto que NÓS mandamos, não o que a pessoa
   * respondeu. Um "não tenho interesse" de duas palavras viraria uma parede
   * repetindo a própria oferta.
   */
  private cortarCitacao(texto: string): string {
    const marcas = [
      /^\s*Em .*escreveu:\s*$/im,
      /^\s*On .*wrote:\s*$/im,
      /^\s*-{2,}\s*Mensagem original\s*-{2,}\s*$/im,
      /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/im,
      /^\s*De:\s.*$/im,
      /^\s*From:\s.*$/im,
    ];
    let corte = texto.length;
    for (const m of marcas) {
      const achado = m.exec(texto);
      if (achado?.index !== undefined && achado.index < corte) corte = achado.index;
    }
    const limpo = texto
      .slice(0, corte)
      // Linhas citadas ("> ...") sobram quando não há cabeçalho de citação.
      .split('\n')
      .filter((l) => !/^\s*>/.test(l))
      .join('\n')
      .trim();
    return limpo || texto.trim();
  }
}
