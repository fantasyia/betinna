import { Injectable, Logger } from '@nestjs/common';
import { EnvService } from '@config/env.service';
import { PrismaService } from '@database/prisma.service';
import { CryptoUtil } from '@shared/utils/crypto.util';
import { SupressaoService } from '@shared/supressao/supressao.service';

/** O que viaja dentro do token (cifrado, nunca legível na URL). */
interface AlvoDescadastro {
  /** empresa */
  e: string;
  /** leadId */
  l?: string;
  /** clienteId */
  c?: string;
  /** e-mail, só pro log e pra mensagem da página */
  m?: string;
}

export interface ResultadoDescadastro {
  ok: boolean;
  jaEstava: boolean;
  email?: string;
  motivo?: string;
}

/**
 * Descadastro de e-mail — o "sair da lista" de um clique.
 *
 * Duas razões, e a segunda morde antes da primeira:
 *
 * 1. **LGPD.** Régua automática sem saída de um clique não se sustenta, ainda
 *    mais quando o consentimento é implícito (quem preencheu contato no
 *    checkout e saiu não pediu newsletter).
 * 2. **Reputação do domínio.** Provedor que não vê `List-Unsubscribe` trata o
 *    envio como bulk, e o domínio inteiro paga — inclusive a confirmação de
 *    pedido e o aviso de rastreio, que não têm nada a ver com marketing. Sem
 *    botão nativo, o caminho de quem se irrita é o de SPAM.
 *
 * **Não precisa de mecanismo novo de supressão**: o `SupressaoService` já gateia
 * todo outbound pela tag LGPD. O clique só aplica essa tag — daí o card ser
 * pequeno.
 *
 * ⛔ **Não alcança transacional.** Confirmação de pedido, rastreio, convite e
 * recuperação de senha passam pelo `TransactionalEmailService` sem
 * `descadastro`, então não ganham link nem cabeçalho. Quem sai da lista continua
 * sabendo onde está a encomenda que comprou.
 */
@Injectable()
export class DescadastroService {
  private readonly logger = new Logger(DescadastroService.name);
  private readonly crypto: CryptoUtil;

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
  ) {
    this.crypto = new CryptoUtil(env.get('ENCRYPTION_KEY'));
  }

  /**
   * Token opaco por destinatário.
   *
   * Cifrado (AES-256-GCM) em vez de assinado: assinatura protege contra
   * adulteração mas deixa o conteúdo legível, e id de lead numa URL que passa
   * por provedor de e-mail, proxy e histórico de navegador é vazamento de graça.
   * Base64url porque o token vive numa query string.
   */
  gerarToken(alvo: { empresaId: string; leadId?: string; clienteId?: string; email?: string }) {
    const payload: AlvoDescadastro = {
      e: alvo.empresaId,
      ...(alvo.leadId ? { l: alvo.leadId } : {}),
      ...(alvo.clienteId ? { c: alvo.clienteId } : {}),
      ...(alvo.email ? { m: alvo.email } : {}),
    };
    return this.crypto
      .encrypt(JSON.stringify(payload))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  lerToken(token: string): AlvoDescadastro | null {
    try {
      const b64 = token.replace(/-/g, '+').replace(/_/g, '/');
      const alvo = JSON.parse(this.crypto.decrypt(b64)) as AlvoDescadastro;
      return alvo?.e ? alvo : null;
    } catch {
      // Token adulterado/expirado por rotação de chave: a página diz "link
      // inválido" em vez de estourar 500 na cara de quem só quer sair da lista.
      return null;
    }
  }

  /** URL que vai no rodapé e no cabeçalho `List-Unsubscribe`. */
  urlDescadastro(token: string): string {
    const base = (this.env.get('API_PUBLIC_URL') || '').replace(/\/$/, '');
    // API_PUBLIC_URL já inclui /api/v1 (é a mesma que o Evolution usa pro webhook).
    return `${base}/descadastrar?t=${encodeURIComponent(token)}`;
  }

  /**
   * Aplica a tag de supressão. Idempotente: clicar duas vezes (ou o provedor
   * repetir o one-click) não gera erro nem duplica etiqueta.
   */
  async descadastrar(token: string): Promise<ResultadoDescadastro> {
    const alvo = this.lerToken(token);
    if (!alvo) return { ok: false, jaEstava: false, motivo: 'link inválido ou expirado' };

    const tag = await this.prisma.tag.upsert({
      where: { empresaId_nome: { empresaId: alvo.e, nome: SupressaoService.TAG_LGPD } },
      create: { empresaId: alvo.e, nome: SupressaoService.TAG_LGPD, categoria: 'alerta' },
      update: {},
    });

    let aplicou = 0;
    let jaTinha = false;
    if (alvo.l) {
      // Confere o vínculo com a empresa do token: id de outro tenant não etiqueta nada.
      const lead = await this.prisma.lead.findFirst({
        where: { id: alvo.l, empresaId: alvo.e },
        select: { id: true },
      });
      if (lead) {
        const r = await this.prisma.leadTag.createMany({
          data: [{ leadId: lead.id, tagId: tag.id, origem: 'descadastro' }],
          skipDuplicates: true,
        });
        aplicou += r.count;
        if (r.count === 0) jaTinha = true;
      }
    }
    if (alvo.c) {
      const cliente = await this.prisma.cliente.findFirst({
        where: { id: alvo.c, empresaId: alvo.e },
        select: { id: true },
      });
      if (cliente) {
        const r = await this.prisma.clienteTag.createMany({
          data: [{ clienteId: cliente.id, tagId: tag.id }],
          skipDuplicates: true,
        });
        aplicou += r.count;
        if (r.count === 0) jaTinha = true;
      }
    }

    if (aplicou === 0 && !jaTinha) {
      // Token válido mas o contato sumiu (apagado, ou trocou de empresa).
      this.logger.warn(`Descadastro: alvo do token não existe mais (empresa ${alvo.e})`);
      return { ok: false, jaEstava: false, email: alvo.m, motivo: 'contato não encontrado' };
    }
    this.logger.log(
      `Descadastro aplicado (empresa ${alvo.e}, ${alvo.m ?? 'sem e-mail no token'}) — ` +
        `${jaTinha && aplicou === 0 ? 'já estava fora da lista' : 'tag LGPD aplicada'}`,
    );
    return { ok: true, jaEstava: aplicou === 0, email: alvo.m };
  }
}
