import { useApiQuery } from '@/hooks/useApiQuery';

/**
 * useInspectorData — içado do topo do NodeInspector.
 *
 * Antes, as 6 useApiQuery viviam dentro do NodeInspector e remontavam a cada
 * troca de nó. Centralizando-as aqui (com as MESMAS queryKeys), o TanStack
 * cacheia entre trocas de nó — sem cache-buster `_t=`. Comportamento idêntico.
 *
 * Retorna as listas + as duas derivações que o inspector faz:
 *  - etapasOpts: todas as etapas de todos os funis, achatadas (label "Funil · Etapa")
 *  - etapasDoFunil(funilId): só as etapas de UM funil (dropdowns dependentes)
 */

export interface InspectorTag {
  id: string;
  nome: string;
}
export interface InspectorPrompt {
  id: string;
  nome: string;
  isPadrao?: boolean;
}
export interface InspectorEtapa {
  id: string;
  nome: string;
}
export interface InspectorFunil {
  id: string;
  nome: string;
  etapas: InspectorEtapa[];
}
export interface InspectorUsuario {
  id: string;
  nome: string;
  role: string;
}
export interface InspectorVariavel {
  id: string;
  chave: string;
}
export interface InspectorContatoWa {
  id: string;
  nome: string;
  tipo: 'CONTATO' | 'GRUPO';
}
export interface InspectorEtapaOpt {
  id: string;
  label: string;
}

export interface UseInspectorDataResult {
  tags: InspectorTag[] | null;
  prompts: InspectorPrompt[] | null;
  funis: InspectorFunil[] | null;
  usuarios: InspectorUsuario[];
  variaveis: InspectorVariavel[];
  contatosWa: InspectorContatoWa[] | null;
  /** Todas as etapas de todos os funis, achatadas — label "Funil · Etapa". */
  etapasOpts: InspectorEtapaOpt[];
  /** Etapas de UM funil — pros dropdowns dependentes do funil escolhido. */
  etapasDoFunil: (funilId?: string) => InspectorEtapa[];
}

export function useInspectorData(): UseInspectorDataResult {
  // Listas pros seletores das ações novas (orquestração Fase B).
  const { data: tags } = useApiQuery<InspectorTag[]>('/tags');
  const { data: prompts } = useApiQuery<InspectorPrompt[]>('/mullerbot/prompts');
  const { data: funis } = useApiQuery<InspectorFunil[]>('/funis');
  const etapasOpts = (funis ?? []).flatMap((f) =>
    (f.etapas ?? []).map((e) => ({ id: e.id, label: `${f.nome} · ${e.nome}` })),
  );
  // Usuários (responsável/destinatário) + variáveis customizadas (roteador/condição).
  const { data: usersResp } = useApiQuery<{ data: InspectorUsuario[] }>(
    '/users?limit=100&status=ATIVO',
  );
  const usuarios = usersResp?.data ?? [];
  const { data: variaveisData } = useApiQuery<
    InspectorVariavel[] | { data: InspectorVariavel[] }
  >('/orquestracao/variaveis');
  const variaveis = Array.isArray(variaveisData) ? variaveisData : (variaveisData?.data ?? []);
  // Contatos WhatsApp da inbox — pro destinatário "contato salvo" do Enviar WhatsApp.
  const { data: contatosWa } = useApiQuery<InspectorContatoWa[]>('/inbox/contatos-whatsapp');
  /** Etapas de UM funil — pros dropdowns dependentes do funil escolhido. */
  const etapasDoFunil = (funilId?: string) =>
    (funis ?? []).find((f) => f.id === funilId)?.etapas ?? [];

  return { tags, prompts, funis, usuarios, variaveis, contatosWa, etapasOpts, etapasDoFunil };
}
