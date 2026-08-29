import { useApiQuery } from '@/hooks/useApiQuery';

export interface EstoqueModo {
  /** Produto é montado DEPOIS do pedido — saldo zero é o estado normal. */
  sobEncomenda: boolean;
  /** Prazo de montagem prometido, em dias úteis (null = não configurado). */
  diasMontagem: number | null;
}

/**
 * Como esta empresa trata estoque (`Empresa.config.estoque`).
 *
 * A Somatec monta o Master Block DEPOIS do pedido — uma OP por pedido, montagem
 * no mesmo dia ou no seguinte. Nesse mundo, "0 em estoque" não é problema: é o
 * estado normal. A tela pintava isso de vermelho e alertava "sem estoque" em
 * todo produto, o que ensina o time a ignorar o alerta — e aí ele deixa de
 * servir pro caso em que realmente importa.
 *
 * Default `controlado` de propósito: quem vende de prateleira continua vendo
 * saldo baixo como aviso. A mudança é POR TENANT, não global.
 */
export function useEstoqueModo(): EstoqueModo {
  const { data } = useApiQuery<{
    estoque?: { modo?: string; diasMontagem?: number | null } | null;
  }>('/empresas/config');
  const cfg = data?.estoque ?? null;
  return {
    sobEncomenda: cfg?.modo === 'sob_encomenda',
    diasMontagem: typeof cfg?.diasMontagem === 'number' ? cfg.diasMontagem : null,
  };
}

/** "montagem em 1 dia útil" / "montagem sob demanda" — texto pronto pra tela. */
export function textoMontagem(dias: number | null): string {
  if (dias == null) return 'montado após o pedido';
  if (dias === 0) return 'montagem no mesmo dia';
  return `montagem em ${dias} dia${dias === 1 ? '' : 's'} útil${dias === 1 ? '' : 'eis'}`;
}
