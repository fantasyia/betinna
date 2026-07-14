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
   * True se o contato deve ser SUPRIMIDO (tem a tag LGPD). Best-effort: em erro
   * de checagem, loga e retorna false (uma falha transitória não deve travar TODO
   * o envio outbound — a tag é aplicada de novo no próximo hard-stop se preciso).
   */
  async suprimido(
    empresaId: string,
    alvo: { leadId?: string | null; clienteId?: string | null; telefone?: string | null },
  ): Promise<boolean> {
    try {
      const tag = await this.prisma.tag.findFirst({
        where: { empresaId, nome: SupressaoService.TAG_LGPD },
        select: { id: true },
      });
      if (!tag) return false;

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
      this.logger.warn(`Falha ao checar supressão LGPD (segue sem bloquear): ${String(err)}`);
      return false;
    }
  }

  private sufixoTelefone(tel?: string | null): string | null {
    if (!tel) return null;
    const dig = tel.replace(/[^0-9]/g, '');
    return dig.length >= 8 ? dig.slice(-8) : null;
  }
}
