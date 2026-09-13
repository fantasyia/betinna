/**
 * Detecta PEDIDO DE REMOÇÃO / descadastro (LGPD) na mensagem do LEAD. Rede de
 * segurança DETERMINÍSTICA: o LLM às vezes responde a despedida de remoção só em
 * TEXTO, sem gravar `pedido_remocao=sim` naquele turno → o nó ficava preso em
 * AGUARDANDO e não roteava. Detectar no texto do lead força o sinal, sem depender
 * do LLM. É um direito legal — tem que funcionar SEMPRE.
 *
 * Vive num util próprio (auditoria 13/09/2026, B-4/E-2) porque passou a ser
 * usado também pelo bot geral e pelo opener reativo — antes só o turno do nó de
 * IA olhava, e o opt-out dito no WhatsApp só virava tag se o autor do fluxo
 * tivesse ligado o ramo certo.
 */
const PADROES_REMOCAO: RegExp[] = [
  /\btir[ae]r?\s+(o\s+)?(meu|meu\s+)?\s*(n[uú]mero|contato|nome|cadastro)/i,
  // "me tira/remove/exclui" SÓ com destino de cadastro — "me tira uma dúvida" /
  // "pode me tirar uma foto" é lead ENGAJADO, não LGPD (falso positivo real)
  /\bme\s+(tir[ae]r?|remov[ae]r?|exclu[ai]r?)\s+(daqui|(d[aeo]s?|dess[ae]s?|dest[ae]s?)\s+(seus?\s+|suas?\s+)?\w*(lista|grupo|cadastro|base|mailing|whats\w*|zap|contatos?))/i,
  /\bme\s+(descadastr\w*|desinscrev\w*)/i,
  /\bdescadastr\w*/i,
  /\bsai[ar]?\s+d[ae]\s+(sua|essa|dessa)\s+lista/i,
  /\bsair\s+da\s+lista/i,
  /\bn[aã]o\s+(quero|desejo)\s+(mais\s+)?(receber|ser\s+(contact|procurad|chamad|abordad))/i,
  /\bn[aã]o\s+me\s+(mand|envi|cham|procur|perturb|contat)\w*/i,
  /\bpar[ae]\s+de\s+(me\s+)?(mand|envi|cham|procur|contat)\w*/i,
  // idem: "remover o meu" precisa do OBJETO de cadastro ("remove meu desconto" ≠ LGPD)
  /\bremov[ae]r?\s+(o\s+|a\s+)?(meu|minha)\s+(n[uú]mero|contato|nome|cadastro|telefone|zap|whats\w*)/i,
  /\bunsubscribe\b/i,
  // Palavra ISOLADA como mensagem inteira: "PARAR", "SAIR", "STOP", "CANCELAR",
  // "DESCADASTRAR" — o padrão de opt-out por SMS/WhatsApp que o mercado ensinou.
  // Só a mensagem inteira (com pontuação opcional): "quero sair do prédio" não conta.
  /^\s*(parar|pare|sair|stop|cancelar|cancela|remover|descadastrar)\s*[.!]*\s*$/i,
];

export function pedidoRemocaoNoTexto(texto: string): boolean {
  const t = (texto ?? '').trim();
  return t.length > 0 && PADROES_REMOCAO.some((re) => re.test(t));
}
