import { z } from 'zod';

/**
 * Calculadora de precificação (Ribelt Distribuidora, 06/10/2026).
 * Só ADMIN/DIRECTOR, e só em empresa com `config.precificacao.ativa`.
 */

const pct = z.number().min(0).max(100).nullable().optional();
const dinheiro = z.number().nonnegative().max(1_000_000).nullable().optional();

/** Custos da EMPRESA — valem pra todo produto. */
export const taxasPrecificacaoSchema = z.object({
  impostoPct: pct,
  pixPct: pct,
  cartaoPct: pct,
  /** Anúncio gasto pra conseguir 1 pedido (R$). */
  anuncioPorPedido: dinheiro,
  /** Embalagem/manuseio por pedido (R$). */
  embalagemPorPedido: dinheiro,
});
export type TaxasPrecificacaoDto = z.infer<typeof taxasPrecificacaoSchema>;

/** "Salvar preços no modelo": o que estiver na tela da calculadora. */
export const precosLinhaSchema = z.object({
  custoPorPeca: dinheiro,
  precoEntrada: dinheiro,
  precoVolume: dinheiro,
  precoAtacadao: dinheiro,
  precoSugerido: dinheiro,
});
export type PrecosLinhaDto = z.infer<typeof precosLinhaSchema>;
