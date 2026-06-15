import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

const BTN_GHOST =
  'bg-transparent text-text rounded-md px-2 py-1 text-[13px] font-medium cursor-pointer tracking-[-0.1px]';

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
      <table
        className="w-full border-separate border-spacing-0 text-[13px]"
        data-testid="data-table"
      >
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                className="text-left px-3.5 py-2.5 border-b border-border font-semibold text-muted text-[11px] uppercase bg-bg-alt tracking-[0.6px]"
                style={{ width: c.width }}
              >
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
                <td
                  key={c.key}
                  className="px-3.5 py-3 border-b border-border align-middle text-text"
                >
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
      className="flex items-center justify-between py-3 text-[13px] text-muted"
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
          className={cn(BTN_GHOST, canPrev ? '' : 'opacity-40')}
        >
          ‹ Anterior
        </button>
        <button
          type="button"
          disabled={!canNext}
          data-testid="pagination-next"
          onClick={() => canNext && onPageChange(page + 1)}
          className={cn(BTN_GHOST, canNext ? '' : 'opacity-40')}
        >
          Próxima ›
        </button>
      </div>
    </div>
  );
}
