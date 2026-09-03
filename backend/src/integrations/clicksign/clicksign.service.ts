import { Injectable, Logger } from '@nestjs/common';
import { EnvService } from '@config/env.service';
import { HttpClientService } from '@shared/http/http-client.service';
import { IntegrationException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';

export interface SignatarioContrato {
  /** Nome de PESSOA. Razão social é recusada pela API ("formato inválido"). */
  nome: string;
  email: string;
}

export interface ContratoParaAssinar {
  /** Aparece na lista de envelopes e no e-mail do signatário. */
  titulo: string;
  /** Valores das variáveis `{{...}}` do modelo. */
  variaveis: Record<string, string>;
  /** O cliente. Assina primeiro. */
  cliente: SignatarioContrato;
}

export interface EnvelopeCriado {
  envelopeId: string;
  documentoId: string;
  signatarios: Array<{ id: string; email: string; automatico: boolean }>;
}

/**
 * Assinatura eletrônica do contrato (ClickSign).
 *
 * **O texto do contrato NÃO mora aqui.** Ele é um *Modelo* dentro do ClickSign,
 * com variáveis `{{...}}`; o app manda só os dados que mudam por cliente. Isso é
 * decisão de desenho, não preguiça: quando o jurídico mexer numa cláusula, o
 * Léo edita no painel e nada aqui precisa de deploy. Se o texto morasse no
 * nosso código, cada vírgula viraria commit, build e espera.
 *
 * A API é a v3, em JSON:API — daí o `data.type/attributes` em tudo. O token vai
 * na query, não no header (é como a ClickSign autentica).
 *
 * Sequência de um contrato: envelope → documento a partir do modelo →
 * signatários → requisitos (autenticação + concordância) → dispara.
 */
@Injectable()
export class ClickSignService {
  private readonly logger = new Logger(ClickSignService.name);

  constructor(
    private readonly env: EnvService,
    private readonly http: HttpClientService,
  ) {}

  /** `false` quando o tenant ainda não tem assinatura eletrônica ligada. */
  get configurado(): boolean {
    return Boolean(this.token) && Boolean(this.modelo);
  }

  /**
   * Lê a variável tolerando os erros de paste que já aconteceram neste projeto:
   *
   * - o NOME da variável colado junto do valor (`CORS_ORIGINS=http://...`);
   * - aspas em volta;
   * - **os sinais `<>` do exemplo**, quando alguém cola o valor DENTRO do
   *   `<coloque-aqui>` da instrução em vez de no lugar dele. Foi o que
   *   aconteceu em 03/09: o token ficou com 38 caracteres em vez de 36 e a
   *   ClickSign devolveu 401.
   *
   * Um token com lixo invisível não quebra nada visível — só faz o contrato não
   * sair, que é a falha mais cara de diagnosticar.
   */
  private ler(chave: string): string {
    const bruto = this.env.get(chave as never) as string | undefined;
    if (!bruto) return '';
    return bruto
      .trim()
      .replace(/^[A-Z0-9_]+=/, '')
      .replace(/^['"<]+|['">]+$/g, '')
      .trim();
  }

  private get base(): string {
    return (this.ler('CLICKSIGN_API_URL') || 'https://app.clicksign.com').replace(/\/$/, '');
  }
  private get token(): string {
    return this.ler('CLICKSIGN_ACCESS_TOKEN');
  }
  private get modelo(): string {
    return this.ler('CLICKSIGN_TEMPLATE_KEY');
  }
  /** Quem assina pela casa. É signatário de verdade, não imagem no documento. */
  private get somatec(): SignatarioContrato | null {
    const nome = this.ler('CLICKSIGN_SIGNATARIO_NOME');
    const email = this.ler('CLICKSIGN_SIGNATARIO_EMAIL');
    return nome && email ? { nome, email } : null;
  }

  /**
   * Monta o contrato e MANDA PRA ASSINAR.
   *
   * Só deve ser chamado DEPOIS do aceite do cliente — mandar contrato pra quem
   * ainda não aceitou a proposta inverte a conversa comercial.
   */
  async enviarParaAssinatura(dados: ContratoParaAssinar): Promise<EnvelopeCriado> {
    if (!this.configurado) {
      throw new IntegrationException(
        'ClickSign não configurado (falta CLICKSIGN_ACCESS_TOKEN e/ou CLICKSIGN_TEMPLATE_KEY)',
        ErrorCode.INTEGRATION_ERROR,
      );
    }

    const envelope = await this.chamar<{ data: { id: string } }>('POST', '/envelopes', {
      data: {
        type: 'envelopes',
        attributes: { name: dados.titulo, locale: 'pt-BR', auto_close: true },
      },
    });
    const envelopeId = envelope.data.id;

    const documento = await this.chamar<{ data: { id: string } }>(
      'POST',
      `/envelopes/${envelopeId}/documents`,
      {
        data: {
          type: 'documents',
          attributes: {
            // A API exige extensão .docx aqui — é o formato do modelo.
            filename: 'contrato.docx',
            template: { key: this.modelo, data: dados.variaveis },
          },
        },
      },
    );

    // Ordem importa: o cliente assina primeiro, a casa confirma depois.
    const paraAssinar: Array<SignatarioContrato & { automatico: boolean }> = [
      { ...dados.cliente, automatico: false },
      ...(this.somatec ? [{ ...this.somatec, automatico: true }] : []),
    ];
    const signatarios: Array<{ id: string; email: string; automatico: boolean }> = [];
    for (const s of paraAssinar) {
      const criado = await this.chamar<{ data: { id: string } }>(
        'POST',
        `/envelopes/${envelopeId}/signers`,
        {
          data: {
            type: 'signers',
            attributes: {
              name: s.nome,
              email: s.email,
              // `has_documentation` faz a ClickSign PEDIR o CPF na hora de
              // assinar. Não precisamos ter o dado: quem preenche é o
              // signatário, e é isso que dá identificação de verdade — com
              // `false`, assinar era só clicar num link de e-mail.
              has_documentation: !s.automatico,
              refusable: !s.automatico,
            },
          },
        },
      );
      signatarios.push({ id: criado.data.id, email: s.email, automatico: s.automatico });
    }

    // Requisitos por signatário: como ele se autentica e o ato de concordar.
    // Sem os dois, o envelope não sai do rascunho.
    //
    // A casa assina em AUTOMÁTICO (`auto_signature`): o Leandro é signatário de
    // verdade — tem log próprio, com data e autenticação — mas não precisa
    // clicar em nada. ⚠️ Exige o **Termo de Assinatura Automática** assinado uma
    // vez entre o administrador da conta e ele; sem o termo, a ClickSign recusa.
    // E `auto_signature` tem que ser a ÚNICA autenticação do signatário: a API
    // recusa qualquer outra junto.
    for (const s of signatarios) {
      const requisitos = s.automatico
        ? [
            { action: 'provide_evidence', auth: 'auto_signature' },
            { action: 'agree', role: 'sign' },
          ]
        : [
            { action: 'provide_evidence', auth: 'email' },
            { action: 'agree', role: 'sign' },
          ];
      for (const attributes of requisitos) {
        await this.chamar('POST', `/envelopes/${envelopeId}/requirements`, {
          data: {
            type: 'requirements',
            attributes,
            relationships: {
              document: { data: { type: 'documents', id: documento.data.id } },
              signer: { data: { type: 'signers', id: s.id } },
            },
          },
        });
      }
    }

    await this.chamar('PATCH', `/envelopes/${envelopeId}`, {
      data: { id: envelopeId, type: 'envelopes', attributes: { status: 'running' } },
    });

    // ⚠️ `running` NÃO manda e-mail. Descoberto na marra em 03/09: o envelope
    // ficou "em andamento" e nenhum signatário recebeu nada. O aviso é uma
    // chamada à parte — sem ela o contrato existe e ninguém fica sabendo, que é
    // a pior falha possível aqui (parece que funcionou).
    await this.chamar('POST', `/envelopes/${envelopeId}/notifications`, {
      data: {
        type: 'notifications',
        attributes: { message: 'Segue o contrato para assinatura eletrônica.' },
      },
    });

    this.logger.log(
      `Contrato enviado pra assinatura: envelope ${envelopeId} · ${signatarios.length} signatário(s)`,
    );
    return { envelopeId, documentoId: documento.data.id, signatarios };
  }

  /** Estado do envelope — usado pela varredura de pendentes. */
  async situacao(envelopeId: string): Promise<string | null> {
    const r = await this.chamar<{ data: { attributes: { status: string } } }>(
      'GET',
      `/envelopes/${envelopeId}`,
    );
    return r.data?.attributes?.status ?? null;
  }

  private async chamar<T = unknown>(
    metodo: 'GET' | 'POST' | 'PATCH',
    caminho: string,
    corpo?: unknown,
  ): Promise<T> {
    const url = `${this.base}/api/v3${caminho}${caminho.includes('?') ? '&' : '?'}access_token=${this.token}`;
    const opcoes = {
      headers: { 'Content-Type': 'application/vnd.api+json', Accept: 'application/vnd.api+json' },
      integration: 'clicksign',
      timeoutMs: 30_000,
      // Escrita não re-tenta: repetir um POST de envelope criaria contrato
      // duplicado na mão do cliente.
      retries: metodo === 'GET' ? 2 : 0,
    } as const;
    try {
      if (metodo === 'GET') return (await this.http.get<T>(url, opcoes)).data;
      if (metodo === 'PATCH')
        return (await this.http.patch<T>(url, { ...opcoes, body: corpo })).data;
      return (await this.http.post<T>(url, { ...opcoes, body: corpo })).data;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // 401 aqui é quase sempre token com lixo no valor, não token errado —
      // dizer isso na mensagem economiza meia hora de caça.
      const dica = /status 401/.test(msg)
        ? ' — token recusado. Confira se CLICKSIGN_ACCESS_TOKEN no ambiente tem só o valor ' +
          '(sem o nome da variável junto, sem aspas e sem espaço no fim).'
        : '';
      throw new IntegrationException(
        `ClickSign ${metodo} ${caminho}: ${msg.slice(0, 300)}${dica}`,
        ErrorCode.INTEGRATION_ERROR,
      );
    }
  }
}
