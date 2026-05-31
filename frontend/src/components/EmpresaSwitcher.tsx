import { useEffect, useRef, useState } from 'react';
import { Building2, ChevronDown, Check } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApiQuery';
import { switchEmpresaAtiva, currentEmpresaId } from '@/lib/auth-store';
import { cn } from '@/lib/cn';

/**
 * EmpresaSwitcher — dropdown na sidebar pra trocar de empresa (tenant).
 *
 * - ADMIN: vê TODAS as empresas ativas do sistema (cross-tenant).
 * - DIRECTOR/GERENTE/SAC/REP: vê apenas as empresas vinculadas.
 *
 * Click numa empresa diferente → atualiza `empresaIdAtiva` no auth-store
 * + recarrega a página pra limpar caches. O header `X-Empresa-Id` que
 * o `api.ts` envia em toda request passa a ter o novo valor.
 *
 * Quando há só 1 empresa disponível, exibe o nome em texto fixo (sem
 * dropdown). Quando 0 ou loading, esconde o componente.
 */
interface EmpresaItem {
  id: string;
  nome: string;
  logoUrl: string | null;
}

export function EmpresaSwitcher() {
  const { data: empresas, loading } = useApiQuery<EmpresaItem[]>('/empresas/minhas');
  const empresaIdAtiva = currentEmpresaId();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fecha o dropdown ao clicar fora
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  // Auto-seleciona uma empresa quando NÃO há nenhuma ativa de verdade.
  // Caso clássico: ADMIN não vinculado a empresa nenhuma — o seletor mostrava
  // empresas[0] como "ativa" (fallback visual), mas o empresaIdAtiva real era
  // null → o header X-Empresa-Id não ia → 403 em tudo que é por-empresa.
  // Aqui a gente COMMITA de verdade (persiste + reaplica no reload).
  const autoSelected = useRef(false);
  useEffect(() => {
    if (autoSelected.current) return;
    if (loading || !empresas || empresas.length === 0) return;
    const temAtivaReal = !!empresaIdAtiva && empresas.some((e) => e.id === empresaIdAtiva);
    if (!temAtivaReal) {
      autoSelected.current = true;
      switchEmpresaAtiva(empresas[0].id);
    }
  }, [loading, empresas, empresaIdAtiva]);

  // Sem dados ainda ou nenhuma empresa: esconde
  if (loading || !empresas || empresas.length === 0) return null;

  const ativa = empresas.find((e) => e.id === empresaIdAtiva) ?? empresas[0];
  const onlyOne = empresas.length === 1;

  // Apenas 1 empresa: exibe nome fixo (sem interação)
  if (onlyOne) {
    return (
      <div
        data-testid="empresa-switcher-single"
        className="px-3 py-2 border-b border-border flex items-center gap-2 text-text-subtle"
        title="Sua empresa (não há outras vinculadas)"
      >
        <Building2 className="h-3.5 w-3.5 text-muted shrink-0" />
        <span className="text-xs font-medium truncate">{ativa.nome}</span>
      </div>
    );
  }

  // 2+ empresas: dropdown
  return (
    <div
      ref={containerRef}
      className="relative border-b border-border"
      data-testid="empresa-switcher"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={cn(
          'w-full flex items-center gap-2 px-3 py-2 text-left',
          'hover:bg-surface-hover transition-colors',
          'text-text-subtle',
        )}
      >
        <Building2 className="h-3.5 w-3.5 text-muted shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-[9px] uppercase tracking-wider text-muted-light leading-tight">
            Empresa ativa
          </div>
          <div className="text-xs font-semibold text-text truncate">{ativa.nome}</div>
        </div>
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 text-muted shrink-0 transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Trocar de empresa"
          className={cn(
            'absolute top-full left-2 right-2 mt-1 z-[80]',
            'bg-surface border border-border-strong rounded-md shadow-lg',
            'max-h-[60vh] overflow-y-auto',
          )}
        >
          {empresas.map((emp) => {
            const isAtiva = emp.id === ativa.id;
            return (
              <button
                key={emp.id}
                type="button"
                role="option"
                aria-selected={isAtiva}
                data-testid={`empresa-switcher-opt-${emp.id}`}
                onClick={() => {
                  setOpen(false);
                  if (!isAtiva) switchEmpresaAtiva(emp.id);
                }}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-2 text-left text-sm',
                  'hover:bg-surface-hover transition-colors',
                  isAtiva && 'bg-primary/10 text-primary font-semibold',
                  !isAtiva && 'text-text',
                )}
              >
                <span className="flex-1 truncate">{emp.nome}</span>
                {isAtiva && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
