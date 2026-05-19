import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getSession } from '@/lib/auth-store';

/**
 * Hook para buscar e exibir o logo da empresa atual.
 *
 * Backend retorna signed URL com cache 7 dias. Refresh forçado via `reload()`
 * (chamado após upload/remove). Estado:
 *  - loading: primeira fetch ainda em curso
 *  - logoUrl: signed URL ou null se empresa não tem logo
 *  - error: silencioso (logo é opcional, fallback é o logo Betinna)
 */
export function useEmpresaLogo(empresaId?: string | null) {
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchLogo = useCallback(async () => {
    const id = empresaId ?? getSession()?.user?.empresaIdAtiva;
    if (!id) {
      setLoading(false);
      return;
    }
    try {
      const data = await api.get<{ signedUrl: string | null; expiresIn: number }>(
        `/empresas/${id}/logo`,
      );
      setLogoUrl(data.signedUrl);
    } catch {
      // Logo é opcional — falha silenciosa, fallback no UI
      setLogoUrl(null);
    } finally {
      setLoading(false);
    }
  }, [empresaId]);

  useEffect(() => {
    fetchLogo();
  }, [fetchLogo]);

  return { logoUrl, loading, reload: fetchLogo };
}
