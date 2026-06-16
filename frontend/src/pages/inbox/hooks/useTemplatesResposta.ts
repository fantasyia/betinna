import { useApiQuery } from '@/hooks/useApiQuery';
import { api } from '@/lib/api';
import type { Conversation, RespostaRapida } from '../lib/types';

/**
 * Respostas rápidas / templates da thread (extraído do ConversationThread no
 * refactor 2026-06-16). O dropdown abre quando o texto começa com "/".
 *
 * - `templates` = GET /respostas-rapidas.
 * - busca `empresaInfo` (GET /empresas/atual) internamente só pra resolver o
 *   placeholder {nome_empresa}. (A mesma query roda no ConversationThread pro
 *   ThreadHeader — o TanStack dedup por URL, então não há request duplicado.)
 *
 * `inserirTemplate` substitui os placeholders usando `convData` + `empresaInfo`,
 * busca o cliente best-effort pra {representante}, escreve no composer via
 * `setResposta` e foca o `composeRef`. Lógica movida VERBATIM.
 */
export function useTemplatesResposta(
  convData: Conversation | null,
  composeRef: React.MutableRefObject<HTMLTextAreaElement | null>,
  setResposta: (v: string) => void,
) {
  const templates = useApiQuery<RespostaRapida[]>('/respostas-rapidas');
  const empresaInfo = useApiQuery<{ nome?: string; botWhatsappAtivo?: boolean }>('/empresas/atual');

  function substituir(texto: string, map: Record<string, string>): string {
    let out = texto;
    for (const [k, v] of Object.entries(map)) out = out.split(k).join(v);
    return out;
  }

  async function inserirTemplate(t: RespostaRapida) {
    let texto = substituir(t.conteudo, {
      '{nome_cliente}': convData?.cliente?.nome ?? 'cliente',
      '{nome_empresa}': empresaInfo.data?.nome ?? '',
    });
    // representante — busca o cliente só se o template usar (best-effort).
    if (texto.includes('{representante}') && convData?.cliente?.id) {
      try {
        const cli = await api.get<{ representante?: { nome?: string } | null }>(
          `/clientes/${convData.cliente.id}`,
        );
        texto = texto.split('{representante}').join(cli.representante?.nome ?? '');
      } catch {
        texto = texto.split('{representante}').join('');
      }
    } else {
      texto = texto.split('{representante}').join('');
    }
    // {ultimo_pedido} não tem fonte confiável aqui — limpa pra não vazar a chave.
    texto = texto.split('{ultimo_pedido}').join('');
    setResposta(texto);
    setTimeout(() => composeRef.current?.focus(), 0);
  }

  return { templates, inserirTemplate };
}
