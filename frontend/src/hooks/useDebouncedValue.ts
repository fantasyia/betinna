import { useEffect, useState } from 'react';

/**
 * Retorna `value` com ATRASO — o valor de saída só muda depois de `delayMs`
 * sem novas mudanças. Útil em campos de busca: o input continua respondendo na
 * hora (estado próprio), mas a busca no servidor só dispara quando o usuário
 * para de digitar — evita uma requisição por tecla.
 *
 * Uso:
 *   const [busca, setBusca] = useState('');
 *   const buscaDebounced = useDebouncedValue(busca, 300);
 *   // input controlado por `busca`; listPath usa `buscaDebounced`.
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);

  return debounced;
}
