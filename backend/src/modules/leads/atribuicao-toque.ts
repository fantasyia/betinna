import type { PrismaService } from '@database/prisma.service';

/** Bloco de atribuição (utm*) — o mesmo formato de `variaveis.atribuicao.{primeiro,ultimo}`. */
export type BlocoAtribuicao = Record<string, string>;

/**
 * Registra um TOQUE de marketing num lead que já existe (item 11 do card 📣,
 * 29/09): quem já é lead e clica num anúncio novo não pode perder o toque.
 *
 * Regra (a mesma do formulário do site):
 *  - ÚLTIMO toque = este, sempre;
 *  - 1º toque fica INTACTO — só nasce aqui se o lead não tinha nenhum (nem
 *    colunas utm*, nem `atribuicao.primeiro`).
 *
 * Tudo num UPDATE com merge jsonb: nada de ler-modificar-gravar o `variaveis`,
 * que apagaria resposta de fluxo gravada no meio (regra da casa).
 */
export async function registrarToqueNoLead(
  prisma: PrismaService,
  empresaId: string,
  leadId: string,
  bloco: BlocoAtribuicao,
): Promise<number> {
  const json = JSON.stringify(bloco);
  return prisma.$executeRaw`
    UPDATE "Lead" SET
      variaveis = jsonb_set(
        COALESCE(variaveis, '{}'::jsonb),
        '{atribuicao}',
        COALESCE(variaveis->'atribuicao', '{}'::jsonb)
          || jsonb_build_object('ultimo', ${json}::jsonb)
          || CASE
               WHEN variaveis->'atribuicao'->'primeiro' IS NULL
                AND "utmSource" IS NULL AND "utmMedium" IS NULL AND "utmCampaign" IS NULL
               THEN jsonb_build_object('primeiro', ${json}::jsonb)
               ELSE '{}'::jsonb
             END
      ),
      "utmSource" = CASE WHEN "utmSource" IS NULL AND "utmMedium" IS NULL AND "utmCampaign" IS NULL
                         THEN ${bloco.utmSource ?? null} ELSE "utmSource" END,
      "utmMedium" = CASE WHEN "utmSource" IS NULL AND "utmMedium" IS NULL AND "utmCampaign" IS NULL
                         THEN ${bloco.utmMedium ?? null} ELSE "utmMedium" END,
      "utmCampaign" = CASE WHEN "utmSource" IS NULL AND "utmMedium" IS NULL AND "utmCampaign" IS NULL
                           THEN ${bloco.utmCampaign ?? null} ELSE "utmCampaign" END
    WHERE id = ${leadId} AND "empresaId" = ${empresaId}
  `;
}
