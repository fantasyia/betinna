/**
 * O destino de uma navegação só é seguro se for caminho INTERNO.
 *
 * `//host` e `/\\host` são os dois que enganam: parecem caminho porque começam
 * com barra, mas o navegador lê os dois como protocol-relative e SAI da origem.
 * É a classe do advisory de open redirect do react-router — e o `link` de
 * notificação vira `navigate(link)` no sino, então é ali que morde.
 *
 * O backend já recusa link fora do padrão (`notificacoes.dto.ts`), mas linhas
 * gravadas ANTES dessa trava não foram revalidadas. Por isso a checagem existe
 * também aqui, na hora de navegar: é a única que vê o dado antigo.
 */
export function ehRotaInterna(destino: string | null | undefined): boolean {
  if (!destino) return false;
  // Uma barra, e a próxima posição não pode ser outra barra nem contrabarra.
  return /^\/(?![/\\])/.test(destino.trim());
}
