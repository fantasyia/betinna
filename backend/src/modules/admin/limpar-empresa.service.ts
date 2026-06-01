import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { BusinessRuleException } from '@shared/errors/app-exception';

/**
 * LimparEmpresaService — "começar do zero" de UMA empresa.
 *
 * Apaga todo o dado operacional (clientes, produtos, pedidos, propostas,
 * conversas, leads, etc.) da empresa informada, mantendo a estrutura
 * (a própria empresa, usuários, integrações, persona, funis, fluxos…).
 *
 * Roda no SERVIDOR (no banco exato que o app usa) — sem risco de "banco errado".
 * Escopado por empresaId (bounded), ADMIN-only, exige frase de confirmação.
 * Best-effort por tabela; a ordem respeita as dependências (filhos via cascade).
 */
@Injectable()
export class LimparEmpresaService {
  private readonly logger = new Logger(LimparEmpresaService.name);
  static readonly FRASE = 'LIMPAR';

  constructor(private readonly prisma: PrismaService) {}

  async limpar(
    empresaId: string,
    confirmacao: string,
  ): Promise<{ apagados: Record<string, number>; total: number; clientesRestantes: number }> {
    if (confirmacao !== LimparEmpresaService.FRASE) {
      throw new BusinessRuleException(
        `Confirmação inválida. Digite exatamente: "${LimparEmpresaService.FRASE}".`,
      );
    }
    this.logger.warn(`[limpar-empresa] INICIANDO limpeza operacional da empresa ${empresaId}`);

    const p = this.prisma;
    const apagados: Record<string, number> = {};
    const safe = async (label: string, op: () => Promise<{ count: number }>): Promise<void> => {
      try {
        apagados[label] = (await op()).count;
      } catch (err) {
        this.logger.warn(`[limpar-empresa] falha em ${label}: ${err instanceof Error ? err.message : err}`);
        apagados[label] = apagados[label] ?? 0;
      }
    };

    // Ordem: tudo que referencia produto/cliente primeiro; produto e cliente por último.
    await safe('mensagens', () => p.message.deleteMany({ where: { conversation: { empresaId } } }));
    await safe('conversas', () => p.conversation.deleteMany({ where: { empresaId } }));
    await safe('incidentesMarketplace', () => p.marketplaceIncident.deleteMany({ where: { empresaId } }));
    await safe('ocorrenciaComentarios', () =>
      p.ocorrenciaComentario.deleteMany({ where: { ocorrencia: { empresaId } } }),
    );
    await safe('ocorrencias', () => p.ocorrencia.deleteMany({ where: { empresaId } }));
    await safe('campanhaDestinatarios', () =>
      p.campanhaDestinatario.deleteMany({ where: { campanha: { empresaId } } }),
    );
    await safe('campanhas', () => p.campanha.deleteMany({ where: { empresaId } }));
    await safe('propostaItens', () => p.propostaItem.deleteMany({ where: { proposta: { empresaId } } }));
    await safe('propostas', () => p.proposta.deleteMany({ where: { empresaId } }));
    // AprovacaoDesconto, PedidoCancelamentoSolicitacao e PedidoItem têm cascade
    // a partir de Pedido — deletar o pedido já os apaga.
    await safe('pedidos', () => p.pedido.deleteMany({ where: { empresaId } }));
    await safe('comissoes', () => p.comissao.deleteMany({ where: { empresaId } }));
    await safe('amostras', () => p.amostra.deleteMany({ where: { empresaId } }));
    await safe('leads', () => p.lead.deleteMany({ where: { empresaId } }));
    await safe('agenda', () => p.agendaItem.deleteMany({ where: { empresaId } }));
    await safe('fluxoExecucoes', () => p.fluxoExecucao.deleteMany({ where: { empresaId } }));
    await safe('respostasNps', () => p.respostaNPS.deleteMany({ where: { pesquisa: { empresaId } } }));
    // Cliente/Produto e dependentes diretos
    await safe('repCatalogoItens', () => p.repCatalogoItem.deleteMany({ where: { produto: { empresaId } } }));
    await safe('precosEspeciais', () => p.clientePrecoEspecial.deleteMany({ where: { cliente: { empresaId } } }));
    await safe('clienteTags', () => p.clienteTag.deleteMany({ where: { cliente: { empresaId } } }));
    await safe('notasPrivadas', () => p.notaPrivada.deleteMany({ where: { cliente: { empresaId } } }));
    await safe('documentos', () => p.documento.deleteMany({ where: { cliente: { empresaId } } }));
    await safe('produtos', () => p.produto.deleteMany({ where: { empresaId } }));
    await safe('clientes', () => p.cliente.deleteMany({ where: { empresaId } }));

    const total = Object.values(apagados).reduce((s, n) => s + n, 0);
    const clientesRestantes = await p.cliente.count({ where: { empresaId } });
    this.logger.warn(
      `[limpar-empresa] CONCLUÍDO empresa=${empresaId} — ${total} registros apagados, clientes restantes=${clientesRestantes}`,
    );
    return { apagados, total, clientesRestantes };
  }
}
