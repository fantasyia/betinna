import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

/**
 * F5 (Lote 8) — Contadores de novidade pros badges do menu.
 * Faz polling leve (60s) em /badges. Falha silenciosa (badge some).
 */
export interface BadgeCounts {
  vendas: number;
  atendimento: number;
}

export function useBadges(): BadgeCounts {
  const [counts, setCounts] = useState<BadgeCounts>({ vendas: 0, atendimento: 0 });

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const r = await api.get<BadgeCounts>('/badges');
        if (active && r) setCounts({ vendas: r.vendas ?? 0, atendimento: r.atendimento ?? 0 });
      } catch {
        // silencioso — badge é informativo, não bloqueia nada
      }
    }
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, []);

  return counts;
}
