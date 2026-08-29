import { Injectable, Logger } from '@nestjs/common';
import { type SupabaseClient, createClient } from '@supabase/supabase-js';
import { EnvService } from '@config/env.service';
import { PrismaService } from '@database/prisma.service';

export interface MarcaTenant {
  nome: string;
  cnpj: string | null;
  /** Cor de títulos, cabeçalho de tabela e números. */
  primaria: string;
  /** Cor do fio e dos destaques finos. */
  secundaria: string;
  /** Logo já em bytes, pronto pro pdfkit. `null` = usa o nome em texto. */
  logo: Buffer | null;
  /** Uma linha no rodapé (site, telefone) — o que o cliente usa pra responder. */
  rodape: string | null;
}

const BUCKET = 'empresa-logos';
/** Padrão Betinna (BRANDBOOK.md) — vale pra quem não configurou marca própria. */
const PADRAO = { primaria: '#201554', secundaria: '#2bcae5' };
/** O logo muda uma vez por ano; baixar a cada PDF é desperdício e latência. */
const CACHE_MS = 10 * 60 * 1000;
/** pdfkit só embute PNG e JPEG — SVG entraria como lixo binário na página. */
const EXT_SUPORTADAS = /\.(png|jpe?g)$/i;

/**
 * A marca da empresa nos materiais que saem do app.
 *
 * Um PDF que sai com a cor e o logo de OUTRA marca não é detalhe estético: é o
 * material que o representante manda pro cliente dele. Por isso a marca é do
 * TENANT (logo do Supabase + cores em `Empresa.config.marca`), com o padrão
 * Betinna só como reserva de quem ainda não configurou.
 *
 * Falha aqui nunca derruba o documento: sem logo, o cabeçalho usa o nome da
 * empresa em texto — que é como era antes.
 */
@Injectable()
export class MarcaTenantService {
  private readonly logger = new Logger(MarcaTenantService.name);
  private readonly storage: SupabaseClient;
  private readonly cache = new Map<string, { em: number; marca: MarcaTenant }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
  ) {
    this.storage = createClient(
      this.env.get('SUPABASE_URL'),
      this.env.get('SUPABASE_SERVICE_ROLE_KEY'),
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
  }

  async resolver(empresaId: string): Promise<MarcaTenant> {
    const emCache = this.cache.get(empresaId);
    if (emCache && Date.now() - emCache.em < CACHE_MS) return emCache.marca;

    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { nome: true, cnpj: true, logoUrl: true, config: true },
    });
    const cfg = ((empresa?.config as Record<string, unknown> | null)?.marca ?? {}) as {
      corPrimaria?: string;
      corSecundaria?: string;
      rodape?: string;
    };

    const marca: MarcaTenant = {
      nome: empresa?.nome ?? '',
      cnpj: empresa?.cnpj ?? null,
      primaria: this.corValida(cfg.corPrimaria) ?? PADRAO.primaria,
      secundaria: this.corValida(cfg.corSecundaria) ?? PADRAO.secundaria,
      logo: await this.baixarLogo(empresa?.logoUrl ?? null),
      rodape: cfg.rodape?.trim() || null,
    };
    this.cache.set(empresaId, { em: Date.now(), marca });
    return marca;
  }

  /** Chame ao trocar logo ou cores — senão o PDF sai com a marca velha por 10min. */
  invalidar(empresaId: string): void {
    this.cache.delete(empresaId);
  }

  private async baixarLogo(caminho: string | null): Promise<Buffer | null> {
    if (!caminho || !EXT_SUPORTADAS.test(caminho)) return null;
    try {
      const { data, error } = await this.storage.storage.from(BUCKET).download(caminho);
      if (error || !data) return null;
      return Buffer.from(await data.arrayBuffer());
    } catch (err) {
      this.logger.warn(`logo ${caminho} não baixou: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  /** Só hex — cor inválida vinda da config pintaria o documento de preto. */
  private corValida(cor?: string): string | null {
    return cor && /^#[0-9a-fA-F]{6}$/.test(cor.trim()) ? cor.trim() : null;
  }
}
