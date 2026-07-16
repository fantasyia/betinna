import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';

/**
 * Supressão GLOBAL de contatos (LGPD). Quem tem a tag "Não Reabordar - LGPD ⛔"
 * (aplicada pelo hard-stop LGPD dos fluxos) NUNCA recebe envio outbound:
 * fluxo WhatsApp/Email, Conversar-com-IA e campanhas checam este ponto ÚNICO
 * antes de enviar. Casa por leadId, clienteId ou telefone (sufixo 8 dígitos, D18).
 *
 * (Ads são geridos fora do app — a exclusão de quem tem a tag em públicos de
 * anúncio é operacional, não passa por este guard de envio.)
 */
@Injectable()
export class SupressaoService {
  private readonly logger = new Logger(SupressaoService.name);

  /** Tag canônica de supressão. Mesma string aplicada pelo nó MUDAR_TAG do hard-stop LGPD. */
  static readonly TAG_LGPD = 'Não Reabordar - LGPD ⛔';

  constructor(private readonly prisma: PrismaService) {}

  /**
   * True se o contato deve ser SUPRIMIDO (tem a tag LGPD).
   *
   * FAIL-CLOSED: erro transitório na checagem PROPAGA (os 4 pontos gateados —
   * fluxo WhatsApp/Email, Conversar-IA, campanhas — rodam em job BullMQ com
   * retry). Enviar pra quem pediu remoção é violação legal; atrasar um envio
   * até a re-tentativa não é.
   */
  async suprimido(
    empresaId: string,
    alvo: { leadId?: string | null; clienteId?: string | null; telefone?: string | null },
  ): Promise<boolean> {
    try {
      const tag = await this.acharTagLgpd(empresaId);
      if (!tag) {
        // Tag ausente ≠ erro: é estado de configuração (nunca criada ou renomeada
        // além do reconhecível). WARN alto pra não virar supressão inerte silenciosa.
        this.logger.warn(
          `Tag de supressão LGPD não encontrada na empresa ${empresaId} — supressão INERTE (tag renomeada/apagada?)`,
        );
        return false;
      }

      if (alvo.leadId) {
        const n = await this.prisma.leadTag.count({
          where: { leadId: alvo.leadId, tagId: tag.id },
        });
        if (n > 0) return true;
      }
      if (alvo.clienteId) {
        const n = await this.prisma.clienteTag.count({
          where: { clienteId: alvo.clienteId, tagId: tag.id },
        });
        if (n > 0) return true;
      }

      const suf = this.sufixoTelefone(alvo.telefone);
      if (suf) {
        // Casa lead OU cliente pelo sufixo de 8 dígitos (D18) que tenha a tag LGPD.
        const rows = await this.prisma.$queryRaw<Array<{ n: bigint }>>`
          SELECT (
            (SELECT COUNT(*) FROM "LeadTag" lt JOIN "Lead" l ON l.id = lt."leadId"
              WHERE lt."tagId" = ${tag.id} AND l."empresaId" = ${empresaId}
                AND RIGHT(REGEXP_REPLACE(COALESCE(l."contatoTelefone",''),'[^0-9]','','g'), 8) = ${suf})
            +
            (SELECT COUNT(*) FROM "ClienteTag" ct JOIN "Cliente" c ON c.id = ct."clienteId"
              WHERE ct."tagId" = ${tag.id} AND c."empresaId" = ${empresaId}
                AND RIGHT(REGEXP_REPLACE(COALESCE(c.telefone,''),'[^0-9]','','g'), 8) = ${suf})
          ) AS n`;
        if ((rows[0]?.n ?? 0n) > 0n) return true;
      }

      return false;
    } catch (err) {
      // FAIL-CLOSED: não decide "pode enviar" sem conseguir checar — propaga e
      // deixa o retry do BullMQ resolver (antes: fail-open → suprimido RECEBIA).
      this.logger.error(
        `Falha ao checar supressão LGPD — bloqueando o envio até a re-tentativa: ${String(err)}`,
      );
      throw err;
    }
  }

  /**
   * Acha a tag de supressão por nome NORMALIZADO (sem acento/emoji/caixa/espaço
   * extra) — renomear "Não Reabordar - LGPD ⛔" pra "nao reabordar lgpd" continua
   * casando. Match exato por string quebrava silenciosamente a supressão.
   */
  private async acharTagLgpd(empresaId: string): Promise<{ id: string } | null> {
    const alvoNorm = this.normalizar(SupressaoService.TAG_LGPD);
    const candidatas = await this.prisma.tag.findMany({
      where: { empresaId, nome: { contains: 'reabordar', mode: 'insensitive' } },
      select: { id: true, nome: true },
    });
    return (
      candidatas.find((t) => this.normalizar(t.nome) === alvoNorm) ??
      candidatas.find((t) => this.normalizar(t.nome).includes('nao reabordar')) ??
      null
    );
  }

  /** minúsculas, sem acento, sem emoji/pontuação, espaços colapsados. */
  private normalizar(s: string): string {
    return s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9 ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  private sufixoTelefone(tel?: string | null): string | null {
    if (!tel) return null;
    const dig = tel.replace(/[^0-9]/g, '');
    return dig.length >= 8 ? dig.slice(-8) : null;
  }
}
