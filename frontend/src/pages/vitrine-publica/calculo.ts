/**
 * Vitrine pública — regras de preço, faixa, lucro e carrinho. PURO (testado):
 * é daqui que sai o número que o cliente vê e que vai no pedido.
 */

export interface TamanhoPub {
  id: string; // id do tamanho NO MODELO (modeloTamanho)
  nome: string;
}
export interface TabelaMedidasPub {
  colunas: string[];
  linhas: Array<{ tamanho: string; valores: string[] }>;
}
export interface LinhaPub {
  id: string; // linha NO MODELO
  linhaId: string; // linha da empresa (filtro do topo)
  nome: string;
  tamanhos: TamanhoPub[];
  precoEntrada: number | null;
  precoVolume: number | null;
  precoAtacadao: number | null;
  precoSugerido: number | null;
  tabelaMedidas: TabelaMedidasPub | null;
}
export interface CorPub {
  id: string; // cor NO MODELO
  nome: string;
  hex: string;
  fotos: Array<{ url: string; thumbUrl: string | null; largura: number | null; altura: number | null }>;
}
export interface ModeloPub {
  id: string;
  nome: string;
  categoria: { id: string; nome: string } | null;
  descricao: string | null;
  etiquetas: string[];
  tituloMarketplace: string | null;
  descricaoMarketplace: string | null;
  composicao: string | null;
  cores: CorPub[];
  linhas: LinhaPub[];
  videos: Array<{ url: string; nomeArquivo: string | null; tamanhoBytes: number | null }>;
}
export interface Faixas {
  minimoEntrada: number | null;
  minimoVolume: number | null;
  minimoAtacadao: number | null;
}
export interface VitrinePub {
  empresa: { nome: string; logoUrl: string | null };
  faixas: Faixas;
  linhas: Array<{ id: string; nome: string }>;
  modelos: ModeloPub[];
}

export type Faixa = 'entrada' | 'volume' | 'atacadao';

/** Carrinho: modelo → cor (do modelo) → tamanho (do modelo) → quantidade. */
export type Carrinho = Record<string, Record<string, Record<string, number>>>;

/** Faixa pelo TOTAL de peças do pedido (não por modelo). */
export function faixaDoTotal(total: number, f: Faixas): Faixa {
  if (f.minimoAtacadao && total >= f.minimoAtacadao) return 'atacadao';
  if (f.minimoVolume && total >= f.minimoVolume) return 'volume';
  return 'entrada';
}

/**
 * Preço por peça da linha na faixa. Faixa melhor SEM preço cadastrado usa a
 * de baixo (quem compra mais nunca paga mais caro por um campo vazio).
 * null = "sob consulta".
 */
export function precoNaFaixa(l: LinhaPub, faixa: Faixa): number | null {
  const ordem: Faixa[] =
    faixa === 'atacadao' ? ['atacadao', 'volume', 'entrada'] : faixa === 'volume' ? ['volume', 'entrada'] : ['entrada'];
  for (const fx of ordem) {
    const v = fx === 'atacadao' ? l.precoAtacadao : fx === 'volume' ? l.precoVolume : l.precoEntrada;
    if (v !== null && v !== undefined) return v;
  }
  return null;
}

/** Lucro por peça e % sobre o custo. null quando falta preço ou sugerido. */
export function lucroPorPeca(atacado: number | null, sugerido: number | null) {
  if (atacado === null || sugerido === null || atacado <= 0) return null;
  const lucro = Math.round((sugerido - atacado) * 100) / 100;
  return { lucro, pct: Math.round((lucro / atacado) * 100) };
}

export function pecasDoModelo(c: Carrinho, modeloId: string, linha?: LinhaPub): number {
  const porCor = c[modeloId] ?? {};
  const ids = linha ? new Set(linha.tamanhos.map((t) => t.id)) : null;
  let n = 0;
  for (const cor of Object.values(porCor)) {
    for (const [tam, q] of Object.entries(cor)) if (!ids || ids.has(tam)) n += q;
  }
  return n;
}

export function totalPecas(c: Carrinho): number {
  return Object.keys(c).reduce((s, id) => s + pecasDoModelo(c, id), 0);
}

/** Soma `delta` numa célula (nunca abaixo de zero) e limpa o que zerou. */
export function somar(c: Carrinho, modeloId: string, corId: string, tamanhoId: string, delta: number): Carrinho {
  const atual = c[modeloId]?.[corId]?.[tamanhoId] ?? 0;
  const novo = Math.max(0, Math.min(99_999, atual + delta));
  const porCor = { ...(c[modeloId] ?? {}) };
  const tams = { ...(porCor[corId] ?? {}) };
  if (novo === 0) delete tams[tamanhoId];
  else tams[tamanhoId] = novo;
  if (Object.keys(tams).length) porCor[corId] = tams;
  else delete porCor[corId];
  const out = { ...c };
  if (Object.keys(porCor).length) out[modeloId] = porCor;
  else delete out[modeloId];
  return out;
}

/** Descarta do carrinho salvo o que não existe mais na vitrine. */
export function limparCarrinho(c: Carrinho, v: VitrinePub): Carrinho {
  let out: Carrinho = {};
  for (const m of v.modelos) {
    const cores = new Set(m.cores.map((x) => x.id));
    const tams = new Set(m.linhas.flatMap((l) => l.tamanhos.map((t) => t.id)));
    for (const [corId, porTam] of Object.entries(c[m.id] ?? {})) {
      if (!cores.has(corId)) continue;
      for (const [tamId, q] of Object.entries(porTam)) {
        if (tams.has(tamId) && Number.isInteger(q) && q > 0) out = somar(out, m.id, corId, tamId, q);
      }
    }
  }
  return out;
}

/** Totais do pedido na faixa atingida. `aConfirmar` = há item sem preço. */
export function resumoPedido(c: Carrinho, v: VitrinePub) {
  const pecas = totalPecas(c);
  const faixa = faixaDoTotal(pecas, v.faixas);
  let investe = 0;
  let revende = 0;
  let aConfirmar = false;
  let semSugerido = false;
  for (const m of v.modelos) {
    for (const l of m.linhas) {
      const n = pecasDoModelo(c, m.id, l);
      if (!n) continue;
      const p = precoNaFaixa(l, faixa);
      if (p === null) aConfirmar = true;
      else investe += n * p;
      if (l.precoSugerido === null) semSugerido = true;
      else revende += n * l.precoSugerido;
    }
  }
  const r = (x: number) => Math.round(x * 100) / 100;
  return {
    pecas,
    faixa,
    investe: r(investe),
    revende: r(revende),
    lucro: aConfirmar || semSugerido ? null : r(revende - investe),
    aConfirmar,
    /** Abaixo do pedido mínimo (faixa Entrada). */
    faltamMinimo: v.faixas.minimoEntrada ? Math.max(0, v.faixas.minimoEntrada - pecas) : 0,
  };
}

/** Próxima faixa e quantas peças faltam pra ela. */
export function proximaFaixa(pecas: number, f: Faixas): { faixa: Faixa; faltam: number } | null {
  if (f.minimoVolume && pecas < f.minimoVolume) return { faixa: 'volume', faltam: f.minimoVolume - pecas };
  if (f.minimoAtacadao && pecas < f.minimoAtacadao) return { faixa: 'atacadao', faltam: f.minimoAtacadao - pecas };
  return null;
}

export const NOME_FAIXA: Record<Faixa, string> = { entrada: 'Entrada', volume: 'Volume', atacadao: '500+' };

/** Texto do "kit pra anunciar" — o que o revendedor cola no marketplace. */
export function textoKit(m: ModeloPub): string {
  const partes: string[] = [];
  partes.push(`TÍTULO SUGERIDO\n${m.tituloMarketplace?.trim() || m.nome}`);
  partes.push(`DESCRIÇÃO\n${m.descricaoMarketplace?.trim() || m.descricao?.trim() || m.nome}`);
  const ficha: string[] = [];
  if (m.etiquetas.length) ficha.push(m.etiquetas.join(' · '));
  if (m.composicao?.trim()) ficha.push(`Composição: ${m.composicao.trim()}`);
  if (ficha.length) partes.push(`FICHA TÉCNICA\n${ficha.join('\n')}`);
  partes.push(`TAMANHOS\n${m.linhas.map((l) => `${l.nome}: ${l.tamanhos.map((t) => t.nome).join(', ')}`).join('\n')}`);
  const medidas = m.linhas
    .filter((l) => l.tabelaMedidas && l.tabelaMedidas.linhas.length)
    .map((l) => {
      const t = l.tabelaMedidas as TabelaMedidasPub;
      const linhas = t.linhas.map((r) => `${r.tamanho}: ${t.colunas.map((c, i) => `${c} ${r.valores[i] || '-'}`).join(' · ')}`);
      return `${l.nome} (cm)\n${linhas.join('\n')}`;
    });
  if (medidas.length) partes.push(`TABELA DE MEDIDAS\n${medidas.join('\n\n')}`);
  partes.push(`CORES\n${m.cores.map((c) => c.nome).join(', ')}`);
  return partes.join('\n\n');
}

/** Nome de arquivo/pasta seguro (zip abre igual em Windows, Mac e celular). */
export function nomeArquivo(s: string): string {
  return (
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9 _-]+/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 60) || 'arquivo'
  );
}
