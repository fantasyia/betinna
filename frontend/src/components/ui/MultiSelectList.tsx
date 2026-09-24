import { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Input } from './Input';

export interface MultiSelectOption {
  /** Valor gravado no array. */
  value: string;
  label: string;
  /** Chave estável (React + data-testid). Default = value. */
  key?: string;
}

/** Minúsculo e sem acento — "Sem Resposta" acha "sem resp", "Reação" acha "reacao". */
function normalizar(s: string) {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * MultiSelectList — lista com busca e seleção múltipla (checkbox por linha).
 *
 * Feita pra listas que crescem (tags, etapas): o grid de chips vira parede
 * quando passa de ~20 itens. Aqui a lista rola e a busca filtra.
 *
 * - `value` preserva a ORDEM de seleção (marcar = append, desmarcar = remove).
 * - Valor salvo que não existe mais em `options` (tag apagada) aparece no topo
 *   marcado como "não existe mais" — senão ficaria gravado e invisível, filtrando
 *   o lote sem ninguém ver por quê.
 * - `id` vai no campo de busca: o `<Field>` injeta e o label foca nele.
 */
export function MultiSelectList({
  options,
  value,
  onChange,
  id,
  placeholder = 'Buscar…',
  emptyText = 'Nada cadastrado',
  testIdPrefix,
  className,
  'aria-describedby': ariaDescribedBy,
}: {
  options: MultiSelectOption[];
  value: string[];
  onChange: (next: string[]) => void;
  id?: string;
  placeholder?: string;
  emptyText?: string;
  /** Prefixo dos data-testid: `<prefix>-busca`, `<prefix>-limpar`, `<prefix>-<key>`. */
  testIdPrefix?: string;
  className?: string;
  'aria-describedby'?: string;
}) {
  const [busca, setBusca] = useState('');
  const tid = (sufixo: string) => (testIdPrefix ? `${testIdPrefix}-${sufixo}` : undefined);

  const todas = useMemo((): (MultiSelectOption & { orfa?: boolean })[] => {
    const conhecidas = new Set(options.map((o) => o.value));
    const orfas = value
      .filter((v) => !conhecidas.has(v))
      .map((v) => ({ value: v, label: v, orfa: true }));
    return [...orfas, ...options];
  }, [options, value]);

  const filtradas = useMemo(() => {
    const q = normalizar(busca.trim());
    if (!q) return todas;
    return todas.filter((o) => normalizar(o.label).includes(q));
  }, [todas, busca]);

  const selecionadas = new Set(value);

  const alternar = (v: string) =>
    onChange(selecionadas.has(v) ? value.filter((x) => x !== v) : [...value, v]);

  if (todas.length === 0) {
    return <span className="text-[11px] text-muted">{emptyText}</span>;
  }

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Input
        id={id}
        size="sm"
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder={placeholder}
        leftIcon={<Search />}
        aria-describedby={ariaDescribedBy}
        data-testid={tid('busca')}
      />
      <div className="flex items-center justify-between text-[11px] text-muted">
        <span data-testid={tid('contagem')}>
          {value.length === 0
            ? 'Nenhuma selecionada'
            : `${value.length} selecionada${value.length > 1 ? 's' : ''}`}
        </span>
        {value.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="inline-flex items-center gap-0.5 hover:text-text"
            data-testid={tid('limpar')}
          >
            <X className="h-3 w-3" /> Limpar
          </button>
        )}
      </div>
      <ul
        role="listbox"
        aria-multiselectable="true"
        className="max-h-48 overflow-y-auto rounded-md border border-border bg-bg py-1"
      >
        {filtradas.length === 0 && (
          <li className="px-2 py-1.5 text-[11px] text-muted">Nenhum resultado pra “{busca}”</li>
        )}
        {filtradas.map((o) => {
          const sel = selecionadas.has(o.value);
          const chave = o.key ?? o.value;
          return (
            <li key={`${o.orfa ? 'orfa:' : ''}${chave}`} role="option" aria-selected={sel}>
              <label
                className={cn(
                  'flex cursor-pointer items-center gap-2 px-2 py-1 text-xs',
                  sel ? 'bg-primary/10 text-text' : 'text-text hover:bg-surface',
                )}
              >
                {/* Nativo de propósito: o <Checkbox> do kit já se embrulha num <label>,
                    e label dentro de label é HTML inválido (clique vira loteria). */}
                <input
                  type="checkbox"
                  checked={sel}
                  onChange={() => alternar(o.value)}
                  className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-primary"
                  data-testid={tid(chave)}
                />
                <span className="truncate">{o.label}</span>
                {o.orfa && (
                  <span className="ml-auto shrink-0 text-[10px] text-warning">não existe mais</span>
                )}
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
