/**
 * Escopo `tudo` do token de API (Léo, 26/10: "quero ter acesso a absolutamente
 * TUDO sendo controlado aqui pelo chat, e lá vai ser só a interface").
 *
 * Com ele, o token alcança qualquer rota da API como o DONO do token, na empresa
 * do token — os @Roles, as permissões e o filtro por empresa dos controllers
 * seguem valendo. Ficam de fora SÓ as portas que o Léo listou (26/10):
 *  - integrações: conectar/desconectar, chaves, WhatsApp, Meta, Asaas;
 *  - gerar ou mexer em token pelo próprio token;
 *  - ativar fluxo (e apagar fluxo de vez);
 *  - disparar/agendar campanha;
 *  - mandar mensagem ou e-mail pra cliente (e ligar a IA que responde sozinha);
 *  - estorno ou cobrança de verdade (gateway de pagamento);
 * e o que é da plataforma, não da empresa (admin, backup, auth, webhooks,
 * criar/apagar empresa e usuário, trocar papel de usuário).
 *
 * A ferramenta existir não autoriza o uso: dinheiro e envio pra fora seguem só
 * com pedido explícito do Léo.
 */

/** Motivo do bloqueio, ou null se o escopo `tudo` alcança a rota. */
export function bloqueioDoTudo(rel: string, metodo: string, corpo?: unknown): string | null {
  const m = metodo.toUpperCase();
  const r = rel.toLowerCase().replace(/\/+$/, '') || '/';
  const escrita = m !== 'GET' && m !== 'HEAD';
  const casa = (re: RegExp) => re.test(r);

  // Plataforma — nem leitura.
  if (casa(/^\/(auth|admin|backup|webhooks|push|public|kanban\/api-tokens)(\/|$)/)) {
    return 'Fora do escopo "tudo": rota da plataforma (login, admin, backup, webhook, tokens).';
  }
  // Lista de empresas do dono: o token é de UMA empresa (dono ADMIN veria as outras).
  if (casa(/^\/empresas(\/minhas)?$/) && !escrita) {
    return 'Fora do escopo "tudo": o token é de uma empresa só — use /empresas/atual.';
  }
  // Integrações: só o status/teste de e-mail que já existia por escopo próprio.
  if (casa(/^\/(integracoes|usuario\/integracoes|checkout)(\/|$)/)) {
    if (!escrita || casa(/^\/integracoes\/email\/(status|teste)$/)) return null;
    return 'Fora do escopo "tudo": conectar/desconectar integração e gateway de pagamento são pela tela.';
  }
  if (!escrita) return null;

  const regras: Array<[RegExp, string]> = [
    [/^\/fluxos\/[^/]+\/(ativar|permanente)$/, 'ativar ou apagar fluxo de vez é pela tela'],
    [/^\/campanhas\/[^/]+\/(disparar|agendar|reenviar-erros)$/, 'disparar campanha é pela tela'],
    [
      /^\/inbox\/[^/]+\/(responder|responder-midia)$/,
      'mandar mensagem pra cliente não é papel do token',
    ],
    [/^\/inbox\/whatsapp\/limpar$/, 'limpar o WhatsApp inteiro é pela tela'],
    [
      /^\/propostas\/[^/]+\/(enviar-email|enviar-aceite)$/,
      'mandar proposta pro cliente é pela tela',
    ],
    [/^\/propostas\/aceite(\/|$)/, 'o aceite é do cliente'],
    [/^\/contratos\/[^/]+\/reenviar-assinatura$/, 'mandar contrato pra assinar é pela tela'],
    [
      /^\/(pedidos|amostras|contratos|propostas)\/([^/]+\/|bulk\/)?enviar-erp$/,
      'mandar pro ERP externo é pela tela',
    ],
    [/^\/pendencias\/ia$/, 'ligar a IA que responde o cliente sozinha é pela tela'],
    [/^\/users\/[^/]+\/reenviar-convite$/, 'convite sai por e-mail — é pela tela'],
    [/^\/empresas\/[^/]+\/ativar$/, 'ativar/desativar empresa é da plataforma'],
  ];
  for (const [re, motivo] of regras) if (casa(re)) return `Fora do escopo "tudo": ${motivo}.`;

  // Criar/apagar empresa e usuário: plataforma. Editar usuário pode, menos o papel.
  if (
    (m === 'POST' || m === 'DELETE') &&
    casa(/^\/(empresas|users)(\/[^/]+)?$/) &&
    !casa(/^\/empresas\/config$/)
  ) {
    return 'Fora do escopo "tudo": criar ou apagar empresa/usuário é pela tela.';
  }
  if (casa(/^\/users\/(?!me$)[^/]+$/) && corpo && typeof corpo === 'object' && 'role' in corpo) {
    return 'Fora do escopo "tudo": trocar o papel de um usuário é pela tela.';
  }
  return null;
}
