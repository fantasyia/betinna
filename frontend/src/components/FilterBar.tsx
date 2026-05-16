import type { ReactNode } from 'react';
import { input } from './styles';

/**
 * Container horizontal pra filtros (search + selects).
 * Coloca os children numa grade flexível e bonita.
 */
export function FilterBar({ children }: { children: ReactNode }) {
  return (
    <div
      data-testid="filter-bar"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: '0.75rem',
        marginBottom: '1rem',
      }}
    >
      {children}
    </div>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'Buscar…',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="search"
      data-testid="search-input"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={input}
    />
  );
}
