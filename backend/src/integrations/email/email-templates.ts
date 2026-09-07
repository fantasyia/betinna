/**
 * Templates de e-mail transacional embutidos no app (HTML inline).
 *
 * Por quê HTML inline (e não templates hospedados no provedor)?
 *  - Templates hospedados exigem criação no dashboard + deploy coordenado.
 *    Pra MVP é fricção desnecessária.
 *  - HTML inline = versionável no git, testável local, deploy em 1 commit.
 *
 * Design:
 *  - Layout simples table-based (compatível com Gmail, Outlook, mobile clients)
 *  - Sem CSS externo (alguns clientes strip <style>)
 *  - Width 600px (padrão)
 *  - CTA único (botão) — tira atrito
 *  - Footer: transacional NÃO leva descadastro (confirmação de pedido, rastreio,
 *    convite e senha precisam chegar mesmo pra quem saiu da lista de marketing);
 *    e-mail de marketing leva, via `rodapeDescadastro` (ver DescadastroService)
 *
 * Helpers tipados — payload obrigatório por template, validado em compile-time.
 */

const COLOR_PRIMARY = '#3b82f6';
const COLOR_TEXT = '#1e293b';
const COLOR_MUTED = '#64748b';
const COLOR_BORDER = '#e2e8f0';
const COLOR_BG = '#f8fafc';
const COLOR_DANGER = '#dc2626';
const COLOR_SUCCESS = '#16a34a';

/**
 * Marca do TENANT no e-mail. Vem de `Empresa.config.marca` + `Empresa.nome`.
 *
 * Só entra quando a empresa configurou logo E cor: sem isso o layout do tenant
 * sairia com uma faixa colorida e uma imagem quebrada no lugar da logo, o que é
 * pior que o layout genérico. Ou seja, é opt-in por tenant e ninguém acorda com
 * o e-mail diferente.
 */
export interface MarcaEmail {
  empresaNome: string;
  logoUrl: string;
  corPrimaria: string;
  /** Cor do BOTÃO — na Somatec o laranja da ação, não o ciano do fio. */
  corAcao?: string;
  /** Faixa do cabeçalho: textura ASSADA em imagem (Outlook não faz gradiente). */
  headerImgUrl?: string;
  rodape?: string;
}

interface BaseLayoutParams {
  preheader?: string;
  title: string;
  bodyHtml: string;
  ctaText?: string;
  ctaUrl?: string;
  footerNote?: string;
  marca?: MarcaEmail;
}

/**
 * Layout master — todos templates passam pelo mesmo wrapper pra manter
 * identidade visual consistente.
 */
function layout(p: BaseLayoutParams): string {
  return p.marca ? layoutDoTenant(p, p.marca) : layoutGenerico(p);
}

/**
 * Layout com a marca da empresa — o que o cliente final vê.
 *
 * Três decisões que não são estéticas, e que quebram em silêncio se alguém
 * "melhorar" depois:
 *  - **textura do cabeçalho é IMAGEM, nunca CSS**: Outlook não renderiza
 *    gradiente, e há `background-color` por trás — quem bloqueia imagem vê a cor
 *    sólida, não branco;
 *  - **sem webfont**: cliente de e-mail não carrega, então a pilha é a do sistema;
 *  - **botão em `<table>`**, não `<a>` solto: Outlook ignora padding em link inline.
 */
function layoutDoTenant(
  { preheader, title, bodyHtml, ctaText, ctaUrl, footerNote }: BaseLayoutParams,
  m: MarcaEmail,
): string {
  const acao = m.corAcao ?? m.corPrimaria;
  const textura = m.headerImgUrl
    ? `background-image:url('${escapeAttr(m.headerImgUrl)}');background-size:600px 90px;background-repeat:no-repeat;`
    : '';
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#e9eef3;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
${preheader ? `<div style="display:none;font-size:1px;max-height:0;opacity:0;overflow:hidden">${escapeHtml(preheader)}</div>` : ''}
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#e9eef3;"><tr>
<td align="center" style="padding:32px 12px;">
<table role="presentation" cellpadding="0" cellspacing="0" width="600" style="max-width:600px;background:#ffffff;">
 <tr><td style="background-color:${escapeAttr(m.corPrimaria)};${textura}padding:22px 44px;"><img src="${escapeAttr(m.logoUrl)}" height="40" alt="${escapeAttr(m.empresaNome)}" style="display:block;border:0;height:40px;width:auto;"></td></tr>
 <tr><td style="padding:40px 44px 6px 44px;">
   <p style="margin:0 0 20px 0;font-size:20px;line-height:1.4;color:${escapeAttr(m.corPrimaria)};font-weight:600;">${escapeHtml(title)}</p>
   ${bodyHtml}</td></tr>
 ${
   ctaText && ctaUrl
     ? `<tr><td style="padding:14px 44px 44px 44px;"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:${escapeAttr(acao)};"><a href="${escapeAttr(ctaUrl)}" style="display:inline-block;padding:15px 30px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;letter-spacing:.2px;">${escapeHtml(ctaText)}</a></td></tr></table></td></tr>`
     : ''
 }
 <tr><td style="background:${escapeAttr(m.corPrimaria)};padding:26px 44px;">
   <p style="margin:0 0 8px 0;font-size:11px;color:#ffffff;font-weight:700;letter-spacing:1.4px;">${escapeHtml(m.empresaNome)}</p>
   <p style="margin:0;font-size:11px;line-height:1.7;color:#93a4b5;">${escapeHtml(footerNote ?? m.rodape ?? '')}</p></td></tr>
</table></td></tr></table></body></html>`;
}

function layoutGenerico({
  preheader,
  title,
  bodyHtml,
  ctaText,
  ctaUrl,
  footerNote,
}: BaseLayoutParams): string {
  return `<!doctype html>
<html lang="pt-br">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:${COLOR_BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:${COLOR_TEXT};">
  ${preheader ? `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden">${escapeHtml(preheader)}</div>` : ''}
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:${COLOR_BG};">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="600" style="max-width:600px;background:#ffffff;border:1px solid ${COLOR_BORDER};border-radius:8px;">
          <tr>
            <td style="padding:24px 28px 8px 28px;">
              <div style="font-size:14px;font-weight:700;color:${COLOR_PRIMARY};letter-spacing:0.3px;text-transform:uppercase;">Betinna.ai</div>
            </td>
          </tr>
          <tr>
            <td style="padding:0 28px;">
              <h1 style="margin:0 0 12px 0;font-size:20px;color:${COLOR_TEXT};font-weight:700;line-height:1.3;">${escapeHtml(title)}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:0 28px 12px 28px;font-size:14px;line-height:1.55;color:${COLOR_TEXT};">
              ${bodyHtml}
            </td>
          </tr>
          ${
            ctaText && ctaUrl
              ? `<tr>
            <td align="left" style="padding:6px 28px 24px 28px;">
              <a href="${escapeAttr(ctaUrl)}" style="display:inline-block;background:${COLOR_PRIMARY};color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;font-size:14px;font-weight:600;">${escapeHtml(ctaText)}</a>
            </td>
          </tr>`
              : ''
          }
          <tr>
            <td style="padding:12px 28px 20px 28px;border-top:1px solid ${COLOR_BORDER};">
              <p style="margin:0;font-size:11px;color:${COLOR_MUTED};line-height:1.5;">
                ${footerNote ? escapeHtml(footerNote) : 'Você está recebendo este e-mail porque é usuário do Betinna.ai.'}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ─── Templates ──────────────────────────────────────────────────────────────

export interface BoasVindasParams {
  nome: string;
  empresaNome: string;
  loginUrl: string;
  /** Marca do tenant (opt-in): sem ela, o layout genérico. */
  marca?: MarcaEmail;
}

/**
 * Nome que aparece PRO DESTINATÁRIO. Com marca de tenant, é a empresa dele;
 * sem marca, é o app. Cravar "Betinna.ai" no texto vazava o nome do produto
 * para dentro de um e-mail já vestido com a marca do cliente — mesma classe do
 * "Master Block" no template de rastreio, na direção oposta.
 */
function nomeVisivel(marca?: MarcaEmail, empresaNome?: string): string {
  return marca?.empresaNome ?? empresaNome ?? 'Betinna.ai';
}

/**
 * Template: Boas-vindas (novo usuário acabou de aceitar convite).
 */
export function templateBoasVindas(p: BoasVindasParams): { assunto: string; html: string } {
  return {
    assunto: `Bem-vindo(a) ao ${nomeVisivel(p.marca, p.empresaNome)}, ${p.nome}!`,
    html: layout({
      marca: p.marca,
      preheader: `Seu acesso ao ${p.empresaNome} está pronto.`,
      title: `Bem-vindo(a), ${p.nome}!`,
      bodyHtml: `
        <p>Sua conta no <strong>${escapeHtml(p.empresaNome)}</strong> está ativa.</p>
        <p>Aqui ficam CRM, pedidos, atendimento multicanal e automação comercial num app só — adaptado pra forma como sua empresa vende.</p>
        <p>Acesse agora pra completar o tour de onboarding e configurar seu perfil:</p>
      `,
      ctaText: 'Acessar minha conta',
      ctaUrl: p.loginUrl,
    }),
  };
}

export interface ReenvioConviteParams {
  nome: string;
  empresaNome: string;
  /** URL completa do action link do Supabase (já com token embutido). */
  inviteUrl: string;
  /** Marca do tenant (opt-in): sem ela, o layout genérico. */
  marca?: MarcaEmail;
}

/**
 * Template: reenvio de convite — usado quando um usuário PENDENTE ainda
 * não definiu a senha e o admin/diretor clica em "Reenviar convite". O
 * `inviteUrl` aqui já vem do Supabase `admin.generateLink({type:'invite'})`
 * (Lote 4 / U2 fix — 2026-05-23).
 */
export function templateReenvioConvite(p: ReenvioConviteParams): {
  assunto: string;
  html: string;
} {
  return {
    assunto: `Reenvio do convite — ${p.empresaNome}`,
    html: layout({
      marca: p.marca,
      preheader: `Clique pra definir sua senha e acessar o ${p.empresaNome}.`,
      title: `Olá, ${escapeHtml(p.nome)} 👋`,
      bodyHtml: `
        <p>Você foi convidado(a) pra acessar o <strong>${escapeHtml(p.empresaNome)}</strong>.</p>
        <p>Como o convite anterior expirou ou não foi finalizado, segue um link novo válido por 24h:</p>
        <p style="font-size:13px;color:#6b6580;">Se você não esperava este e-mail, pode ignorar.</p>
      `,
      ctaText: 'Definir senha e entrar',
      ctaUrl: p.inviteUrl,
    }),
  };
}

export interface RecuperarSenhaParams {
  nome: string;
  /** URL completa do action link do Supabase (já com token embutido). */
  resetUrl: string;
  /** Marca do tenant (opt-in): sem ela, o layout genérico. */
  marca?: MarcaEmail;
}

/**
 * Template: quem clicou em "Esqueceu sua senha?" na tela de login.
 *
 * Sem promessa de prazo no corpo além do que o Supabase realmente pratica, e
 * com a linha do "se não foi você": este é o e-mail que mais chega a quem NÃO
 * pediu, porque basta alguém digitar o endereço de outra pessoa.
 */
export function templateRecuperarSenha(p: RecuperarSenhaParams): {
  assunto: string;
  html: string;
} {
  return {
    assunto: `Redefinir sua senha — ${nomeVisivel(p.marca)}`,
    html: layout({
      marca: p.marca,
      preheader: 'Link pra criar uma senha nova.',
      title: `Olá, ${escapeHtml(p.nome)}`,
      bodyHtml: `
        <p>Recebemos um pedido pra redefinir a senha da sua conta.</p>
        <p>Clique no botão abaixo pra criar uma senha nova. O link vale por 1 hora e só pode ser usado uma vez.</p>
        <p style="font-size:13px;color:#6b6580;">Se não foi você que pediu, ignore este e-mail — sua senha atual continua valendo e nada muda.</p>
      `,
      ctaText: 'Criar senha nova',
      ctaUrl: p.resetUrl,
    }),
  };
}

export interface AprovacaoResolvidaParams {
  repNome: string;
  pedidoNumero: string;
  status: 'APROVADA' | 'REJEITADA';
  comentario?: string | null;
  pedidoUrl: string;
  /** Marca do tenant (opt-in): sem ela, o layout genérico. */
  marca?: MarcaEmail;
}

/**
 * Template: REP recebe quando GERENTE decide aprovação de desconto.
 */
export function templateAprovacaoResolvida(p: AprovacaoResolvidaParams): {
  assunto: string;
  html: string;
} {
  const isOk = p.status === 'APROVADA';
  const cor = isOk ? COLOR_SUCCESS : COLOR_DANGER;
  const label = isOk ? 'aprovado' : 'rejeitado';

  return {
    assunto: `Pedido ${p.pedidoNumero} ${label}`,
    html: layout({
      marca: p.marca,
      preheader: `Seu pedido ${p.pedidoNumero} foi ${label}.`,
      title: `Pedido ${p.pedidoNumero} ${label}`,
      bodyHtml: `
        <p>Olá ${escapeHtml(p.repNome)},</p>
        <p>A solicitação de desconto do <strong>pedido ${escapeHtml(p.pedidoNumero)}</strong> foi <span style="color:${cor};font-weight:600;">${label.toUpperCase()}</span>.</p>
        ${
          p.comentario
            ? `<p style="background:${COLOR_BG};border-left:3px solid ${cor};padding:10px 14px;margin:12px 0;color:${COLOR_TEXT};"><em>Motivo:</em> ${escapeHtml(p.comentario)}</p>`
            : ''
        }
        <p>${
          isOk
            ? 'Você pode enviar o pedido ao ERP agora.'
            : 'O pedido foi cancelado automaticamente. Refaça com desconto compatível com seu teto, ou justifique melhor e refaça a solicitação.'
        }</p>
      `,
      ctaText: 'Ver pedido',
      ctaUrl: p.pedidoUrl,
    }),
  };
}

export interface ComissaoFechadaParams {
  repNome: string;
  mes: number;
  ano: number;
  totalVendas: number;
  totalComissao: number;
  comissoesUrl: string;
  /** Marca do tenant (opt-in): sem ela, o layout genérico. */
  marca?: MarcaEmail;
}

export function templateComissaoFechada(p: ComissaoFechadaParams): {
  assunto: string;
  html: string;
} {
  const mesNome = nomeMes(p.mes);
  return {
    assunto: `Comissão ${mesNome}/${p.ano} fechada`,
    html: layout({
      marca: p.marca,
      preheader: `Sua comissão de ${mesNome}/${p.ano} está disponível.`,
      title: `Comissão ${mesNome}/${p.ano} fechada`,
      bodyHtml: `
        <p>Olá ${escapeHtml(p.repNome)},</p>
        <p>O fechamento de comissão de <strong>${mesNome}/${p.ano}</strong> foi concluído.</p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:14px 0;">
          <tr>
            <td style="padding:6px 14px 6px 0;color:${COLOR_MUTED};font-size:13px;">Total de vendas</td>
            <td style="padding:6px 0;font-size:14px;font-weight:600;">R$ ${formatMoney(p.totalVendas)}</td>
          </tr>
          <tr>
            <td style="padding:6px 14px 6px 0;color:${COLOR_MUTED};font-size:13px;">Comissão</td>
            <td style="padding:6px 0;font-size:14px;font-weight:600;color:${COLOR_SUCCESS};">R$ ${formatMoney(p.totalComissao)}</td>
          </tr>
        </table>
        <p>O pagamento será processado pelo diretor conforme cronograma da empresa.</p>
      `,
      ctaText: 'Ver detalhes',
      ctaUrl: p.comissoesUrl,
    }),
  };
}

export interface OcorrenciaCriticaParams {
  destinatarioNome: string;
  numero: string;
  titulo: string;
  severidade: 'CRITICA' | 'ALTA';
  slaHoras: number;
  ocorrenciaUrl: string;
  /** Marca do tenant (opt-in): sem ela, o layout genérico. */
  marca?: MarcaEmail;
}

export function templateOcorrenciaCritica(p: OcorrenciaCriticaParams): {
  assunto: string;
  html: string;
} {
  return {
    assunto: `[${p.severidade}] ${p.numero}: ${truncate(p.titulo, 60)}`,
    html: layout({
      marca: p.marca,
      preheader: `Ocorrência ${p.severidade.toLowerCase()} aberta — SLA ${p.slaHoras}h.`,
      title: `Ocorrência ${p.severidade.toLowerCase()} aberta`,
      bodyHtml: `
        <p>Olá ${escapeHtml(p.destinatarioNome)},</p>
        <p>A ocorrência <strong>${escapeHtml(p.numero)}</strong> foi aberta com severidade <strong style="color:${COLOR_DANGER};">${p.severidade}</strong>.</p>
        <p style="background:${COLOR_BG};border-left:3px solid ${COLOR_DANGER};padding:10px 14px;margin:12px 0;">${escapeHtml(p.titulo)}</p>
        <p>SLA de resposta: <strong>${p.slaHoras} hora${p.slaHoras === 1 ? '' : 's'}</strong>.</p>
      `,
      ctaText: 'Abrir ocorrência',
      ctaUrl: p.ocorrenciaUrl,
      footerNote:
        'Ocorrências críticas/altas geram notificação automática para evitar perda de SLA.',
    }),
  };
}

export interface AmostraFollowupParams {
  repNome: string;
  clienteNome: string;
  produtoNome: string;
  diasDesdeEnvio: number;
  amostrasUrl: string;
  /** Marca do tenant (opt-in): sem ela, o layout genérico. */
  marca?: MarcaEmail;
}

export function templateAmostraFollowup(p: AmostraFollowupParams): {
  assunto: string;
  html: string;
} {
  return {
    assunto: `Follow-up: amostra ${p.produtoNome} para ${p.clienteNome}`,
    html: layout({
      marca: p.marca,
      preheader: `${p.diasDesdeEnvio} dias desde o envio — hora de fazer follow-up.`,
      title: 'Hora de fazer follow-up',
      bodyHtml: `
        <p>Olá ${escapeHtml(p.repNome)},</p>
        <p>A amostra de <strong>${escapeHtml(p.produtoNome)}</strong> enviada para <strong>${escapeHtml(p.clienteNome)}</strong> está há <strong>${p.diasDesdeEnvio} dias</strong> sem retorno.</p>
        <p>Vale uma ligação ou mensagem pra entender o feedback e capturar pedido enquanto a memória do produto ainda tá fresca.</p>
      `,
      ctaText: 'Ver amostra',
      ctaUrl: p.amostrasUrl,
    }),
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}

function formatMoney(n: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function nomeMes(m: number): string {
  return (
    [
      'Janeiro',
      'Fevereiro',
      'Março',
      'Abril',
      'Maio',
      'Junho',
      'Julho',
      'Agosto',
      'Setembro',
      'Outubro',
      'Novembro',
      'Dezembro',
    ][m - 1] ?? String(m)
  );
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + '…';
}

/**
 * Rodapé de descadastro — só pra e-mail de MARKETING (campanha, régua de
 * nutrição). Transacional não recebe: quem saiu da lista continua precisando
 * saber onde está o pedido que fez.
 *
 * Vai como bloco anexado ao HTML já montado, porque o corpo do marketing é
 * escrito fora daqui (editor de campanha / nó do fluxo) e não passa pelo
 * `layout()`.
 */
export interface PedidoRastreioParams {
  nome: string;
  numeroPedido: string;
  codigo: string;
  url: string;
  /** Marca do tenant (opt-in): sem ela, o layout genérico. */
  marca?: MarcaEmail;
}

/**
 * Template: pedido despachado, com o código E o link.
 *
 * É TRANSACIONAL — não leva descadastro. Quem saiu da lista de marketing
 * continua precisando saber onde está a encomenda que comprou.
 *
 * O e-mail do ERP mandava só o número do código ("O código de rastreio referente
 * ao Pedido 42 é 6090626777959"), sem link e sem dizer o que fazer com aquilo —
 * num pedido de equipamento industrial isso é atrito à toa.
 */
export function templatePedidoRastreio(p: PedidoRastreioParams): {
  assunto: string;
  html: string;
} {
  return {
    assunto: `Seu pedido ${p.numeroPedido} foi despachado`,
    html: layout({
      marca: p.marca,
      preheader: `Código de rastreio ${p.codigo}`,
      // NADA de nome de produto aqui: este template serve qualquer tenant, e
      // "Master Block" é da Somatec. Escapou uma vez porque não tem a palavra
      // "Somatec" — é a mesma classe do risco de hardcodar marca.
      title: `Seu pedido ${escapeHtml(p.numeroPedido)} foi despachado`,
      bodyHtml: `
        <p style="margin:0 0 12px 0;">Olá, ${escapeHtml(p.nome)}.</p>
        <p style="margin:0 0 12px 0;">O pedido <strong>${escapeHtml(p.numeroPedido)}</strong> saiu para entrega.</p>
        <p style="margin:0 0 12px 0;">Código de rastreio: <strong>${escapeHtml(p.codigo)}</strong></p>
        <p style="margin:0 0 12px 0;">Se a página pedir o código, é esse mesmo aí de cima.</p>
        <p style="margin:0;">Qualquer dúvida sobre a entrega, é só responder este e-mail.</p>`,
      ctaText: 'Acompanhar a entrega',
      ctaUrl: p.url,
      footerNote: 'Você está recebendo este e-mail porque fez um pedido conosco.',
    }),
  };
}

export const SLOT_DESCADASTRO = '<!-- SLOT_DESCADASTRO -->';

/**
 * Link INLINE pro slot que os e-mails de marketing já trazem no rodapé.
 *
 * Quando o corpo tem `<!-- SLOT_DESCADASTRO -->`, o link entra ALI — dentro do
 * rodapé que o autor desenhou, herdando a cor dele. Anexar o bloco genérico
 * depois de um rodapé navy da Somatec deixaria um retângulo cinza pendurado no
 * fim do e-mail.
 */
export function linkDescadastroInline(url: string): string {
  return ` <a href="${escapeAttr(url)}" style="color:inherit;text-decoration:underline;">Não quero mais receber estes e-mails</a>.`;
}

/** Bloco autônomo — pro corpo que NÃO tem o slot (campanha antiga, e-mail simples). */
export function rodapeDescadastro(url: string): string {
  // Duas tabelas de propósito: o Outlook desktop renderiza com o motor do WORD,
  // que descarta `margin` e `max-width` em <table>. Sem a externa, o bloco cola
  // no conteúdo de cima e encosta à esquerda; sem o `width="600"` ATRIBUTO (não
  // CSS) na interna, ele estica além da largura do e-mail em tela larga.
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%">
  <tr><td align="center" style="padding-top:16px;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="600" style="width:100%;max-width:600px;">
  <tr><td style="padding:12px 28px 20px 28px;border-top:1px solid ${COLOR_BORDER};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
    <p style="margin:0;font-size:11px;color:${COLOR_MUTED};line-height:1.5;">
      Não quer mais receber estes e-mails?
      <a href="${escapeAttr(url)}" style="color:${COLOR_MUTED};text-decoration:underline;">Cancelar o envio</a>.
      Avisos sobre pedidos que você fizer continuam chegando.
    </p>
  </td></tr>
</table>
  </td></tr>
</table>`;
}
