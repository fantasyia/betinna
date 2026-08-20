import { useApiQuery } from '@/hooks/useApiQuery';

/**
 * Nome do bot definido pela empresa (`persona.nome`, ex: "SomaBOT").
 *
 * Existe porque "Muller" estava escrito à mão em meia dúzia de telas — título da
 * configuração, tag da mensagem no Inbox, histórico, onboarding. O tenant
 * renomeava o bot pra SomaBOT e continuava lendo "Muller" na tela, inclusive os
 * representantes, que nunca ouviram falar desse nome. O campo sempre existiu; o
 * que faltava era a tela usar.
 *
 * Fallback "Assistente IA" e não "MullerBot": enquanto a persona não carrega (ou
 * se falhar), o genérico não mente sobre o nome de ninguém.
 *
 * A queryKey é a mesma em todo lugar, então o TanStack busca uma vez só e as
 * telas compartilham o cache.
 */
export function useNomeBot(): string {
  const { data } = useApiQuery<{ nome?: string }>('/mullerbot/persona');
  return data?.nome?.trim() || 'Assistente IA';
}
