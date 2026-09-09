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

  /**
   * Endereço de e-mail MORTO (hard bounce) ou que reclamou de spam.
   *
   * Tag SEPARADA da LGPD de propósito, e a diferença não é burocracia: a LGPD
   * cala TODO outbound — WhatsApp, IA, campanha. Caixa de e-mail inexistente não
   * diz nada sobre o telefone da pessoa; misturar as duas silenciaria o canal
   * que ainda funciona por causa do que quebrou no outro.
   */
  static readonly TAG_EMAIL_INVALIDO = 'E-mail inválido ⛔';

  /**
   * Número que NÃO EXISTE no WhatsApp (o provedor respondeu `exists:false`).
   *
   * É uma OBSERVAÇÃO, não um pedido — e a diferença decide o que ela faz. A tag
   * de LGPD cala todo outbound porque a pessoa PEDIU. Esta aqui só diz o que o
   * provedor respondeu num instante, e isso muda: quem não tinha WhatsApp
   * instala, quem trocou de chip volta. Por isso ela marca e mostra, e não
   * bloqueia: quem decide tirar do canal é gente, olhando.
   */
  static readonly TAG_WHATSAPP_INVALIDO = 'WhatsApp inválido ⛔';

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
   * O e-mail deste contato está queimado? (hard bounce ou reclamação)
   *
   * Vale SÓ pro canal e-mail — o telefone segue liberado. FAIL-OPEN ao
   * contrário da LGPD: aqui o custo de errar é mandar pra uma caixa morta (o
   * provedor já ignora), não violar pedido de remoção. Travar o envio inteiro
   * por causa de uma checagem instável seria pior.
   */
  async emailSuprimido(empresaId: string, email?: string | null): Promise<boolean> {
    const alvo = (email ?? '').trim().toLowerCase();
    if (!alvo) return false;
    try {
      const tag = await this.acharTag(empresaId, SupressaoService.TAG_EMAIL_INVALIDO, 'invalido');
      if (!tag) return false;
      const n = await this.prisma.leadTag.count({
        where: {
          tagId: tag.id,
          lead: { empresaId, contatoEmail: { equals: alvo, mode: 'insensitive' } },
        },
      });
      return n > 0;
    } catch (err) {
      this.logger.warn(`Falha ao checar e-mail suprimido (${alvo}): ${String(err)}`);
      return false;
    }
  }

  /**
   * Marca o endereço como queimado em TODOS os leads que o usam neste tenant.
   *
   * Por endereço, e não por lead: o mesmo e-mail costuma estar em duas fichas
   * (importação + formulário), e suprimir só a que recebeu o bounce deixa a
   * outra continuar mirando a mesma caixa morta.
   */
  async marcarEmailInvalido(
    empresaId: string,
    email: string,
    motivo: 'bounce' | 'reclamacao',
  ): Promise<number> {
    const alvo = email.trim().toLowerCase();
    if (!alvo) return 0;
    const tag = await this.prisma.tag.upsert({
      where: {
        empresaId_nome: { empresaId, nome: SupressaoService.TAG_EMAIL_INVALIDO },
      },
      create: { empresaId, nome: SupressaoService.TAG_EMAIL_INVALIDO, categoria: 'alerta' },
      update: {},
    });
    const leads = await this.prisma.lead.findMany({
      where: { empresaId, contatoEmail: { equals: alvo, mode: 'insensitive' } },
      select: { id: true, variaveis: true },
    });
    if (leads.length === 0) return 0;

    await this.prisma.leadTag.createMany({
      data: leads.map((l) => ({ leadId: l.id, tagId: tag.id, origem: `email:${motivo}` })),
      skipDuplicates: true,
    });
    // Rastro no lead: a tag diz "não mande"; o carimbo diz o que aconteceu e
    // quando — é o que permite auditar depois sem cruzar log de provedor.
    for (const l of leads) {
      const base = (l.variaveis as Record<string, unknown> | null) ?? {};
      await this.prisma.lead
        .update({
          where: { id: l.id },
          data: {
            variaveis: {
              ...base,
              emailInvalidoEm: new Date().toISOString(),
              emailInvalidoMotivo: motivo,
            },
          },
        })
        .catch(() => undefined);
    }
    this.logger.warn(
      `E-mail ${alvo} marcado como inválido (${motivo}) em ${leads.length} lead(s) da empresa ${empresaId}`,
    );
    return leads.length;
  }

  /**
   * Marca o telefone como sem WhatsApp, no lead E no cliente.
   *
   * Casa por SUFIXO de 8 dígitos (D18) porque é assim que telefone bate neste
   * sistema: o mesmo número aparece com e sem +55, com e sem o 9. `contains`
   * casaria número de OUTRA pessoa.
   *
   * Best-effort de propósito — quem chama está no meio de tratar uma falha de
   * envio, e falhar aqui não pode piorar o erro que já está sendo tratado.
   */
  async marcarWhatsappInvalido(empresaId: string, telefone: string): Promise<number> {
    const suf = this.sufixoTelefone(telefone);
    if (!suf) return 0;
    const tag = await this.prisma.tag.upsert({
      where: { empresaId_nome: { empresaId, nome: SupressaoService.TAG_WHATSAPP_INVALIDO } },
      create: { empresaId, nome: SupressaoService.TAG_WHATSAPP_INVALIDO, categoria: 'alerta' },
      update: {},
    });

    const leads = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "Lead"
       WHERE "empresaId" = ${empresaId}
         AND RIGHT(REGEXP_REPLACE(COALESCE("contatoTelefone",''),'[^0-9]','','g'), 8) = ${suf}`;
    const clientes = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "Cliente"
       WHERE "empresaId" = ${empresaId}
         AND RIGHT(REGEXP_REPLACE(COALESCE(telefone,''),'[^0-9]','','g'), 8) = ${suf}`;

    if (leads.length) {
      await this.prisma.leadTag.createMany({
        data: leads.map((l) => ({ leadId: l.id, tagId: tag.id, origem: 'whatsapp:inexistente' })),
        skipDuplicates: true,
      });
    }
    if (clientes.length) {
      await this.prisma.clienteTag.createMany({
        data: clientes.map((c) => ({
          clienteId: c.id,
          tagId: tag.id,
          origem: 'whatsapp:inexistente',
        })),
        skipDuplicates: true,
      });
    }

    const total = leads.length + clientes.length;
    if (total > 0) {
      this.logger.warn(
        `Telefone ...${suf} marcado como SEM WhatsApp em ${leads.length} lead(s) e ` +
          `${clientes.length} cliente(s) da empresa ${empresaId}`,
      );
    }
    return total;
  }

  /** Busca genérica por nome normalizado — a de LGPD é um caso dela. */
  private async acharTag(
    empresaId: string,
    nomeCanonico: string,
    fragmento: string,
  ): Promise<{ id: string } | null> {
    const alvoNorm = this.normalizar(nomeCanonico);
    const candidatas = await this.prisma.tag.findMany({
      where: { empresaId, nome: { contains: fragmento, mode: 'insensitive' } },
      select: { id: true, nome: true },
    });
    return candidatas.find((t) => this.normalizar(t.nome) === alvoNorm) ?? candidatas[0] ?? null;
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
