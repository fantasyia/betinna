import { useApiQuery } from '@/hooks/useApiQuery';

/**
 * Como a venda entra nesta empresa (`Empresa.config.vendas`).
 *
 * Na Somatec o representante NÃO abre pedido: ele monta uma proposta, ela sobe
 * pro ERP como orçamento, a gestão aprova lá e atribui a venda a ele — e o
 * pedido volta pro app pela sincronização.
 *
 * Esconder o botão é metade do trabalho (o backend recusa de qualquer jeito);
 * a outra metade é a tela dizer POR ONDE se vende, senão o rep fica procurando
 * um botão que sumiu.
 */
export function useRepCriaPedido(): boolean {
  const { data } = useApiQuery<{ vendas?: { repCriaPedido?: boolean } | null }>('/empresas/config');
  return data?.vendas?.repCriaPedido === true;
}
