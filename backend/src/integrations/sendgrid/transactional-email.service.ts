import { Injectable, Logger } from '@nestjs/common';
import { EnvService } from '@config/env.service';
import { SendGridService } from './sendgrid.service';
import {
  templateAmostraFollowup,
  templateAprovacaoResolvida,
  templateBoasVindas,
  templateComissaoFechada,
  templateOcorrenciaCritica,
} from './sendgrid-templates';

/**
 * TransactionalEmailService — fachada de alto nível pros e-mails do sistema.
 *
 * Encapsula:
 *  - Construção da `frontendUrl` (deep links nos botões)
 *  - Escolha do template correto
 *  - Chamada do SendGridService.enviarSistemico (chave corporativa do env)
 *  - Tratamento best-effort: falha de e-mail nunca derruba a operação
 *
 * Quando SendGrid não tem API key (env vazio), `enviarSistemico` loga warn
 * e retorna status 0 — feature degrada graciosamente.
 */
@Injectable()
export class TransactionalEmailService {
  private readonly logger = new Logger(TransactionalEmailService.name);

  constructor(
    private readonly sg: SendGridService,
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

  private async send(para: string, assunto: string, html: string): Promise<{ ok: boolean }> {
    try {
      const r = await this.sg.enviarSistemico({ para, assunto, html });
      return { ok: r.status >= 200 && r.status < 300 };
    } catch (err) {
      this.logger.warn(
        `Falha enviando e-mail (best-effort) para=${para} assunto="${assunto.slice(0, 60)}": ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return { ok: false };
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
}
