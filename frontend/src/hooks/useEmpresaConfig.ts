import { useApiQuery } from './useApiQuery';

/**
 * Config da empresa ATIVA (header X-Empresa-Id resolvido no backend).
 * Hoje carrega os percentuais de desconto à vista (B1 — Lote 6) usados
 * pra calcular o preview de pedido/proposta no frontend.
 *
 * Fonte única de verdade continua sendo o backend (recalcula no save) —
 * isto é só pra mostrar o número estimado pro usuário antes de salvar.
 */
export interface EmpresaConfig {
  id: string;
  nome: string;
  descontoPixPct?: number | null;
  descontoBoletoAvistaPct?: number | null;
}

export function useEmpresaConfig() {
  return useApiQuery<EmpresaConfig>('/empresas/atual');
}

/**
 * Calcula o % de desconto à vista a aplicar (mesma regra do backend
 * PedidoPricingService.descontoAVistaPct):
 *  - PIX (qualquer condição) → descontoPixPct
 *  - BOLETO + condição 'avista' → descontoBoletoAvistaPct
 *  - resto → 0
 */
export function descontoAVistaPct(
  cfg: EmpresaConfig | null | undefined,
  formaPagamento: string | null | undefined,
  condicaoPagamento: string | null | undefined,
): number {
  if (!cfg) return 0;
  const forma = (formaPagamento ?? '').toUpperCase();
  const condicao = (condicaoPagamento ?? '').toLowerCase();
  if (forma === 'PIX') {
    return Math.min(50, Math.max(0, cfg.descontoPixPct ?? 0));
  }
  if (forma === 'BOLETO' && condicao === 'avista') {
    return Math.min(50, Math.max(0, cfg.descontoBoletoAvistaPct ?? 0));
  }
  return 0;
}
