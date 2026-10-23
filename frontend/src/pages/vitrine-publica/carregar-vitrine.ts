import { useEffect, useState } from 'react';
import { ApiError } from '@/lib/api';

/**
 * Carregamento da vitrine com "modo ghost" (Léo, 23/10).
 *
 * Sem internet — ou com o servidor engasgando — a vitrine NÃO mostra erro: fica no
 * esqueleto (os blocos cinza no formato da tela, como as redes sociais) e tenta de
 * novo sozinha. Volta a internet, carrega na hora, sem a pessoa fazer nada.
 *
 * Só o 404 sai do esqueleto: endereço que não existe não é falta de internet, e
 * esperar por ele seria um esqueleto eterno.
 */
export type EstadoVitrine<T> =
  | { fase: 'carregando' }
  | { fase: 'pronta'; dados: T }
  | { fase: 'indisponivel' };

/** 3s, 6s, 12s, 24s, 30s, 30s… — sem martelar o servidor, sem deixar a pessoa esperando muito. */
export function esperaDaTentativa(n: number): number {
  return Math.min(30_000, 3_000 * 2 ** n);
}

export function useCarregarVitrine<T>(buscar: () => Promise<T>, chave: string): EstadoVitrine<T> {
  const [estado, setEstado] = useState<EstadoVitrine<T>>({ fase: 'carregando' });

  useEffect(() => {
    let vivo = true;
    let tentativa = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setEstado({ fase: 'carregando' });

    const tentar = () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
      // Sabidamente offline: nem tenta — espera o evento `online`.
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      buscar().then(
        (dados) => {
          if (vivo) setEstado({ fase: 'pronta', dados });
        },
        (e: unknown) => {
          if (!vivo) return;
          if (e instanceof ApiError && e.status === 404) {
            setEstado({ fase: 'indisponivel' });
            return;
          }
          // Rede ou servidor: continua no esqueleto e tenta de novo.
          timer = setTimeout(tentar, esperaDaTentativa(tentativa++));
        },
      );
    };

    const aoVoltarInternet = () => {
      tentativa = 0;
      tentar();
    };
    window.addEventListener('online', aoVoltarInternet);
    tentar();
    return () => {
      vivo = false;
      if (timer) clearTimeout(timer);
      window.removeEventListener('online', aoVoltarInternet);
    };
    // `buscar` muda a cada render; o que importa é a vitrine (chave = slug).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);

  return estado;
}
