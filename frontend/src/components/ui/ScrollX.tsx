import { useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Contêiner de rolagem horizontal COM pista visual.
 *
 * Tabela larga no celular rola dentro do card, mas nada dizia que havia coluna
 * à direita — Pedidos mostrava "Pedido" e "Cliente" e Total/Status/Data
 * pareciam não existir (auditoria mobile de 05/09). A 1ª tentativa foi só-CSS
 * (gradiente no fundo do contêiner): funcionou na teoria e sumiu na prática,
 * porque cabeçalho opaco e linha selecionada pintam POR CIMA do fundo.
 *
 * Aqui as sombras são overlays absolutos, acima do conteúdo, e só aparecem do
 * lado que ainda tem conteúdo escondido — somem quando o usuário chega no fim.
 * No celular, enquanto nunca rolou, um chip "deslize →" diz o que fazer.
 *
 * `className` vai no wrapper externo (margens, borda, arredondamento); o
 * scroller interno é sempre `overflow-x-auto`.
 */
export function ScrollX({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [esquerda, setEsquerda] = useState(false);
  const [direita, setDireita] = useState(false);
  const [rolou, setRolou] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const medir = () => {
      setEsquerda(el.scrollLeft > 2);
      setDireita(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
    };
    const aoRolar = () => {
      setRolou(true);
      medir();
    };
    medir();
    el.addEventListener('scroll', aoRolar, { passive: true });
    // Conteúdo que muda de largura (dados chegando, coluna que aparece) re-mede.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(medir) : null;
    ro?.observe(el);
    if (el.firstElementChild) ro?.observe(el.firstElementChild);
    return () => {
      el.removeEventListener('scroll', aoRolar);
      ro?.disconnect();
    };
  }, []);

  return (
    <div className={cn('relative', className)} data-testid="scroll-x">
      <div ref={ref} className="overflow-x-auto" {...rest}>
        {children}
      </div>
      <div
        aria-hidden
        data-testid="scroll-x-sombra-esq"
        className={cn(
          'pointer-events-none absolute inset-y-0 left-0 w-6 transition-opacity duration-150',
          esquerda ? 'opacity-100' : 'opacity-0',
        )}
        style={{ background: 'linear-gradient(to right, var(--scroll-hint), rgba(0,0,0,0))' }}
      />
      <div
        aria-hidden
        data-testid="scroll-x-sombra-dir"
        className={cn(
          'pointer-events-none absolute inset-y-0 right-0 w-6 transition-opacity duration-150',
          direita ? 'opacity-100' : 'opacity-0',
        )}
        style={{ background: 'linear-gradient(to left, var(--scroll-hint), rgba(0,0,0,0))' }}
      />
      {direita && !rolou && (
        <span
          aria-hidden
          data-testid="scroll-x-dica"
          className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-contrast shadow-md sm:hidden"
        >
          deslize →
        </span>
      )}
    </div>
  );
}
