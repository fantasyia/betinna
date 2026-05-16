import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';

/**
 * Hook minimalista para GET com 3 estados.
 * Sem cache (cada page mantém seu state). Sem React Query — não precisamos
 * de cache cross-page ainda. Quando precisar, dropa Tanstack Query in.
 *
 * Uso:
 *   const { data, loading, error, refetch } = useApiQuery<Resp>('/clientes?page=1');
 */
export interface UseApiQueryResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useApiQuery<T>(path: string | null): UseApiQueryResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(path !== null);
  const [error, setError] = useState<string | null>(null);
  const [bump, setBump] = useState(0);
  const cancelledRef = useRef(false);

  const refetch = useCallback(() => setBump((b) => b + 1), []);

  useEffect(() => {
    if (path === null) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }
    cancelledRef.current = false;
    setLoading(true);
    setError(null);
    api
      .get<T>(path)
      .then((r) => {
        if (!cancelledRef.current) setData(r);
      })
      .catch((err) => {
        if (cancelledRef.current) return;
        const msg = err instanceof ApiError ? err.message : 'Erro ao carregar';
        setError(msg);
      })
      .finally(() => {
        if (!cancelledRef.current) setLoading(false);
      });
    return () => {
      cancelledRef.current = true;
    };
  }, [path, bump]);

  return { data, loading, error, refetch };
}

/**
 * Helper genérico para envelopes paginados do backend.
 *   { data: T[], pagination: { page, limit, total, totalPages } }
 */
export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
