import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { currentEmpresaId } from '@/lib/auth-store';

/**
 * Hook de GET com 3 estados — agora com CACHE cross-page por baixo (TanStack
 * Query). A interface continua IDÊNTICA ({data, loading, error, refetch}), então
 * as páginas que usam não mudam nada. Ganho: navegar de volta pra uma tela já
 * visitada reaproveita o cache (não re-busca tudo do servidor a cada troca).
 *
 * Uso:
 *   const { data, loading, error, refetch } = useApiQuery<Resp>('/clientes?page=1');
 *
 * `path === null` desabilita a busca (mesmo comportamento de antes).
 * `refetch()` força revalidar (continua funcionando em todos os call-sites).
 */
export interface UseApiQueryResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useApiQuery<T>(path: string | null): UseApiQueryResult<T> {
  // empresaId entra na chave do cache (isolamento multi-tenant). Defesa em
  // profundidade: trocar de empresa já dá window.location.reload() (auth-store),
  // o que zera o cache — mesmo assim a chave evita qualquer mistura de tenants.
  const empresaId = currentEmpresaId();

  const query = useQuery<T>({
    queryKey: [path, empresaId],
    queryFn: () => api.get<T>(path as string),
    enabled: path !== null,
  });

  // `query.refetch` do TanStack é referencialmente estável → refetch fica estável.
  // Ignora qualquer argumento (ex.: onRetry/onClick passam o event) — só revalida.
  const refetchQuery = query.refetch;
  const refetch = useCallback(() => {
    void refetchQuery();
  }, [refetchQuery]);

  return {
    data: (query.data ?? null) as T | null,
    // path nulo = query desabilitada → não está "carregando".
    loading: path === null ? false : query.isPending,
    error: query.error
      ? query.error instanceof ApiError
        ? query.error.message
        : 'Erro ao carregar'
      : null,
    refetch,
  };
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
