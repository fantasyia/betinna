/**
 * Templates de e-mail transacional embutidos no app (HTML inline).
 *
 * Por quê não usar templates dinâmicos do SendGrid (d-...)?
 *  - Templates dinâmicos exigem criação no dashboard SendGrid + deploy
 *    coordenado. Pra MVP é fricção desnecessária.
 *  - HTML inline = versionável no git, testável local, deploy em 1 commit.
 *  - Migração futura pra templates dinâmicos é trivial (basta trocar a chamada
 *    `enviar` por `enviar({ templateId, variaveis })`).
 *
 * Design:
 *  - Layout simples table-based (compatível com Gmail, Outlook, mobile clients)
 *  - Sem CSS externo (alguns clientes strip <style>)
 *  - Width 600px (padrão)
 *  - CTA único (botão) — tira atrito
 *  - Footer com unsubscribe placeholder (sistema ainda não tem opt-out)
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

interface BaseLayoutParams {
  preheader?: string;
  title: string;
  bodyHtml: string;
  ctaText?: string;
  ctaUrl?: string;
  footerNote?: string;
}

/**
 * Layout master — todos templates passam pelo mesmo wrapper pra manter
 * identidade visual consistente.
 */
function layout({
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
}

/**
 * Template: Boas-vindas (novo usuário acabou de aceitar convite).
 */
export function templateBoasVindas(p: BoasVindasParams): { assunto: string; html: string } {
  return {
    assunto: `Bem-vindo(a) ao Betinna.ai, ${p.nome}!`,
    html: layout({
      preheader: `Seu acesso ao ${p.empresaNome} está pronto.`,
      title: `Bem-vindo(a), ${p.nome}!`,
      bodyHtml: `
        <p>Sua conta no <strong>${escapeHtml(p.empresaNome)}</strong> está ativa.</p>
        <p>O Betinna.ai centraliza CRM, pedidos, atendimento multicanal e automação comercial em um único app — adaptado pra forma como sua empresa vende.</p>
        <p>Acesse agora pra completar o tour de onboarding e configurar seu perfil:</p>
      `,
      ctaText: 'Acessar Betinna.ai',
      ctaUrl: p.loginUrl,
    }),
  };
}

export interface ReenvioConviteParams {
  nome: string;
  empresaNome: string;
  /** URL completa do action link do Supabase (já com token embutido). */
  inviteUrl: string;
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
    assunto: `Reenvio do convite — Betinna.ai (${p.empresaNome})`,
    html: layout({
      preheader: `Clique pra definir sua senha e acessar o ${p.empresaNome}.`,
      title: `Olá, ${escapeHtml(p.nome)} 👋`,
      bodyHtml: `
        <p>Você foi convidado(a) pra acessar o <strong>${escapeHtml(p.empresaNome)}</strong> no Betinna.ai.</p>
        <p>Como o convite anterior expirou ou não foi finalizado, segue um link novo válido por 24h:</p>
        <p style="font-size:13px;color:#6b6580;">Se você não esperava este e-mail, pode ignorar.</p>
      `,
      ctaText: 'Definir senha e entrar',
      ctaUrl: p.inviteUrl,
    }),
  };
}

export interface AprovacaoResolvidaParams {
  repNome: string;
  pedidoNumero: string;
  status: 'APROVADA' | 'REJEITADA';
  comentario?: string | null;
  pedidoUrl: string;
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
            ? 'Você pode enviar o pedido ao OMIE agora.'
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
}

export function templateComissaoFechada(p: ComissaoFechadaParams): {
  assunto: string;
  html: string;
} {
  const mesNome = nomeMes(p.mes);
  return {
    assunto: `Comissão ${mesNome}/${p.ano} fechada`,
    html: layout({
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
}

export function templateOcorrenciaCritica(p: OcorrenciaCriticaParams): {
  assunto: string;
  html: string;
} {
  return {
    assunto: `[${p.severidade}] ${p.numero}: ${truncate(p.titulo, 60)}`,
    html: layout({
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
}

export function templateAmostraFollowup(p: AmostraFollowupParams): {
  assunto: string;
  html: string;
} {
  return {
    assunto: `Follow-up: amostra ${p.produtoNome} para ${p.clienteNome}`,
    html: layout({
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
