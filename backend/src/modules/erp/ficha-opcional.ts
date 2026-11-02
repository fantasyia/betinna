/**
 * Ficha do OPCIONAL (Léo, 02/11: "+ emblema emborrachado") = ficha do modelo
 * BASE na mesma linha + os EXTRAS do opcional (emborrachado, serviço de
 * aplicar). Os extras ficam em `FichaTecnica.extrasOpcional`; os itens da
 * ficha do opcional são REMONTADOS a cada mudança da base, então custo, OP e
 * impressão continuam lendo uma ficha comum. PURO.
 */
import type { FichaDto } from './fichas.dto';

export type ItemFicha = FichaDto['itens'][number];

export interface ExtrasOpcional {
  itens: ItemFicha[];
  /** Serviços de acabamento a mais (ids da lista da empresa). */
  acabamento: string[];
}

/** O que está gravado (null = ficha comum, não segue base nenhuma). */
export function lerExtras(v: unknown): ExtrasOpcional | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Partial<ExtrasOpcional>;
  return {
    itens: Array.isArray(o.itens) ? o.itens : [],
    acabamento: Array.isArray(o.acabamento) ? o.acabamento : [],
  };
}

/** Ficha do opcional montada da base + extras. */
export function fichaDoOpcional(base: FichaDto, extras: ExtrasOpcional): FichaDto {
  return {
    custoFaccaoPrevisto: base.custoFaccaoPrevisto ?? null,
    observacoes: base.observacoes ?? null,
    acabamento: [...new Set([...(base.acabamento ?? []), ...extras.acabamento])],
    // Serviço extra vale em todos os tamanhos (fora da restrição da base).
    acabamentoTamanhos: base.acabamentoTamanhos ?? null,
    itens: [...base.itens, ...extras.itens],
  };
}

const chave = (i: ItemFicha) =>
  JSON.stringify([
    i.insumoId,
    i.uso ?? null,
    i.corFixaId ?? null,
    i.etapa ?? 'FACCAO',
    Number(i.consumoPorPeca).toFixed(4),
    i.porTamanho && Object.keys(i.porTamanho).length
      ? Object.entries(i.porTamanho).sort(([a], [b]) => a.localeCompare(b))
      : null,
  ]);

/**
 * Pra ligar uma ficha que já existe (copiada da base à mão): o que o opcional
 * tem A MAIS vira extra; o que a BASE tem e o opcional não (ou diferente)
 * aparece em `divergencias` — o Léo decide antes de ligar.
 */
export function extrasDaDiferenca(
  base: FichaDto,
  opcional: FichaDto,
): { extras: ExtrasOpcional; divergencias: ItemFicha[] } {
  const sobra = new Map<string, number>();
  for (const i of base.itens) sobra.set(chave(i), (sobra.get(chave(i)) ?? 0) + 1);
  const extras: ItemFicha[] = [];
  for (const i of opcional.itens) {
    const k = chave(i);
    const n = sobra.get(k) ?? 0;
    if (n > 0) sobra.set(k, n - 1);
    else extras.push(i);
  }
  const divergencias = base.itens.filter((i) => {
    const k = chave(i);
    const n = sobra.get(k) ?? 0;
    if (n > 0) {
      sobra.set(k, n - 1);
      return true;
    }
    return false;
  });
  const daBase = new Set(base.acabamento ?? []);
  return {
    extras: {
      itens: extras,
      acabamento: (opcional.acabamento ?? []).filter((s) => !daBase.has(s)),
    },
    divergencias,
  };
}
