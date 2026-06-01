import { Injectable, Logger } from '@nestjs/common';
import { EnvService } from '@config/env.service';
import { ResendService } from '@integrations/resend/resend.service';
import {
  templateAmostraFollowup,
  templateAprovacaoResolvida,
  templateBoasVindas,
  templateComissaoFechada,
  templateOcorrenciaCritica,
  templateReenvioConvite,
} from './email-templates';

/**
 * TransactionalEmailService — fachada de alto nível pros e-mails do sistema.
 *
 * Encapsula:
 *  - Construção da `frontendUrl` (deep links nos botões)
 *  - Escolha do template correto
 *  - Chamada do provider: Resend (resend.com), provedor sistêmico ÚNICO
 *
 * Decisão Leo 2026-05-24: usar Resend como provider sistêmico (API mais
 * simples, free tier 100/dia generoso). SendGrid foi removido por completo.
 */
@Injectable()
export class TransactionalEmailService {
  private readonly logger = new Logger(TransactionalEmailService.name);

  constructor(
    private readonly resend: ResendService,
    private readonly env: EnvService,
  ) {}

  /** Resolve URL pública do frontend pra deep-links. */
  private frontendUrl(): string {
    const fromEnv = this.env.get('FRONTEND_URL');
    if (fromEnv) return fromEnv.replace(/\/$/, '');
    const cors = this.env.get('CORS_ORIGINS').split(',')[0]?.trim();
    return (cors ?? 'http://localhost:3000').replace(/\/$/, '');
  }

  private safeUrl(path: string): string {
    const base = this.frontendUrl();
    const safe = path.startsWith('/') ? path : `/${path}`;
    return `${base}${safe}`;
  }

  private async send(
    para: string,
    assunto: string,
    html: string,
  ): Promise<{ ok: boolean; motivo?: string }> {
    // Resend é o ÚNICO provedor transacional do sistema (SendGrid removido).
    const ctx = `para=${para} assunto="${assunto.slice(0, 60)}"`;

    if (!this.resend.isConfigured()) {
      const motivo =
        'Resend não configurado (defina RESEND_API_KEY e RESEND_FROM_EMAIL no Railway)';
      this.logger.error(`E-mail NÃO enviado · ${ctx} · ${motivo}`);
      return { ok: false, motivo };
    }

    try {
      const r = await this.resend.enviar({ para, assunto, html });
      const ok = r.status >= 200 && r.status < 300;
      if (!ok) {
        const motivo = `provedor retornou HTTP ${r.status}`;
        this.logger.error(`E-mail falhou · ${ctx} · ${motivo}`);
        return { ok: false, motivo };
      }
      return { ok: true };
    } catch (err) {
      const motivo = err instanceof Error ? err.message : String(err);
      this.logger.error(`E-mail falhou (Resend) · ${ctx} · ${motivo}`);
      return { ok: false, motivo };
    }
  }

  // ─── Templates de alto nível ─────────────────────────────────────────

  async enviarBoasVindas(params: { para: string; nome: string; empresaNome: string }) {
    const { assunto, html } = templateBoasVindas({
      nome: params.nome,
      empresaNome: params.empresaNome,
      loginUrl: this.safeUrl('/login'),
    });
    return this.send(params.para, assunto, html);
  }

  async enviarReenvioConvite(params: {
    para: string;
    nome: string;
    empresaNome: string;
    inviteUrl: string;
  }) {
    const { assunto, html } = templateReenvioConvite({
      nome: params.nome,
      empresaNome: params.empresaNome,
      inviteUrl: params.inviteUrl,
    });
    return this.send(params.para, assunto, html);
  }

  async enviarAprovacaoResolvida(params: {
    para: string;
    repNome: string;
    pedidoId: string;
    pedidoNumero: string;
    status: 'APROVADA' | 'REJEITADA';
    comentario?: string | null;
  }) {
    const { assunto, html } = templateAprovacaoResolvida({
      repNome: params.repNome,
      pedidoNumero: params.pedidoNumero,
      status: params.status,
      comentario: params.comentario,
      pedidoUrl: this.safeUrl(`/pedidos/${params.pedidoId}`),
    });
    return this.send(params.para, assunto, html);
  }

  async enviarComissaoFechada(params: {
    para: string;
    repNome: string;
    mes: number;
    ano: number;
    totalVendas: number;
    totalComissao: number;
  }) {
    const { assunto, html } = templateComissaoFechada({
      repNome: params.repNome,
      mes: params.mes,
      ano: params.ano,
      totalVendas: params.totalVendas,
      totalComissao: params.totalComissao,
      comissoesUrl: this.safeUrl('/comissoes'),
    });
    return this.send(params.para, assunto, html);
  }

  async enviarOcorrenciaCritica(params: {
    para: string;
    destinatarioNome: string;
    ocorrenciaId: string;
    numero: string;
    titulo: string;
    severidade: 'CRITICA' | 'ALTA';
    slaHoras: number;
  }) {
    const { assunto, html } = templateOcorrenciaCritica({
      destinatarioNome: params.destinatarioNome,
      numero: params.numero,
      titulo: params.titulo,
      severidade: params.severidade,
      slaHoras: params.slaHoras,
      ocorrenciaUrl: this.safeUrl(`/ocorrencias/${params.ocorrenciaId}`),
    });
    return this.send(params.para, assunto, html);
  }

  async enviarAmostraFollowup(params: {
    para: string;
    repNome: string;
    clienteNome: string;
    produtoNome: string;
    diasDesdeEnvio: number;
  }) {
    const { assunto, html } = templateAmostraFollowup({
      repNome: params.repNome,
      clienteNome: params.clienteNome,
      produtoNome: params.produtoNome,
      diasDesdeEnvio: params.diasDesdeEnvio,
      amostrasUrl: this.safeUrl('/amostras'),
    });
    return this.send(params.para, assunto, html);
  }

  /**
   * Alerta operacional do sistema (ex: falha de backup). HTML inline simples —
   * não é e-mail de cliente, é aviso interno pro responsável técnico.
   */
  async enviarAlertaSistema(params: {
    para: string;
    assunto: string;
    titulo: string;
    mensagem: string;
  }) {
    const html = `<!doctype html>
<html lang="pt-BR"><body style="margin:0;background:#f4f4f7;font-family:Arial,Helvetica,sans-serif;color:#201554">
  <div style="max-width:560px;margin:24px auto;background:#fff;border-radius:10px;overflow:hidden;border:1px solid #eee">
    <div style="background:#201554;padding:16px 24px">
      <span style="color:#fff;font-size:18px;font-weight:bold">Betinna.ai · Alerta do sistema</span>
    </div>
    <div style="padding:24px">
      <h2 style="margin:0 0 12px;font-size:18px;color:#bd1fbf">${params.titulo}</h2>
      <div style="font-size:14px;line-height:1.6">${params.mensagem}</div>
    </div>
    <div style="padding:14px 24px;background:#fafafa;border-top:1px solid #eee;font-size:12px;color:#888">
      Mensagem automática — não responda este e-mail.
    </div>
  </div>
</body></html>`;
    return this.send(params.para, params.assunto, html);
  }
}
