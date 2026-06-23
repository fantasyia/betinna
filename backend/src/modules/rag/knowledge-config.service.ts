import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { IndexacaoService } from './indexacao.service';

const brl = (n: number): string =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);

interface ChunkConfig {
  refId: string;
  categoria: string;
  titulo: string;
  conteudo: string | null; // null = feature desligada → chunk fica inativo
}

/**
 * Gera chunks de conhecimento (fonte=CONFIG) a partir da ConfiguracaoTenant — assim
 * o bot responde sobre regras da empresa (pedido mínimo, desconto à vista, comissão,
 * devolução) sem ninguém recadastrar à mão. Idempotente: re-upsert por (empresa,
 * CONFIG, refId); feature desligada → chunk inativo (some da busca). Chamado pelo
 * EmpresasService a cada PATCH de config.
 */
@Injectable()
export class KnowledgeConfigService {
  private readonly logger = new Logger(KnowledgeConfigService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly indexacao: IndexacaoService,
  ) {}

  async sincronizar(empresaId: string): Promise<void> {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { config: true, descontoPixPct: true, descontoBoletoAvistaPct: true },
    });
    if (!empresa) return;
    const cfg = (empresa.config as Record<string, unknown> | null) ?? {};

    const chunks: ChunkConfig[] = [
      this.descontoAvista(empresa.descontoPixPct, empresa.descontoBoletoAvistaPct),
      this.pedidoMinimo(cfg.pedidoMinimo),
      this.devolucao(cfg.devolucaoInterna),
    ];

    for (const c of chunks) {
      const ativo = c.conteudo !== null;
      const upserted = await this.prisma.knowledgeChunk.upsert({
        where: { empresaId_fonte_refId: { empresaId, fonte: 'CONFIG', refId: c.refId } },
        create: {
          empresaId,
          fonte: 'CONFIG',
          refId: c.refId,
          categoria: c.categoria,
          titulo: c.titulo,
          conteudo: c.conteudo ?? '(desativado)',
          ativo,
        },
        update: { titulo: c.titulo, conteudo: c.conteudo ?? '(desativado)', ativo },
      });
      // Só indexa o que está ativo (não gasta embedding em chunk desligado).
      if (ativo) await this.indexacao.enfileirarChunk(upserted.id, empresaId);
    }
  }

  private descontoAvista(pix?: number | null, boleto?: number | null): ChunkConfig {
    const p = pix ?? 0;
    const b = boleto ?? 0;
    if (p <= 0 && b <= 0) {
      return {
        refId: 'descontoAvista',
        categoria: 'comercial',
        titulo: 'Desconto à vista',
        conteudo: null,
      };
    }
    const partes: string[] = [];
    if (p > 0) partes.push(`pagamento via PIX: ${p}% de desconto`);
    if (b > 0) partes.push(`boleto à vista: ${b}% de desconto`);
    return {
      refId: 'descontoAvista',
      categoria: 'comercial',
      titulo: 'Desconto à vista',
      conteudo: `A empresa oferece desconto para pagamento à vista — ${partes.join('; ')}.`,
    };
  }

  private pedidoMinimo(raw: unknown): ChunkConfig {
    const base = { refId: 'pedidoMinimo', categoria: 'comercial', titulo: 'Pedido mínimo' };
    const m = (raw ?? {}) as {
      tipo?: string;
      valorMin?: number;
      pesoMin?: number;
      quantidadeMin?: number;
      modo?: string;
    };
    if (!m.tipo || m.tipo === 'sem_minimo') return { ...base, conteudo: null };
    const limites: string[] = [];
    if (m.valorMin) limites.push(`valor mínimo de ${brl(m.valorMin)}`);
    if (m.pesoMin) limites.push(`peso mínimo de ${m.pesoMin} kg`);
    if (m.quantidadeMin) limites.push(`quantidade mínima de ${m.quantidadeMin} unidades`);
    if (limites.length === 0) return { ...base, conteudo: null };
    const conector =
      m.tipo === 'combinada' ? ` (regra: ${m.modo === 'OU' ? 'qualquer um' : 'todos'})` : '';
    return { ...base, conteudo: `Há pedido mínimo: ${limites.join('; ')}${conector}.` };
  }

  private devolucao(raw: unknown): ChunkConfig {
    const base = {
      refId: 'devolucaoInterna',
      categoria: 'pos_venda',
      titulo: 'Política de devolução',
    };
    const d = (raw ?? {}) as {
      slaAnaliseDiasUteis?: number;
      janelaPosEntregaDias?: number;
      motivos?: Array<{ label?: string }>;
    };
    const partes: string[] = [];
    if (d.janelaPosEntregaDias)
      partes.push(`prazo de ${d.janelaPosEntregaDias} dias após a entrega para solicitar`);
    if (d.slaAnaliseDiasUteis) partes.push(`análise em até ${d.slaAnaliseDiasUteis} dias úteis`);
    const motivos = (d.motivos ?? []).map((x) => x.label).filter(Boolean);
    if (motivos.length > 0) partes.push(`motivos aceitos: ${motivos.join(', ')}`);
    if (partes.length === 0) return { ...base, conteudo: null };
    return { ...base, conteudo: `Política de devolução: ${partes.join('; ')}.` };
  }
}
