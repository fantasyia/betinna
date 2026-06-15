import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { colors } from './styles';

/**
 * Combobox com busca debounced contra um endpoint paginado do backend.
 * Sem libs externas — usa fetch via api.get e renderiza dropdown próprio.
 *
 * Endpoint esperado: GET <endpoint>?search=X&limit=10 → { data: T[], pagination }
 * O caller fornece `getLabel` e `getId` pra desacoplar do shape do recurso.
 *
 * Uso:
 *   <AsyncCombobox<Cliente>
 *     endpoint="/clientes"
 *     placeholder="Buscar cliente…"
 *     getLabel={(c) => c.nome}
 *     getId={(c) => c.id}
 *     value={selectedCliente}
 *     onChange={setSelectedCliente}
 *   />
 */
export interface AsyncComboboxProps<T> {
  endpoint: string;
  placeholder?: string;
  getLabel: (item: T) => string;
  getSubLabel?: (item: T) => string | null;
  getId: (item: T) => string;
  value: T | null;
  onChange: (item: T | null) => void;
  /** Query param key (default 'search') */
  searchKey?: string;
  /** Extra query params estáticos */
  extraQuery?: Record<string, string>;
  disabled?: boolean;
  testId?: string;
}

const DEBOUNCE_MS = 250;

export function AsyncCombobox<T>({
  endpoint,
  placeholder = 'Buscar…',
  getLabel,
  getSubLabel,
  getId,
  value,
  onChange,
  searchKey = 'search',
  extraQuery,
  disabled,
  testId,
}: AsyncComboboxProps<T>) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<T[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Fechar dropdown ao clicar fora
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Debounced fetch quando query muda
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      void runSearch(query);
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, open]);

  async function runSearch(q: string) {
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({ limit: '10' });
    if (q.trim()) qs.set(searchKey, q.trim());
    if (extraQuery) {
      for (const [k, v] of Object.entries(extraQuery)) qs.set(k, v);
    }
    try {
      const r = await api.get<{ data: T[] }>(`${endpoint}?${qs.toString()}`);
      setResults(Array.isArray(r.data) ? r.data : []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro ao buscar');
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  function pick(item: T) {
    onChange(item);
    setOpen(false);
    setQuery('');
  }

  return (
    <div ref={containerRef} style={{ position: 'relative' }} data-testid={testId}>
      {value ? (
        <div
          className="w-full border border-border-strong rounded-md px-3 py-2 text-[13px] bg-surface text-text box-border outline-none flex items-center justify-between gap-2"
          style={{ cursor: disabled ? 'default' : 'pointer' }}
        >
          <span data-testid={testId ? `${testId}-selected` : undefined}>
            <strong>{getLabel(value)}</strong>
            {getSubLabel && (
              <span style={{ color: colors.muted, marginLeft: 6, fontSize: 12 }}>
                {getSubLabel(value)}
              </span>
            )}
          </span>
          {!disabled && (
            <button
              type="button"
              aria-label="Limpar"
              data-testid={testId ? `${testId}-clear` : undefined}
              onClick={() => onChange(null)}
              style={{
                background: 'transparent',
                border: 'none',
                color: colors.muted,
                cursor: 'pointer',
                fontSize: 18,
                padding: 0,
                lineHeight: 1,
              }}
            >
              ×
            </button>
          )}
        </div>
      ) : (
        <input
          type="search"
          disabled={disabled}
          placeholder={placeholder}
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          className="w-full border border-border-strong rounded-md px-3 py-2 text-[13px] bg-surface text-text box-border outline-none"
        />
      )}
      {open && !value && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderTop: 'none',
            borderRadius: '0 0 6px 6px',
            maxHeight: 240,
            overflowY: 'auto',
            zIndex: 50,
            boxShadow: '0 6px 16px rgba(0,0,0,0.08)',
          }}
        >
          {loading && (
            <div style={{ padding: '0.5rem 0.75rem', color: colors.muted, fontSize: 13 }}>
              Buscando…
            </div>
          )}
          {!loading && error && (
            <div style={{ padding: '0.5rem 0.75rem', color: colors.danger, fontSize: 13 }}>
              {error}
            </div>
          )}
          {!loading && !error && results.length === 0 && (
            <div style={{ padding: '0.5rem 0.75rem', color: colors.muted, fontSize: 13 }}>
              {query.trim() ? 'Nenhum resultado' : 'Digite pra buscar'}
            </div>
          )}
          {!loading &&
            !error &&
            results.map((item) => (
              <button
                key={getId(item)}
                type="button"
                data-testid={testId ? `${testId}-option-${getId(item)}` : undefined}
                onClick={() => pick(item)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '0.5rem 0.75rem',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: `1px solid ${colors.border}`,
                  cursor: 'pointer',
                  fontSize: 14,
                  fontFamily: 'inherit',
                  color: colors.text,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#f6f7f9')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <div style={{ fontWeight: 500 }}>{getLabel(item)}</div>
                {getSubLabel && (
                  <div style={{ fontSize: 12, color: colors.muted }}>{getSubLabel(item)}</div>
                )}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
