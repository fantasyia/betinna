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

/**
 * Telefone (como o app guarda) → JID (como a rede identifica).
 *
 * 🔴 O DEFEITO QUE ISTO FECHA, medido em 23/09: um lead nascido pelo checkout do
 * site tem o telefone em E.164 (`+5511997524483`) — que é o formato CERTO, é
 * onde 79% da base já está. Três lugares montavam o `peerId` colando esse
 * telefone no `@s.whatsapp.net` sem tirar o `+`, e como a conversa é casada por
 * `peerId` EXATO, `+5511997524483@s.whatsapp.net` e `5511997524483@…` viravam
 * DUAS conversas da mesma pessoa. O WhatsApp entrega o JID sempre SEM `+`, então
 * o inbound caía numa e o outbound do fluxo na outra.
 *
 * ⚠️ E o `+` estava sendo preservado DE PROPÓSITO, por um motivo legítimo: ele
 * é o sinal de "este número é internacional, não prefixe 55". Um estrangeiro de
 * 10/11 dígitos ganharia `55` sem ele. O erro não foi guardar o sinal — foi
 * deixar o sinal chegar até a IDENTIDADE da conversa. Aqui ele é lido e
 * descartado no mesmo lugar: decide o DDI e não sobrevive à saída.
 *
 * Fronteira única entre as duas camadas:
 *
 *   Lead.contatoTelefone     `+5511997524483`                 (E.164, canônico)
 *   Conversation.peerId      `5511997524483@s.whatsapp.net`   (protocolo)
 */
export function jidDeTelefone(telefone: string): string {
  // Lido ANTES de limpar: depois do `replace` o sinal já teria sumido.
  const internacional = telefone.includes('+');
  const digitos = telefone.replace(/\D/g, '');
  const comDdi =
    !internacional && (digitos.length === 10 || digitos.length === 11) ? `55${digitos}` : digitos;
  return `${comDdi}@s.whatsapp.net`;
}
