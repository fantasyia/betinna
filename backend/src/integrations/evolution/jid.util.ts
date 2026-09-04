/**
 * Normalização do JID que chega do WhatsApp (Evolution/Baileys).
 *
 * JID de verdade nunca tem `+`: é `<numero>@s.whatsapp.net`, `<id>@lid` ou
 * `<id>@g.us`. Mas o Evolution às vezes entrega o `remoteJidAlt` (o telefone
 * real por trás de um LID) em E.164 — com o `+` na frente. Como a conversa é
 * casada por `peerId` EXATO no `upsertConversation`, `+5511999999999@s.whatsapp.net`
 * e `5511999999999@s.whatsapp.net` viravam DUAS conversas do mesmo contato:
 * metade das mensagens em cada uma.
 *
 * Medido em produção em 04/09: 2 contatos rachados assim — um deles o número do
 * próprio diretor na caixa da empresa (16 mensagens numa conversa, 5 na outra).
 * O lado do ENVIO já tolerava o `+` (`normalizarJid` do whatsapp-session); era o
 * inbound que faltava. Esta função fecha a assimetria.
 */
export function normalizarJid(jid: string): string {
  return jid.startsWith('+') ? jid.slice(1) : jid;
}
