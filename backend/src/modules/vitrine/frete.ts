/**
 * Frete da vitrine — regras PURAS (sem banco, sem rede).
 *
 * Checkout da vitrine, itens 5a–5e (Léo, 07/10):
 *  - as peças vão em CAIXAS da empresa (medidas, peso vazio, quantas peças
 *    cabem); a peça avulsa vai na embalagem individual;
 *  - nenhum volume passa do teto (25 kg): acima disso o pedido desmembra em
 *    mais volumes, e cada volume é cotado;
 *  - o frete final SOMA os volumes de um mesmo serviço;
 *  - "retirar em mãos" (R$ 0) só a partir de N peças (1.000).
 *
 * Os números da empresa (CEP de origem, caixas, retirada) ficam em
 * `Empresa.config.frete` e são editados na tela — nenhum valor de negócio mora
 * aqui. O que tem default é só a SUGESTÃO que a tela mostra no primeiro uso.
 */

export type AmbienteFrete = 'sandbox' | 'producao';

export interface Embalagem {
  /** Nome que aparece pro cliente e na separação ("Caixa grande"). */
  nome: string;
  comprimentoCm: number;
  larguraCm: number;
  alturaCm: number;
  /** Peso da embalagem VAZIA, em gramas. */
  pesoVazioG: number;
  /** Quantas peças cabem. */
  capacidadePecas: number;
}

/** O que fica em `Empresa.config.frete` (o token do Melhor Envio NÃO: ele é credencial cifrada). */
export interface ConfigFrete {
  ativo?: boolean;
  ambiente?: AmbienteFrete;
  cepOrigem?: string;
  /** Declarar o valor das peças no seguro do envio (default: sim). */
  declararValor?: boolean;
  /** Teto por volume, em kg. */
  pesoMaxVolumeKg?: number;
  /** Embalagem da peça avulsa (ou de poucas peças). */
  embalagemIndividual?: Embalagem | null;
  caixas?: Embalagem[];
  retirada?: {
    ativo?: boolean;
    minimoPecas?: number;
    endereco?: string;
    horario?: string;
  } | null;
}

/** Sugestão da tela no primeiro uso (decisões do Léo, 07/10). Não é regra: é o que vem preenchido. */
export const SUGESTAO_FRETE = {
  pesoMaxVolumeKg: 25,
  embalagemIndividual: {
    nome: 'Embalagem individual',
    comprimentoCm: 36,
    larguraCm: 26,
    alturaCm: 3,
    pesoVazioG: 50,
    capacidadePecas: 1,
  },
  retiradaMinimoPecas: 1000,
} as const;

export function configFrete(config: unknown): ConfigFrete {
  return (((config ?? {}) as Record<string, unknown>).frete ?? {}) as ConfigFrete;
}

/** O frete está pronto pra cotar? Devolve o que falta (vazio = pronto). */
export function faltandoNoFrete(cfg: ConfigFrete): string[] {
  const falta: string[] = [];
  if (!/^\d{8}$/.test(cfg.cepOrigem ?? '')) falta.push('CEP de origem');
  if (!cfg.pesoMaxVolumeKg || cfg.pesoMaxVolumeKg <= 0) falta.push('peso máximo por volume');
  if (!(cfg.caixas ?? []).some(embalagemValida)) falta.push('ao menos uma caixa completa');
  return falta;
}

export function embalagemValida(e: Embalagem | null | undefined): e is Embalagem {
  return (
    !!e &&
    e.comprimentoCm > 0 &&
    e.larguraCm > 0 &&
    e.alturaCm > 0 &&
    e.pesoVazioG >= 0 &&
    Number.isInteger(e.capacidadePecas) &&
    e.capacidadePecas > 0
  );
}

export interface Volume {
  embalagem: string;
  comprimentoCm: number;
  larguraCm: number;
  alturaCm: number;
  /** Peso TOTAL do volume (peças + embalagem), em gramas. */
  pesoG: number;
  pecas: number;
}

export class FreteRegraError extends Error {}

/**
 * Distribui as peças (peso de cada uma, em gramas) em volumes.
 *
 * 1. Sobrou o que cabe na embalagem individual → ela fecha o pedido.
 * 2. Sobrou o que cabe numa caixa só → a MENOR caixa que comporta o resto.
 * 3. Senão → enche a MAIOR caixa (até a capacidade e o teto de peso) e repete.
 *
 * Peças mais pesadas primeiro: o teto de peso é que define quantos volumes
 * vão, e começar pelas pesadas não deixa uma pesada sobrando no fim.
 */
export function montarVolumes(pesosG: number[], cfg: ConfigFrete): Volume[] {
  const tetoG = Math.round((cfg.pesoMaxVolumeKg ?? 0) * 1000);
  const caixas = (cfg.caixas ?? []).filter(embalagemValida);
  if (tetoG <= 0 || caixas.length === 0) {
    throw new FreteRegraError('Frete sem caixa ou sem peso máximo cadastrado');
  }
  if (pesosG.some((p) => !Number.isFinite(p) || p <= 0)) {
    throw new FreteRegraError('Peça sem peso cadastrado');
  }
  const individual = embalagemValida(cfg.embalagemIndividual) ? cfg.embalagemIndividual : null;
  const porCapacidade = [...caixas].sort(
    (a, b) => a.capacidadePecas - b.capacidadePecas || a.pesoVazioG - b.pesoVazioG,
  );
  const maior = porCapacidade[porCapacidade.length - 1];
  const fila = [...pesosG].sort((a, b) => b - a);
  const volumes: Volume[] = [];
  const soma = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
  const fecha = (e: Embalagem, pecas: number[]): Volume => ({
    embalagem: e.nome,
    comprimentoCm: e.comprimentoCm,
    larguraCm: e.larguraCm,
    alturaCm: e.alturaCm,
    pesoG: e.pesoVazioG + soma(pecas),
    pecas: pecas.length,
  });
  const cabe = (e: Embalagem, pecas: number[]) =>
    pecas.length <= e.capacidadePecas && e.pesoVazioG + soma(pecas) <= tetoG;

  while (fila.length > 0) {
    if (individual && cabe(individual, fila)) {
      volumes.push(fecha(individual, fila.splice(0)));
      break;
    }
    const final = porCapacidade.find((e) => cabe(e, fila));
    if (final) {
      volumes.push(fecha(final, fila.splice(0)));
      break;
    }
    // Enche a maior: até a capacidade e sem passar do teto. Como a fila está
    // em ordem decrescente, a primeira que não cabe pode ser seguida de
    // menores que cabem — então percorre a fila inteira.
    const dentro: number[] = [];
    let peso = maior.pesoVazioG;
    for (let i = 0; i < fila.length && dentro.length < maior.capacidadePecas; ) {
      if (peso + fila[i] <= tetoG) {
        peso += fila[i];
        dentro.push(fila.splice(i, 1)[0]);
      } else i++;
    }
    if (dentro.length === 0) {
      throw new FreteRegraError(
        `Uma peça sozinha passa de ${cfg.pesoMaxVolumeKg} kg com a caixa — confira o peso cadastrado`,
      );
    }
    volumes.push(fecha(maior, dentro));
  }
  return volumes;
}

/** Cotação de UM volume num serviço (centavos). */
export interface OpcaoCotada {
  id: number;
  nome: string;
  transportadora: string;
  precoC: number;
  prazoDias: number | null;
}

export interface OpcaoFrete extends OpcaoCotada {
  volumes: number;
}

/**
 * Soma as cotações por serviço. Cada item de `porVolume` é a lista de serviços
 * que atendem AQUELE volume; o serviço só vale se atende TODOS (sem isso o
 * pedido iria com volume sem frete). Prazo = o maior entre os volumes.
 * Mais barato primeiro.
 */
export function somarCotacoes(porVolume: OpcaoCotada[][]): OpcaoFrete[] {
  if (porVolume.length === 0) return [];
  const [primeiro, ...resto] = porVolume;
  const out: OpcaoFrete[] = [];
  for (const s of primeiro) {
    let precoC = s.precoC;
    let prazo = s.prazoDias;
    let ok = true;
    for (const lista of resto) {
      const mesmo = lista.find((x) => x.id === s.id);
      if (!mesmo) {
        ok = false;
        break;
      }
      precoC += mesmo.precoC;
      prazo = prazo === null || mesmo.prazoDias === null ? null : Math.max(prazo, mesmo.prazoDias);
    }
    if (ok) out.push({ ...s, precoC, prazoDias: prazo, volumes: porVolume.length });
  }
  return out.sort((a, b) => a.precoC - b.precoC || (a.prazoDias ?? 99) - (b.prazoDias ?? 99));
}

/** Retirada em mãos liberada pra esse tamanho de pedido? */
export function retiradaLiberada(cfg: ConfigFrete, totalPecas: number): boolean {
  const r = cfg.retirada;
  return !!r?.ativo && !!r.minimoPecas && totalPecas >= r.minimoPecas && !!r.endereco?.trim();
}

export const soDigitos = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '');
