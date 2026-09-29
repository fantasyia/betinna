import type { Logger } from '@nestjs/common';
import type { PrismaService } from '@database/prisma.service';

/** Seção `Empresa.config.entradaAnuncios` (ver empresas.dto). */
interface EntradaAnuncios {
  ctwaEtapaId?: string | null;
  leadAdsEtapaId?: string | null;
  leadAdsPorFormulario?: Record<string, string> | null;
}

/**
 * Etapa de ENTRADA do lead que veio de anúncio (card 📣, itens 6 e 10, 29/09).
 *
 * - `ctwa`: conversa de Click-to-WhatsApp;
 * - `lead_ads`: formulário do Lead Ads — por formulário, se configurado, senão
 *   o padrão do Lead Ads.
 *
 * Devolve o id da etapa JÁ VALIDADO (existe e é desta empresa), ou `undefined`
 * = funil padrão. Etapa apagada/de outra empresa NÃO derruba o lead: cai no
 * padrão e avisa no log — perder o lead é pior que o lead cair no funil errado.
 */
export async function etapaDeEntradaAnuncio(
  prisma: PrismaService,
  logger: Pick<Logger, 'warn'>,
  empresaId: string,
  tipo: 'ctwa' | 'lead_ads',
  formId?: string,
): Promise<string | undefined> {
  const emp = await prisma.empresa.findUnique({
    where: { id: empresaId },
    select: { config: true },
  });
  const cfg = ((emp?.config as Record<string, unknown> | null)?.entradaAnuncios ??
    {}) as EntradaAnuncios;
  const escolhida =
    tipo === 'ctwa'
      ? cfg.ctwaEtapaId
      : ((formId ? cfg.leadAdsPorFormulario?.[formId] : undefined) ?? cfg.leadAdsEtapaId);
  if (!escolhida) return undefined;
  const etapa = await prisma.funilEtapa.findFirst({
    where: { id: escolhida, funil: { empresaId } },
    select: { id: true },
  });
  if (!etapa) {
    logger.warn(
      `Entrada de anúncio (${tipo}) aponta pra etapa ${escolhida}, que não existe na empresa ${empresaId} — usando o funil padrão`,
    );
    return undefined;
  }
  return etapa.id;
}
