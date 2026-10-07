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
  fotos: Array<{
    url: string;
    thumbUrl: string | null;
    largura: number | null;
    altura: number | null;
    /** Linha (biotipo) da foto; null/ausente = foto geral da cor. */
    linhaId?: string | null;
  }>;
  /** Ponto da capa escolhido no cadastro pra bolinha (null = automático). */
  amostra?: { x: number; y: number } | null;
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
  /** cor → tamanho → disponível. null/ausente = a vitrine não controla estoque. */
  estoque?: Record<string, Record<string, number>> | null;
}
export interface Faixas {
  minimoEntrada: number | null;
  minimoVolume: number | null;
  minimoAtacadao: number | null;
}
/** Pedido mínimo da empresa (Configurações → Pedido mínimo). */
export interface MinimoPub {
  valorMin: number | null;
  quantidadeMin: number | null;
  modo: 'E' | 'OU';
}
export interface VitrinePub {
  empresa: { nome: string; logoUrl: string | null };
  faixas: Faixas;
  pedidoMinimo?: MinimoPub | null;
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
    faixa === 'atacadao'
      ? ['atacadao', 'volume', 'entrada']
      : faixa === 'volume'
        ? ['volume', 'entrada']
        : ['entrada'];
  for (const fx of ordem) {
    const v =
      fx === 'atacadao' ? l.precoAtacadao : fx === 'volume' ? l.precoVolume : l.precoEntrada;
    if (v !== null && v !== undefined) return v;
  }
  return null;
}

/**
 * Fotos da cor pra linha escolhida (Regular / Plus Size / Infantil mostram o
 * biotipo certo): as DA LINHA; sem elas, as gerais; sem gerais, todas.
 */
export function fotosDaLinha(cor: CorPub, linhaId: string | null | undefined): CorPub['fotos'] {
  const daLinha = linhaId ? cor.fotos.filter((f) => f.linhaId === linhaId) : [];
  if (daLinha.length) return daLinha;
  const gerais = cor.fotos.filter((f) => !f.linhaId);
  return gerais.length ? gerais : cor.fotos;
}

/**
 * A cor como a BOLINHA vê: só as fotos gerais (o ponto escolhido no cadastro
 * é da capa geral). Sem foto geral, a 1ª foto que houver — e sem o ponto.
 */
export function corDaBolinha(cor: CorPub): CorPub {
  const gerais = cor.fotos.filter((f) => !f.linhaId);
  return gerais.length ? { ...cor, fotos: gerais } : { ...cor, amostra: null };
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
/**
 * Quanto tem dessa cor × tamanho. null = a vitrine não controla estoque (vende
 * sem teto). Variação que o estoque não conhece = 0 (não aparece como livre).
 */
export function disponivelDe(m: ModeloPub, corId: string, tamanhoId: string): number | null {
  if (!m.estoque) return null;
  return m.estoque[corId]?.[tamanhoId] ?? 0;
}

/**
 * A cor tem peça em ALGUM tamanho desta linha? Vitrine sem controle de
 * estoque (`estoque` null): sempre tem.
 */
export function corTemEstoque(m: ModeloPub, corId: string, linha: LinhaPub | undefined): boolean {
  if (!m.estoque) return true;
  return (linha?.tamanhos ?? []).some((t) => (disponivelDe(m, corId, t.id) ?? 0) > 0);
}

/**
 * Cores na ordem de mostrar (Léo, 07/10): as com estoque primeiro, as
 * esgotadas por último — esgotada nunca é a 1ª opção. Dentro de cada grupo,
 * a ordem do cadastro. Sem controle de estoque, a ordem do cadastro.
 */
export function coresPorEstoque(m: ModeloPub, linha: LinhaPub | undefined): CorPub[] {
  if (!m.estoque) return m.cores;
  const com = m.cores.filter((c) => corTemEstoque(m, c.id, linha));
  return [...com, ...m.cores.filter((c) => !com.includes(c))];
}

/** A cor que abre: a 1ª com estoque nesta linha (ou a 1ª do cadastro). */
export const corInicial = (m: ModeloPub, linha: LinhaPub | undefined): CorPub =>
  coresPorEstoque(m, linha)[0];

/** O modelo existe nesta linha da empresa (filtro do topo)? */
export const temLinha = (m: ModeloPub, linhaId: string): boolean =>
  m.linhas.some((l) => l.linhaId === linhaId);

export function somar(
  c: Carrinho,
  modeloId: string,
  corId: string,
  tamanhoId: string,
  delta: number,
  teto: number | null = null,
): Carrinho {
  const atual = c[modeloId]?.[corId]?.[tamanhoId] ?? 0;
  const max = teto === null ? 99_999 : Math.max(0, Math.min(99_999, teto));
  const novo = Math.max(0, Math.min(max, atual + delta));
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

/** Descarta do carrinho salvo o que não existe mais na vitrine — e o que passou do estoque. */
export function limparCarrinho(c: Carrinho, v: VitrinePub): Carrinho {
  let out: Carrinho = {};
  for (const m of v.modelos) {
    const cores = new Set(m.cores.map((x) => x.id));
    const tams = new Set(m.linhas.flatMap((l) => l.tamanhos.map((t) => t.id)));
    for (const [corId, porTam] of Object.entries(c[m.id] ?? {})) {
      if (!cores.has(corId)) continue;
      for (const [tamId, q] of Object.entries(porTam)) {
        if (tams.has(tamId) && Number.isInteger(q) && q > 0) {
          out = somar(out, m.id, corId, tamId, q, disponivelDe(m, corId, tamId));
        }
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
    ...faltasDoMinimo(pecas, r(investe), aConfirmar, v),
  };
}

/**
 * Quanto falta pro pedido mínimo: peças (faixa Entrada) e a regra da empresa
 * (R$ e/ou peças, E ou OU). Com item sob consulta o valor não é conhecido —
 * sai só o critério de valor; o de peças continua (o servidor faz igual).
 */
export function faltasDoMinimo(pecas: number, investe: number, aConfirmar: boolean, v: VitrinePub) {
  const m = v.pedidoMinimo;
  const pecasEntrada = v.faixas.minimoEntrada ? Math.max(0, v.faixas.minimoEntrada - pecas) : 0;
  const crit: Array<{ tipo: 'pecas' | 'valor'; falta: number }> = [];
  if (m?.quantidadeMin) crit.push({ tipo: 'pecas', falta: Math.max(0, m.quantidadeMin - pecas) });
  if (m?.valorMin && !aConfirmar) {
    crit.push({
      tipo: 'valor',
      falta: Math.max(0, Math.round((m.valorMin - investe) * 100) / 100),
    });
  }
  const ou = m?.modo === 'OU' && crit.length > 1;
  const cumpriu = ou ? crit.some((c) => c.falta === 0) : crit.every((c) => c.falta === 0);
  const falta = (t: 'pecas' | 'valor') =>
    cumpriu ? 0 : (crit.find((c) => c.tipo === t)?.falta ?? 0);
  return {
    /** Peças que faltam pro mínimo. */
    faltamMinimo: Math.max(pecasEntrada, falta('pecas')),
    /** R$ que falta pro pedido mínimo da empresa. */
    faltaValor: falta('valor'),
    /** Regra "OU": cumprir peças OU valor basta (a tela diz "X peças ou R$ Y"). */
    minimoOu: ou,
  };
}

/** Próxima faixa e quantas peças faltam pra ela. */
export function proximaFaixa(pecas: number, f: Faixas): { faixa: Faixa; faltam: number } | null {
  if (f.minimoVolume && pecas < f.minimoVolume)
    return { faixa: 'volume', faltam: f.minimoVolume - pecas };
  if (f.minimoAtacadao && pecas < f.minimoAtacadao)
    return { faixa: 'atacadao', faltam: f.minimoAtacadao - pecas };
  return null;
}

export const NOME_FAIXA: Record<Faixa, string> = {
  entrada: 'Entrada',
  volume: 'Volume',
  atacadao: 'Atacadão',
};

/**
 * Barra de progresso: vai só até a PRÓXIMA faixa (144 de 200), não até a
 * última. Já no topo = barra cheia, alvo = mínimo do Atacadão.
 */
export function progressoFaixa(pecas: number, f: Faixas): { alvo: number; pct: number } {
  const prox = proximaFaixa(pecas, f);
  const alvo = prox
    ? pecas + prox.faltam
    : (f.minimoAtacadao ?? f.minimoVolume ?? Math.max(1, pecas));
  return { alvo, pct: alvo > 0 ? Math.min(100, Math.round((pecas / alvo) * 1000) / 10) : 100 };
}

/**
 * "Adicione 56 peças para seu lucro ser R$ X": lucro estimado ao chegar na
 * próxima faixa, mantendo a mesma mistura do carrinho (lucro médio por peça
 * na faixa nova × total de peças). null quando não dá pra estimar (preço sob
 * consulta, sem revenda sugerida) — aí a tela diz só quantas peças faltam.
 */
export function lucroNaProximaFaixa(
  c: Carrinho,
  v: VitrinePub,
): { faixa: Faixa; faltam: number; lucro: number } | null {
  const pecas = totalPecas(c);
  const prox = proximaFaixa(pecas, v.faixas);
  if (!prox || pecas <= 0) return null;
  let investe = 0;
  let revende = 0;
  for (const m of v.modelos) {
    for (const l of m.linhas) {
      const n = pecasDoModelo(c, m.id, l);
      if (!n) continue;
      const p = precoNaFaixa(l, prox.faixa);
      if (p === null || l.precoSugerido === null) return null;
      investe += n * p;
      revende += n * l.precoSugerido;
    }
  }
  const lucro = Math.round(((revende - investe) / pecas) * (pecas + prox.faltam) * 100) / 100;
  return { ...prox, lucro };
}

/**
 * Preço por faixa no card do modelo: "Entrada R$ 19,99 · 200+ peças R$ 17,99…".
 * Só entra faixa com preço PRÓPRIO e (fora a Entrada) com mínimo configurado.
 */
export function precosPorFaixa(
  l: LinhaPub,
  f: Faixas,
): Array<{ faixa: Faixa; minimo: number | null; preco: number }> {
  const out: Array<{ faixa: Faixa; minimo: number | null; preco: number }> = [];
  if (l.precoEntrada !== null)
    out.push({ faixa: 'entrada', minimo: f.minimoEntrada, preco: l.precoEntrada });
  if (l.precoVolume !== null && f.minimoVolume)
    out.push({ faixa: 'volume', minimo: f.minimoVolume, preco: l.precoVolume });
  if (l.precoAtacadao !== null && f.minimoAtacadao) {
    out.push({ faixa: 'atacadao', minimo: f.minimoAtacadao, preco: l.precoAtacadao });
  }
  return out;
}

/** Texto do "kit pra anunciar" — o que o revendedor cola no marketplace. */
export function textoKit(m: ModeloPub): string {
  const partes: string[] = [];
  partes.push(`TÍTULO SUGERIDO\n${m.tituloMarketplace?.trim() || m.nome}`);
  partes.push(`DESCRIÇÃO\n${m.descricaoMarketplace?.trim() || m.descricao?.trim() || m.nome}`);
  const ficha: string[] = [];
  if (m.etiquetas.length) ficha.push(m.etiquetas.join(' · '));
  if (m.composicao?.trim()) ficha.push(`Composição: ${m.composicao.trim()}`);
  if (ficha.length) partes.push(`FICHA TÉCNICA\n${ficha.join('\n')}`);
  partes.push(
    `TAMANHOS\n${m.linhas.map((l) => `${l.nome}: ${l.tamanhos.map((t) => t.nome).join(', ')}`).join('\n')}`,
  );
  const medidas = m.linhas
    .filter((l) => l.tabelaMedidas && l.tabelaMedidas.linhas.length)
    .map((l) => {
      const t = l.tabelaMedidas as TabelaMedidasPub;
      const linhas = t.linhas.map(
        (r) =>
          `${r.tamanho}: ${t.colunas.map((c, i) => `${c} ${r.valores[i] || '-'}`).join(' · ')}`,
      );
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

/** O que vai no envio: só célula e quantidade — preço quem calcula é o servidor. */
export function itensParaEnvio(
  c: Carrinho,
): Array<{ corId: string; tamanhoId: string; quantidade: number }> {
  const out: Array<{ corId: string; tamanhoId: string; quantidade: number }> = [];
  for (const porCor of Object.values(c)) {
    for (const [corId, porTam] of Object.entries(porCor)) {
      for (const [tamanhoId, quantidade] of Object.entries(porTam)) {
        if (Number.isInteger(quantidade) && quantidade > 0)
          out.push({ corId, tamanhoId, quantidade });
      }
    }
  }
  return out;
}

/** WhatsApp digitado: (47) 99999-1234 — só pra exibir enquanto a pessoa digita. */
export function mascararWhatsapp(bruto: string): string {
  const d = bruto.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}
