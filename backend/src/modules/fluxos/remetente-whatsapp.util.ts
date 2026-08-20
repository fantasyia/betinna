/**
 * De qual número sai uma mensagem de fluxo no WhatsApp.
 *
 * Contexto: o app tem dual-owner (D38) — número central da empresa e WhatsApp
 * pessoal de cada rep, cada um numa instância própria. O inbound já distingue os
 * dois e o gatilho já filtra por `escopo`. O que faltava era o ENVIO: os nós de
 * fluxo mandavam sempre pelo número da empresa, então uma conversa que chegava
 * no celular do rep era respondida por outro número — o cliente via a conversa
 * trocar de remetente no meio, e o WhatsApp pessoal ficava sendo só leitura.
 *
 * A regra tem duas partes, e a segunda é a que costuma ser esquecida:
 *
 * 1. RESPOSTA sai pela porta por onde a mensagem entrou. Se a execução nasceu
 *    de uma conversa da instância pessoal, responde por ela.
 * 2. …mas só quando o destinatário é o LEAD daquela conversa. Os modos `numero`
 *    e `contato` existem pra avisar gente de dentro (diretoria, grupo interno).
 *    Mandar ISSO pelo celular do rep faria o diretor receber alerta do sistema
 *    vindo do número pessoal de um funcionário — que não é "responder pela mesma
 *    porta", é usar o número de alguém como remetente de recado interno.
 *
 * O override explícito (`remetenteUsuarioId`) ganha de tudo: quem escolheu, quis.
 */

export type DestinatarioModo = 'lead' | 'numero' | 'contato';

export interface EntradaRemetente {
  /** `remetenteUsuarioId` configurado no nó (override explícito). */
  configurado?: string | null;
  /** Dono da conversa que originou a execução (null = veio do número da empresa). */
  donoDaConversa?: string | null;
  /** Pra quem o nó está mandando. */
  modo: DestinatarioModo;
}

export interface Remetente {
  /** `proprietarioId` a usar no envio. null = número da empresa. */
  proprietarioId: string | null;
  /** De onde veio a decisão — vai pro output do passo, pra auditoria. */
  origem: 'configurado' | 'conversa' | 'empresa';
}

export function resolverRemetente(e: EntradaRemetente): Remetente {
  if (e.configurado) return { proprietarioId: e.configurado, origem: 'configurado' };
  if (e.donoDaConversa && e.modo === 'lead') {
    return { proprietarioId: e.donoDaConversa, origem: 'conversa' };
  }
  return { proprietarioId: null, origem: 'empresa' };
}
