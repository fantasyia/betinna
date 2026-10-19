import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EnvService } from '@config/env.service';
import { PrismaService } from '@database/prisma.service';
import { CronLockService } from '@shared/utils/cron-lock.service';
import { WhatsAppMediaService } from './whatsapp-media.service';

/**
 * Retenção das mídias do WhatsApp (Léo, 19/10: "apagar a cada 45 dias").
 *
 * O bucket `whatsapp-media` estourou a cota do Supabase (1,2 GB em 19/10) e
 * derrubou fotos da vitrine, anexos e contratos de TODAS as empresas. Por
 * empresa que LIGOU a regra (`config.whatsappMidia.retencaoDias` — a chave é
 * do Léo na tela, não deste código), toda madrugada apaga do Storage a mídia
 * de CONVERSA com mais de N dias e limpa o `mediaUrl` da mensagem (o texto
 * fica; `meta.midiaExpirada` marca o que sumiu).
 *
 * NUNCA apaga: mídia de fluxo (`<empresa>/fluxo/…`), documento da base de
 * conhecimento (`<empresa>/conhecimento/…`) nem arquivo que alguma mensagem
 * MAIS NOVA que o corte ainda use.
 */

/** Pastas que não são de conversa: ficam pra sempre. */
export const PASTAS_PROTEGIDAS = ['fluxo', 'conhecimento'] as const;
/** Mínimo de dias aceito (abaixo disso é mais provável engano do que regra). */
export const RETENCAO_MIN_DIAS = 15;
const LOTE = 200;
const TETO_POR_RODADA = 5000;

export function retencaoDias(config: unknown): number | null {
  const d = (
    ((config ?? {}) as Record<string, unknown>).whatsappMidia as
      | { retencaoDias?: unknown }
      | undefined
  )?.retencaoDias;
  return typeof d === 'number' && Number.isInteger(d) && d >= RETENCAO_MIN_DIAS ? d : null;
}

/** O caminho é de mídia de CONVERSA desta empresa (pode ir embora)? PURO. */
export function caminhoApagavel(path: string, empresaId: string): boolean {
  const partes = path.split('/');
  return (
    partes.length >= 3 &&
    partes[0] === empresaId &&
    !(PASTAS_PROTEGIDAS as readonly string[]).includes(partes[1])
  );
}

@Injectable()
export class WhatsappMidiaRetencaoJob {
  private readonly logger = new Logger(WhatsappMidiaRetencaoJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly media: WhatsAppMediaService,
    private readonly cronLock: CronLockService,
    private readonly env: EnvService,
  ) {}

  @Cron('0 40 3 * * *', { name: 'whatsapp-midia-retencao', timeZone: 'America/Sao_Paulo' })
  async rodar(): Promise<void> {
    if (this.env.get('NODE_ENV') === 'test') return;
    if (!(await this.cronLock.acquire('whatsapp-midia-retencao', 3000))) return;
    try {
      const empresas = await this.prisma.$queryRaw<Array<{ id: string; config: unknown }>>`
        SELECT id, config FROM "Empresa" WHERE config->'whatsappMidia'->>'retencaoDias' IS NOT NULL`;
      for (const e of empresas) {
        const dias = retencaoDias(e.config);
        if (dias) await this.limparEmpresa(e.id, dias);
      }
    } catch (err) {
      this.logger.warn(`[retenção] falhou: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      await this.cronLock.release('whatsapp-midia-retencao');
    }
  }

  /** Apaga a mídia de conversa com mais de `dias` desta empresa. Devolve quantos arquivos saíram. */
  async limparEmpresa(empresaId: string, dias: number, agora = new Date()): Promise<number> {
    const corte = new Date(agora.getTime() - dias * 86_400_000);
    // Parte do STORAGE: pega também o arquivo órfão (conversa zerada apagou a mensagem).
    const antigos = (
      await this.media.listarAntigos(empresaId, corte, PASTAS_PROTEGIDAS, TETO_POR_RODADA)
    ).filter((p) => caminhoApagavel(p, empresaId));
    let apagados = 0;
    for (let k = 0; k < antigos.length; k += LOTE) {
      const candidatos = antigos.slice(k, k + LOTE);
      // Ainda em uso por mensagem mais nova, por um fluxo ou pela base de conhecimento: fica.
      const emUso = await this.prisma.$queryRaw<Array<{ p: string }>>`
        SELECT DISTINCT m."mediaUrl" p FROM "Message" m
        WHERE m."mediaUrl" = ANY(${candidatos}) AND m."criadoEm" >= ${corte}
        UNION
        SELECT k."storagePath" p FROM "KnowledgeDocumento" k WHERE k."storagePath" = ANY(${candidatos})
        UNION
        SELECT x p FROM unnest(${candidatos}::text[]) x
        WHERE EXISTS (SELECT 1 FROM "FluxoNo" n WHERE n.config::text LIKE '%' || x || '%')`;
      const fica = new Set(emUso.map((r) => r.p));
      const sai = candidatos.filter((p) => !fica.has(p));
      if (sai.length === 0) continue;

      const ok = await this.media.removerVarios(sai);
      if (ok.length === 0) continue;
      // A mensagem (se ainda existe) fica com o texto e sem a mídia.
      await this.prisma.$executeRaw`
        UPDATE "Message"
        SET "mediaUrl" = NULL,
            meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('midiaExpirada', true, 'midiaApagadaEm', ${agora.toISOString()}::text)
        WHERE "mediaUrl" = ANY(${ok})`;
      apagados += ok.length;
    }
    if (apagados > 0) {
      this.logger.log(
        `[retenção] empresa ${empresaId}: ${apagados} mídia(s) com mais de ${dias} dias apagada(s)`,
      );
    }
    return apagados;
  }
}
