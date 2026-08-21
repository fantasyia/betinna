import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ModuloWidth } from '@/hooks/useDashboardPrefs';
import { cn } from '@/lib/cn';

/**
 * Largura do módulo → classe de col-span no grid de 12 colunas do canvas.
 * Literais (não `col-span-${w}`) pra o Tailwind JIT enxergar as classes.
 */
const SPAN: Record<ModuloWidth, string> = {
  4: 'min-[1024px]:col-span-4',
  6: 'min-[1024px]:col-span-6',
  8: 'min-[1024px]:col-span-8',
  12: 'min-[1024px]:col-span-12',
};

/** Respiro entre módulos. Vive como padding do item, não como gap do grid. */
const GAP_PX = 12;

/**
 * Altura medida → quantas linhas do grid o módulo ocupa.
 *
 * O canvas usa linhas de 1px (`auto-rows-[1px]`) e gap vertical ZERO: assim
 * cada módulo declara a própria altura em vez de herdar a da fileira. O respiro
 * volta como padding embaixo do item — se fosse `gap`, ele apareceria entre
 * TODAS as linhas de 1px e a página viraria uma sanfona.
 */
export function spanDeAltura(alturaPx: number, gapPx: number = GAP_PX): number {
  return Math.max(1, Math.ceil(alturaPx + gapPx));
}

/**
 * O grid comum alinha a fileira pela altura do MAIOR item: um módulo curto ao
 * lado de um comprido deixa um buraco embaixo dele (foi o que o Léo viu — a
 * coluna de Relatórios acabando e um vão até o Calendário). `grid-flow-dense`
 * não resolve: ele preenche colunas que sobraram na fileira, nunca puxa um
 * módulo pra cima.
 *
 * Com masonry cada módulo ocupa exatamente a própria altura e o de baixo sobe
 * até encostar. Depende de ResizeObserver pra remedir quando o conteúdo muda
 * (gráfico que carrega, lista que cresce, largura que o usuário troca).
 */
export function ModuloDoCanvas({
  largura,
  id,
  className,
  children,
}: {
  largura: ModuloWidth;
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [span, setSpan] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    // A checagem mora AQUI, não numa const de módulo: const é avaliada uma vez
    // no import, o que amarra o comportamento ao instante em que o bundle
    // carregou e deixa o caminho de fallback impossível de exercitar.
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      // getBoundingClientRect pega altura fracionária — arredondar pra baixo
      // cortaria 1px do último módulo da coluna.
      setSpan(spanDeAltura(el.getBoundingClientRect().height));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      id={id}
      data-testid="modulo-canvas"
      className={cn('min-w-0', SPAN[largura], className)}
      // Sem ResizeObserver (ou antes da 1ª medição) fica sem span: o grid volta
      // ao comportamento de fileira, que é feio mas nunca some com o módulo.
      style={span ? { gridRowEnd: `span ${span}` } : undefined}
    >
      <div ref={ref} style={{ paddingBottom: GAP_PX }}>
        {children}
      </div>
    </div>
  );
}
