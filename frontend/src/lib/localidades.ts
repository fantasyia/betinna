/**
 * CL4 (Lote 7) — Localidades oficiais do Brasil.
 *
 * Fonte:
 *  - IBGE (gratuito, sem chave): lista oficial de UFs e municípios.
 *  - ViaCEP (gratuito, sem chave): endereço a partir do CEP.
 *
 * Tudo é cacheado em memória durante a sessão (estados são fixos; municípios
 * por UF raramente mudam). Em caso de falha de rede, cai num fallback local
 * de siglas pra não travar o formulário.
 */

export interface Estado {
  sigla: string;
  nome: string;
}

export interface EnderecoCep {
  logradouro: string;
  bairro: string;
  cidade: string;
  uf: string;
}

const IBGE = 'https://servicodados.ibge.gov.br/api/v1/localidades';
const VIACEP = 'https://viacep.com.br/ws';

/** As 27 unidades federativas — fallback offline e validação rápida. */
export const UF_SIGLAS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
  'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
] as const;

export function isUfValida(uf: string): boolean {
  return (UF_SIGLAS as readonly string[]).includes(uf.trim().toUpperCase());
}

// ─── Cache em memória ──────────────────────────────────────────────────────
let estadosCache: Estado[] | null = null;
const municipiosCache = new Map<string, string[]>();

/** Lista de estados (UFs) ordenada por nome. Cacheada. */
export async function fetchEstados(): Promise<Estado[]> {
  if (estadosCache) return estadosCache;
  try {
    const res = await fetch(`${IBGE}/estados?orderBy=nome`);
    if (!res.ok) throw new Error('IBGE estados indisponível');
    const data = (await res.json()) as Array<{ sigla: string; nome: string }>;
    estadosCache = data.map((e) => ({ sigla: e.sigla, nome: e.nome }));
    return estadosCache;
  } catch {
    // Fallback: siglas em ordem alfabética, sem nome amigável
    estadosCache = [...UF_SIGLAS].sort().map((s) => ({ sigla: s, nome: s }));
    return estadosCache;
  }
}

/** Municípios de uma UF, ordenados por nome. Cacheado por UF. */
export async function fetchMunicipios(uf: string): Promise<string[]> {
  const key = uf.trim().toUpperCase();
  if (!isUfValida(key)) return [];
  const cached = municipiosCache.get(key);
  if (cached) return cached;
  try {
    const res = await fetch(`${IBGE}/estados/${key}/municipios?orderBy=nome`);
    if (!res.ok) throw new Error('IBGE municípios indisponível');
    const data = (await res.json()) as Array<{ nome: string }>;
    const nomes = data.map((m) => m.nome);
    municipiosCache.set(key, nomes);
    return nomes;
  } catch {
    return [];
  }
}

/**
 * Busca endereço pelo CEP (ViaCEP). Retorna null se CEP inválido,
 * não encontrado ou erro de rede.
 */
export async function fetchCep(cep: string): Promise<EnderecoCep | null> {
  const clean = cep.replace(/\D/g, '');
  if (clean.length !== 8) return null;
  try {
    const res = await fetch(`${VIACEP}/${clean}/json/`);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      erro?: boolean;
      logradouro?: string;
      bairro?: string;
      localidade?: string;
      uf?: string;
    };
    if (data.erro) return null;
    return {
      logradouro: data.logradouro ?? '',
      bairro: data.bairro ?? '',
      cidade: data.localidade ?? '',
      uf: data.uf ?? '',
    };
  } catch {
    return null;
  }
}
