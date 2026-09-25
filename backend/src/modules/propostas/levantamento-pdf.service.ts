import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { MarcaTenantService } from '@modules/empresas/marca-tenant.service';
import { desenharLevantamento } from './levantamento-pdf.util';
import type { ResumoProposta } from './proposta-resumo.util';

const HEX = /^#[0-9a-fA-F]{6}$/;
const cor = (v?: string) => (v && HEX.test(v.trim()) ? v.trim() : null);

/**
 * Gera o PDF do "Levantamento técnico de projeto" com a marca do tenant (Léo,
 * 25/09: o app gera, o rep não anexa mais nada). O desenho mora em
 * `levantamento-pdf.util`; aqui só se resolve a marca.
 */
@Injectable()
export class LevantamentoPdfService {
  private readonly logger = new Logger(LevantamentoPdfService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly marca: MarcaTenantService,
  ) {}

  async gerar(empresaId: string, resumo: ResumoProposta): Promise<Buffer> {
    const m = await this.marca.resolver(empresaId);
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { config: true },
    });
    const cfg = (empresa?.config ?? {}) as {
      marca?: { corAcao?: string; logoEmailUrl?: string };
      branding?: { logoNegativoUrl?: string; cores?: { acao?: string } };
    };
    return desenharLevantamento(resumo, {
      nome: m.nome,
      primaria: m.primaria,
      secundaria: m.secundaria,
      acao: cor(cfg.marca?.corAcao) ?? cor(cfg.branding?.cores?.acao) ?? m.secundaria,
      // A logo NEGATIVA (branca) é a do e-mail: o cabeçalho do documento é o
      // mesmo fundo escuro. Sem ela, o cabeçalho fica claro com a logo normal.
      logoNegativo: await this.baixarImagem(
        cfg.marca?.logoEmailUrl ?? cfg.branding?.logoNegativoUrl,
      ),
      logo: m.logo,
      rodape: m.rodape,
    });
  }

  /** pdfkit só embute PNG/JPEG. Falhou = cabeçalho claro, o documento sai igual. */
  private async baixarImagem(url?: string): Promise<Buffer | null> {
    const u = url?.trim();
    if (!u || !/^https:\/\//i.test(u) || !/\.(png|jpe?g)(\?.*)?$/i.test(u)) return null;
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) return null;
      const b = Buffer.from(await r.arrayBuffer());
      return b.length ? b : null;
    } catch (err) {
      this.logger.warn(
        `logo negativa ${u} não baixou: ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }
  }
}
