import { bloqueioDoTudo } from '@modules/auth/guards/token-tudo';

export interface RotaApi {
  metodo: string;
  caminho: string;
  resumo: string | null;
}

/** Junta prefixo do controller + caminho do método, no formato /a/:b. */
export function juntarCaminho(controller: string, metodo: string): string {
  const partes = [controller, metodo]
    .flatMap((p) => p.split('/'))
    .map((p) => p.trim())
    .filter(Boolean);
  return `/${partes.join('/')}`;
}

/**
 * O catálogo que o token `tudo` enxerga: só o que ele alcança, ordenado por
 * caminho (as rotas de uma tela ficam juntas). `filtro` = trecho do caminho
 * ou do resumo, sem diferenciar maiúscula.
 */
export function catalogo(rotas: RotaApi[], filtro?: string): RotaApi[] {
  const f = filtro?.trim().toLowerCase();
  const vistas = new Set<string>();
  return rotas
    .filter((r) => !bloqueioDoTudo(r.caminho, r.metodo))
    .filter(
      (r) =>
        !f || r.caminho.toLowerCase().includes(f) || (r.resumo ?? '').toLowerCase().includes(f),
    )
    .filter((r) => {
      const k = `${r.metodo} ${r.caminho}`;
      if (vistas.has(k)) return false;
      vistas.add(k);
      return true;
    })
    .sort((a, b) => a.caminho.localeCompare(b.caminho) || a.metodo.localeCompare(b.metodo));
}
