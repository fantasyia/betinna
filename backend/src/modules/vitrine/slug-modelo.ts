/**
 * Endereço próprio do produto na vitrine (card cmvkaagey, 23/10):
 * `atacado.ribelt.com.br/p/<slug>`. O slug nasce do nome na criação e NÃO
 * muda quando o nome muda — o link já está em anúncio e no Google. PURO.
 */

/** "Blusão Moletom Canguru com Capuz" → "blusao-moletom-canguru-com-capuz". */
export function slugDoNome(nome: string): string {
  return (
    nome
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80)
      .replace(/-+$/g, '') || 'produto'
  );
}

/** Slug livre na empresa: o do nome, ou com -2, -3… se já existir. */
export function slugLivre(nome: string, usados: Set<string>): string {
  const base = slugDoNome(nome);
  let s = base;
  for (let k = 2; usados.has(s); k++) s = `${base}-${k}`;
  return s;
}
