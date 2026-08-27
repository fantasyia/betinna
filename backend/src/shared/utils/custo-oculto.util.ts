import type { AuthenticatedUser } from '@shared/types/authenticated-user';

/**
 * REPRESENTANTE NÃO VÊ CUSTO. Regra explícita, pedida pelo Léo em 26/08.
 *
 * O custo (`precoFabrica`) é a margem da empresa. Um rep que enxerga o custo
 * sabe exatamente até onde a empresa aguenta descer — e a negociação deixa de
 * ser sobre o valor da solução pra virar sobre o quanto sobra pra fábrica.
 *
 * Por que uma função em vez de um `if` em cada tela: a mesma informação sai por
 * caminhos diferentes (catálogo do rep, lista de produtos, detalhe, busca). Com
 * `if` espalhado, basta UMA rota nova esquecer e o vazamento volta — e vazamento
 * de margem não dá erro em lugar nenhum, ninguém percebe. Ponto único é o que
 * torna a regra auditável: quem procurar "quem esconde custo" acha um lugar.
 *
 * ⚠️ Só o REP é cego pro custo. GERENTE, SAC, DIRECTOR e ADMIN veem — gerente
 * precisa avaliar desconto, e diretor precisa do número pra decidir preço.
 */
export function ocultaCusto(user: Pick<AuthenticatedUser, 'role'>): boolean {
  return user.role === 'REP';
}

/**
 * O que o REPRESENTANTE pode ver de dinheiro: só a MENSALIDADE DE LOCAÇÃO.
 *
 * O rep não vende, ele loca (regra do Léo, 26/08). Mostrar o preço de venda pra
 * ele é dar o número errado pra negociação — e o custo, pior ainda, entrega a
 * margem da empresa.
 *
 * Quando não há preço de locação definido, o campo fica `null` e a tela mostra
 * "—". **Não cai pro preço de venda como fallback**: o fallback silencioso é
 * exatamente o jeito de a regra falhar sem ninguém notar.
 */
export function precosParaRep<
  T extends { precoTabela?: unknown; precoFabrica?: unknown; precoLocacaoMensal?: unknown },
>(user: Pick<AuthenticatedUser, 'role'>, produto: T): T {
  if (!ocultaCusto(user)) return produto;
  return {
    ...produto,
    precoFabrica: null,
    // Zera o preço de VENDA: o rep enxerga locação e só.
    precoTabela: null,
    precoLocacaoMensal: produto.precoLocacaoMensal ?? null,
  };
}

/** Versão em lote de `precosParaRep`. */
export function precosParaRepLista<
  T extends { precoTabela?: unknown; precoFabrica?: unknown; precoLocacaoMensal?: unknown },
>(user: Pick<AuthenticatedUser, 'role'>, produtos: T[]): T[] {
  if (!ocultaCusto(user)) return produtos;
  return produtos.map((p) => precosParaRep(user, p));
}

/**
 * Devolve o produto sem o custo quando quem pede é REP.
 *
 * Zera o campo em vez de removê-lo: o front tipa `precoFabrica: number | null`,
 * e `null` já significa "não informado" na tela (mostra "—"). Remover a chave
 * quebraria o contrato e faria a UI renderizar `undefined`.
 */
export function semCustoParaRep<T extends { precoFabrica?: unknown }>(
  user: Pick<AuthenticatedUser, 'role'>,
  produto: T,
): T {
  if (!ocultaCusto(user)) return produto;
  return { ...produto, precoFabrica: null };
}

/** Versão em lote — listagens são o caminho por onde mais custo escapa. */
export function semCustoParaRepLista<T extends { precoFabrica?: unknown }>(
  user: Pick<AuthenticatedUser, 'role'>,
  produtos: T[],
): T[] {
  if (!ocultaCusto(user)) return produtos;
  return produtos.map((p) => ({ ...p, precoFabrica: null }));
}
