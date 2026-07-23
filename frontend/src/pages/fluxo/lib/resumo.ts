import type { NodePayload, AcaoTipo } from './types';

/**
 * Resumo de 1 linha da config de um nó — mostrado no card do canvas pra ler o
 * fluxo de relance SEM precisar clicar em cada bloco. Só campos legíveis (texto/
 * tag/condição/tempo); ids opacos (funilEtapaId/promptId/representanteId) não
 * viram resumo (não dá pra resolver o nome no card). Retorna null = sem resumo.
 */

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const trunc = (t: string, n = 44): string => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

export function resumoNo(data: NodePayload): string | null {
  const c = data.config ?? {};

  if (data.tipo === 'DELAY') {
    const q = typeof c.quantidade === 'number' ? c.quantidade : undefined;
    const u = str(c.unidade) || 'minutos';
    return q != null ? `aguarda ${q} ${u}` : null;
  }

  if (data.tipo === 'CONDICAO') {
    // SÓ o modo decide: trocar roteador→simples mantém `saidas` órfãs no config,
    // e o Array.isArray fazia o card mentir "roteador · N saídas".
    const roteador = str(c.modo) === 'roteador';
    if (roteador) {
      const n = Array.isArray(c.saidas) ? c.saidas.length : 0;
      const v = str(c.variavel);
      return v ? `roteia por “${trunc(v, 22)}” · ${n} saídas` : `roteador · ${n} saídas`;
    }
    const campo = str(c.campo);
    if (!campo) return null;
    return trunc(`se ${campo} ${str(c.operador)} ${str(c.valor)}`.replace(/\s+/g, ' ').trim());
  }

  const acao = (data.acaoTipo ?? undefined) as AcaoTipo | undefined;
  switch (acao) {
    case 'ENVIAR_WHATSAPP': {
      const m = str(c.mensagem);
      const midia = c.midia && typeof c.midia === 'object' ? '📎 ' : '';
      return m ? `${midia}“${trunc(m, 40)}”` : midia ? '📎 mídia' : null;
    }
    case 'ENVIAR_EMAIL': {
      const a = str(c.assunto);
      return a ? `assunto: ${trunc(a, 34)}` : null;
    }
    case 'MUDAR_TAG': {
      const t = str(c.tagNome);
      if (!t) return null;
      return `${str(c.operacao) === 'remover' ? '−' : '+'} tag ${trunc(t, 32)}`;
    }
    case 'CRIAR_TAREFA': {
      const t = str(c.titulo);
      return t ? trunc(t) : null;
    }
    case 'WEBHOOK_EXTERNO': {
      const u = str(c.url);
      return u ? trunc(u.replace(/^https?:\/\//, ''), 38) : null;
    }
    case 'CONVERSAR_IA':
      return c.aguardarResposta === false ? 'IA responde e segue' : 'IA conversa e aguarda resposta';
    case 'PAUSAR_IA':
      return 'pausa a IA na conversa';
    case 'TRANSFERIR_ATENDIMENTO':
      return c.atendenteId ? 'transfere pro atendente escolhido' : 'joga na fila de atendimento';
    case 'CRIAR_LEAD':
      return c.funilEtapaId ? 'cria lead na etapa escolhida' : 'cria lead da conversa';
    default:
      return null;
  }
}

/** Descrição curta de cada bloco da paleta (tooltip + subtítulo no item). */
export const BLOCO_DESC: Partial<Record<AcaoTipo, string>> & Record<string, string> = {
  ENVIAR_WHATSAPP: 'Manda uma mensagem de WhatsApp',
  ENVIAR_EMAIL: 'Manda um e-mail',
  CRIAR_TAREFA: 'Cria uma tarefa/lembrete',
  MUDAR_TAG: 'Adiciona ou remove uma tag',
  MOVER_LEAD_ETAPA: 'Move o lead pra outra etapa do funil',
  ATRIBUIR_REP: 'Define o representante do lead',
  WEBHOOK_EXTERNO: 'Chama uma URL externa',
  CONVERSAR_IA: 'A IA conversa e classifica o lead',
  LIBERAR_LOTE: 'Move um lote controlado de leads',
  PAUSAR_IA: 'Pausa a IA naquela conversa',
  CRIAR_LEAD: 'Vira lead a conversa (herda a campanha)',
  TRANSFERIR_ATENDIMENTO: 'Passa a conversa pro humano (pausa o bot + notifica)',
  CONDICAO: 'Bifurca o fluxo por uma condição',
  DELAY: 'Espera um tempo antes do próximo passo',
  TRIGGER: 'Quando o fluxo começa',
};
