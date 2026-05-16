import type { ReactNode } from 'react';
import { btnGhost, colors, tableStyle, td, th } from './styles';

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  width?: number | string;
}

export interface TableProps<T> {
  data: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
}

export function Table<T>({ data, columns, rowKey, onRowClick }: TableProps<T>) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={tableStyle} data-testid="data-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} style={{ ...th, width: c.width }}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr
              key={rowKey(row)}
              data-testid="data-row"
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              style={{
                cursor: onRowClick ? 'pointer' : 'default',
              }}
            >
              {columns.map((c) => (
                <td key={c.key} style={td}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export function Pagination({
  pagination,
  onPageChange,
}: {
  pagination: PaginationInfo;
  onPageChange: (p: number) => void;
}) {
  const { page, totalPages, total } = pagination;
  const canPrev = page > 1;
  const canNext = page < totalPages;
  return (
    <div
      data-testid="pagination"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0.75rem 0',
        fontSize: 13,
        color: colors.muted,
      }}
    >
      <span>
        Página {page} de {Math.max(1, totalPages)} · {total} {total === 1 ? 'registro' : 'registros'}
      </span>
      <div style={{ display: 'flex', gap: 4 }}>
        <button
          type="button"
          disabled={!canPrev}
          data-testid="pagination-prev"
          onClick={() => canPrev && onPageChange(page - 1)}
          style={{ ...btnGhost, opacity: canPrev ? 1 : 0.4 }}
        >
          ‹ Anterior
        </button>
        <button
          type="button"
          disabled={!canNext}
          data-testid="pagination-next"
          onClick={() => canNext && onPageChange(page + 1)}
          style={{ ...btnGhost, opacity: canNext ? 1 : 0.4 }}
        >
          Próxima ›
        </button>
      </div>
    </div>
  );
}
