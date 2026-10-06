import { cn } from '@/lib/cn';

/**
 * Grade editável da OP: por linha (Regular, Plus…), cores nas linhas e
 * tamanhos nas colunas, um número por variação. Serve pra montar a OP e pra
 * registrar corte, envio e entrega.
 */

export interface CelulaGrade {
  produtoId: string;
  cor: { nome: string; hex: string };
  corOrdem: number;
  linha: string;
  linhaOrdem: number;
  tamanho: string;
  tamanhoOrdem: number;
}

export type ValoresGrade = Record<string, string>;

/** Agrupa as células em blocos por linha → cores × tamanhos. PURO. */
export function agrupar(celulas: CelulaGrade[]) {
  const linhas = [...new Map(celulas.map((c) => [c.linha, c.linhaOrdem])).entries()].sort((a, b) => a[1] - b[1]);
  return linhas.map(([linha]) => {
    const dela = celulas.filter((c) => c.linha === linha);
    const tamanhos = [...new Map(dela.map((c) => [c.tamanho, c.tamanhoOrdem])).entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([t]) => t);
    const cores = [...new Map(dela.map((c) => [c.cor.nome, c])).values()].sort((a, b) => a.corOrdem - b.corOrdem);
    return {
      linha,
      tamanhos,
      cores: cores.map((c) => ({
        cor: c.cor,
        celulas: tamanhos.map((t) => dela.find((x) => x.cor.nome === c.cor.nome && x.tamanho === t) ?? null),
      })),
    };
  });
}

/** Texto do campo → inteiro ≥ 0 (vazio = 0). */
export const inteiro = (t: string | undefined) => {
  const v = Number.parseInt((t ?? '').replace(/\D/g, ''), 10);
  return Number.isFinite(v) ? v : 0;
};

export function totalGrade(v: ValoresGrade): number {
  return Object.values(v).reduce((s, t) => s + inteiro(t), 0);
}

export function GradeEditor({
  celulas,
  valores,
  onChange,
  maximos,
  dicas,
  testid,
}: {
  celulas: CelulaGrade[];
  valores: ValoresGrade;
  onChange: (v: ValoresGrade) => void;
  /** Teto por variação (ex.: não enviar mais do que cortou). Mostrado como "/ 10". */
  maximos?: Record<string, number>;
  /** Texto curto embaixo de cada campo (ex.: "sistema 12"). */
  dicas?: Record<string, string>;
  testid?: string;
}) {
  const blocos = agrupar(celulas);
  return (
    <div className="flex flex-col gap-3" data-testid={testid}>
      {blocos.map((b) => (
        <div key={b.linha} className="overflow-x-auto">
          <table className="text-sm tabular-nums">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-muted">
                <th className="px-1.5 py-1 text-left font-semibold">{b.linha}</th>
                {b.tamanhos.map((t) => (
                  <th key={t} className="px-1 py-1 text-center font-semibold">
                    {t}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.cores.map((c) => (
                <tr key={c.cor.nome}>
                  <td className="px-1.5 py-1 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5">
                      <i className="inline-block h-3 w-3 shrink-0 rounded-full border border-border" style={{ background: c.cor.hex }} />
                      {c.cor.nome}
                    </span>
                  </td>
                  {c.celulas.map((cel, i) => {
                    if (!cel) return <td key={b.tamanhos[i]} className="px-1 py-1 text-center text-muted">—</td>;
                    const max = maximos?.[cel.produtoId];
                    const v = inteiro(valores[cel.produtoId]);
                    return (
                      <td key={cel.produtoId} className="px-1 py-1">
                        <div className="flex flex-col items-center">
                          <input
                            value={valores[cel.produtoId] ?? ''}
                            onChange={(e) => onChange({ ...valores, [cel.produtoId]: e.target.value.replace(/\D/g, '') })}
                            inputMode="numeric"
                            aria-label={`${b.linha} ${c.cor.nome} ${b.tamanhos[i]}`}
                            className={cn(
                              'h-9 w-14 rounded-[10px] border bg-bg px-1.5 text-center text-sm',
                              max !== undefined && v > max ? 'border-danger text-danger' : 'border-border-strong',
                            )}
                          />
                          {max !== undefined && <span className="text-[10px] text-muted">de {max}</span>}
                          {dicas?.[cel.produtoId] && <span className="text-[10px] text-muted">{dicas[cel.produtoId]}</span>}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
