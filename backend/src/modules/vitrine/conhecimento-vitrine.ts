/**
 * Ficha do produto pra base de conhecimento do robô (Léo, 24/10: "tudo isso está
 * cadastrado no app"). Gerada do cadastro da vitrine a cada gravação do modelo —
 * preço mudou, o robô já responde o novo. PURO.
 *
 * Mora como KnowledgeChunk fonte CONFIG, refId `vitrine:modelo:<id>`: o
 * reconciliador do RAG reindexa sozinho o que mudou.
 */

export const REF_MODELO = (id: string) => `vitrine:modelo:${id}`;

export interface ModeloParaFicha {
  nome: string;
  slug: string | null;
  descricao: string | null;
  composicao: string | null;
  cores: Array<{ cor: { nome: string } }>;
  linhas: Array<{
    linha: { nome: string };
    precoEntrada: unknown;
    precoVolume: unknown;
    precoAtacadao: unknown;
    precoSugerido: unknown;
    tabelaMedidas: unknown;
    tamanhos: Array<{ tamanho: { nome: string; ordem: number } }>;
  }>;
}

export interface FaixasDaVitrine {
  minimoEntrada: number | null;
  minimoVolume: number | null;
  minimoAtacadao: number | null;
}

const brl = (n: number) =>
  `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function fichaDoModelo(
  m: ModeloParaFicha,
  faixas: FaixasDaVitrine,
  dominio: string | null,
): { titulo: string; conteudo: string } {
  const partes: string[] = [`Produto: ${m.nome}.`];
  const d = dominio?.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  if (d && m.slug) partes.push(`Link do produto: https://${d}/p/${m.slug}`);
  if (m.descricao?.trim()) partes.push(m.descricao.trim());
  if (m.composicao?.trim()) partes.push(`Composição: ${m.composicao.trim()}.`);
  const cores = m.cores.map((c) => c.cor.nome).filter(Boolean);
  if (cores.length) partes.push(`Cores: ${cores.join(', ')}.`);

  for (const l of m.linhas) {
    const tam = [...l.tamanhos]
      .sort((a, b) => a.tamanho.ordem - b.tamanho.ordem)
      .map((t) => t.tamanho.nome);
    const bloco: string[] = [`Linha ${l.linha.nome}`];
    if (tam.length) bloco.push(`tamanhos ${tam.join(', ')}`);
    const precos: string[] = [];
    const ent = num(l.precoEntrada);
    const vol = num(l.precoVolume);
    const ata = num(l.precoAtacadao);
    const faixa = (min: number | null, rotulo: string) =>
      min ? `a partir de ${min} peças (${rotulo})` : rotulo;
    if (ent !== null) precos.push(`${brl(ent)} por peça ${faixa(faixas.minimoEntrada, 'Entrada')}`);
    if (vol !== null) precos.push(`${brl(vol)} ${faixa(faixas.minimoVolume, 'Volume')}`);
    if (ata !== null) precos.push(`${brl(ata)} ${faixa(faixas.minimoAtacadao, 'Atacadão')}`);
    if (precos.length) bloco.push(`preço no atacado: ${precos.join('; ')}`);
    else bloco.push('preço sob consulta');
    const rev = num(l.precoSugerido);
    if (rev !== null) {
      bloco.push(`preço sugerido de revenda ${brl(rev)}`);
      if (ent !== null && rev > ent) bloco.push(`lucro de ${brl(rev - ent)} por peça (na Entrada)`);
    }
    partes.push(`${bloco.join(', ')}.`);
    const med = medidas(l.tabelaMedidas);
    if (med) partes.push(`Medidas da linha ${l.linha.nome} (cm): ${med}`);
  }
  return { titulo: `Produto · ${m.nome}`, conteudo: partes.join('\n') };
}

/** Tabela de medidas → "P: busto 50, comprimento 70; M: …". */
function medidas(raw: unknown): string | null {
  const t = raw as { colunas?: string[]; linhas?: Array<{ tamanho: string; valores: string[] }> };
  if (!t?.colunas?.length || !t.linhas?.length) return null;
  const linhas = t.linhas
    .map((l) => {
      const v = t
        .colunas!.map((c, i) => (l.valores?.[i]?.trim() ? `${c} ${l.valores[i].trim()}` : ''))
        .filter(Boolean);
      return v.length ? `${l.tamanho}: ${v.join(', ')}` : '';
    })
    .filter(Boolean);
  return linhas.length ? `${linhas.join('; ')}.` : null;
}
