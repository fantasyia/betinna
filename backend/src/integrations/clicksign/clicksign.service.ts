import { Injectable, Logger } from '@nestjs/common';
import { EnvService } from '@config/env.service';
import { HttpClientService } from '@shared/http/http-client.service';
import { IntegracoesService } from '@modules/integracoes/integracoes.service';
import { IntegrationException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';

export interface SignatarioContrato {
  /** Nome de PESSOA. Razão social é recusada pela API ("formato inválido"). */
  nome: string;
  email: string;
  /** Só dígitos, com DDI: `5511999998888`. Com `+` na frente a API recusa. */
  telefone?: string;
  /** `YYYY-MM-DD`. Obrigatório na assinatura automática. */
  nascimento?: string;
  /** CPF. Obrigatório na assinatura automática. */
  documento?: string;
}

export interface ContratoParaAssinar {
  /** Aparece na lista de envelopes e no e-mail do signatário. */
  titulo: string;
  /**
   * Carimbo nosso no documento. Volta no webhook — é o que liga o retorno da
   * assinatura ao contrato daqui sem depender só de id.
   */
  metadata?: Record<string, string>;
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
/** Conta padrão da ClickSign, quando o tenant não informa outra. */
const BASE_PADRAO = 'https://app.clicksign.com';

/** Configuração efetiva da assinatura eletrônica de UMA empresa. */
export interface ConfigClickSign {
  base: string;
  token: string;
  modelo: string;
  canalToken: 'whatsapp' | 'sms' | 'email';
  somatec: SignatarioContrato | null;
  autoAssinatura: boolean;
  /** De onde a configuração veio — entra na mensagem de erro do 401. */
  origem: 'empresa' | 'ambiente';
}

/**
 * Tira do valor os erros de paste que já aconteceram neste projeto:
 *
 * - o NOME da variável colado junto do valor (`CORS_ORIGINS=http://...`);
 * - aspas em volta;
 * - **os sinais `<>` do exemplo**, quando alguém cola o valor DENTRO do
 *   `<coloque-aqui>` da instrução em vez de no lugar dele. Foi o que aconteceu
 *   em 03/09: o token ficou com 38 caracteres em vez de 36 e a ClickSign
 *   devolveu 401.
 *
 * Um token com lixo invisível não quebra nada visível — só faz o contrato não
 * sair, que é a falha mais cara de diagnosticar. Vale pras DUAS fontes: o campo
 * do app é colado pela mesma mão que colava no Railway.
 */
function limpar(bruto: unknown): string {
  if (typeof bruto !== 'string' || !bruto) return '';
  return bruto
    .trim()
    .replace(/^[A-Z0-9_]+=/, '')
    .replace(/^['"<]+|['">]+$/g, '')
    .trim();
}

/**
 * Canal do token de autenticação do CLIENTE: `whatsapp`, `sms` ou `email`.
 *
 * É UM só — a API trata os três como "requisito do tipo token" e recusa o
 * segundo. Fica configurável porque trocar o canal é decisão operacional (nem
 * todo cliente industrial tem WhatsApp no telefone do cadastro).
 */
function canalDeToken(v: string): 'whatsapp' | 'sms' | 'email' {
  const x = v.toLowerCase();
  return x === 'sms' || x === 'email' || x === 'whatsapp' ? x : 'whatsapp';
}

@Injectable()
export class ClickSignService {
  private readonly logger = new Logger(ClickSignService.name);

  constructor(
    private readonly env: EnvService,
    private readonly http: HttpClientService,
    private readonly integracoes: IntegracoesService,
  ) {}

  /** `false` quando a empresa ainda não tem assinatura eletrônica utilizável. */
  async configurado(empresaId: string): Promise<boolean> {
    const cfg = await this.resolver(empresaId);
    return Boolean(cfg.token) && Boolean(cfg.modelo);
  }

  private ler(chave: string): string {
    return limpar(this.env.get(chave as never));
  }

  /**
   * Credenciais guardadas do tenant, ou `null` quando ele não ligou a integração.
   *
   * `obterCredenciaisInternas` ESTOURA em "não configurada" e em "desativada" —
   * que lá são exceção e aqui são rotina: a maioria das empresas não tem
   * assinatura eletrônica ligada. Daí o catch.
   */
  private async credenciaisDaEmpresa(empresaId: string): Promise<Record<string, unknown> | null> {
    try {
      const conn = await this.integracoes.obterCredenciaisInternas(empresaId, 'clicksign');
      return conn.credenciais;
    } catch {
      return null;
    }
  }

  /**
   * Resolve a configuração da empresa: conexão cifrada do tenant, ou o ambiente.
   *
   * ⚠️ **A fonte é escolhida INTEIRA, nunca campo a campo.** Cair pro ambiente
   * em cada campo que faltar produz a pior combinação possível: o token de um
   * tenant com o signatário da casa de outro. Os dois são amarrados à CONTA da
   * ClickSign — o modelo do contrato, o Termo de Assinatura Automática e o
   * e-mail de quem assina só existem dentro dela. Misturar não dá erro nenhum:
   * dá contrato saindo pela conta errada, que ninguém descobre olhando log.
   *
   * O ambiente segue valendo como caminho de tenant único (é o estado de hoje:
   * a Somatec está no env do Railway). Ele para de ser lido no instante em que
   * a empresa conecta a própria conta pelo app.
   */
  private async resolver(empresaId: string): Promise<ConfigClickSign> {
    const guardadas = await this.credenciaisDaEmpresa(empresaId);
    return guardadas && limpar(guardadas.accessToken)
      ? ClickSignService.daEmpresa(guardadas)
      : this.doAmbiente();
  }

  private static daEmpresa(c: Record<string, unknown>): ConfigClickSign {
    const nome = limpar(c.signatarioNome);
    const email = limpar(c.signatarioEmail);
    return {
      base: (limpar(c.apiUrl) || BASE_PADRAO).replace(/\/$/, ''),
      token: limpar(c.accessToken),
      modelo: limpar(c.templateKey),
      canalToken: canalDeToken(limpar(c.authCanal)),
      somatec:
        nome && email
          ? {
              nome,
              email,
              nascimento: limpar(c.signatarioNascimento) || undefined,
              documento: limpar(c.signatarioDocumento) || undefined,
            }
          : null,
      // ⚠️ Vem de JSON: chega como booleano `false` OU como string "false"
      // (campo de formulário). Tratar só a string deixaria o booleano passar
      // como LIGADO — assinatura automática que o tenant desligou e continuou
      // valendo, sem nada acusando na tela.
      autoAssinatura:
        c.assinaturaAutomatica === false
          ? false
          : limpar(c.assinaturaAutomatica).toLowerCase() !== 'false',
      origem: 'empresa',
    };
  }

  /**
   * Configuração do ambiente (Railway) — o caminho de tenant único.
   *
   * ⚠️ A assinatura automática exige do signatário da casa **nome, e-mail, data
   * de nascimento e CPF** — não é opcional. Sem os quatro a ClickSign recusa, e
   * o contrato fica assinado só pelo cliente.
   */
  private doAmbiente(): ConfigClickSign {
    const nome = this.ler('CLICKSIGN_SIGNATARIO_NOME');
    const email = this.ler('CLICKSIGN_SIGNATARIO_EMAIL');
    return {
      base: (this.ler('CLICKSIGN_API_URL') || BASE_PADRAO).replace(/\/$/, ''),
      token: this.ler('CLICKSIGN_ACCESS_TOKEN'),
      modelo: this.ler('CLICKSIGN_TEMPLATE_KEY'),
      canalToken: canalDeToken(this.ler('CLICKSIGN_AUTH_CANAL')),
      somatec:
        nome && email
          ? {
              nome,
              email,
              nascimento: this.ler('CLICKSIGN_SIGNATARIO_NASCIMENTO') || undefined,
              documento: this.ler('CLICKSIGN_SIGNATARIO_DOCUMENTO') || undefined,
            }
          : null,
      autoAssinatura: this.ler('CLICKSIGN_SOMATEC_AUTO').toLowerCase() !== 'false',
      origem: 'ambiente',
    };
  }

  /**
   * Monta o contrato e MANDA PRA ASSINAR.
   *
   * Só deve ser chamado DEPOIS do aceite do cliente — mandar contrato pra quem
   * ainda não aceitou a proposta inverte a conversa comercial.
   */
  async enviarParaAssinatura(
    empresaId: string,
    dados: ContratoParaAssinar,
  ): Promise<EnvelopeCriado> {
    // Resolvida UMA vez e carregada pelo método inteiro: o contrato não pode
    // começar numa conta e terminar noutra se alguém trocar a integração no
    // meio do envio.
    const cfg = await this.resolver(empresaId);
    if (!cfg.token || !cfg.modelo) {
      throw new IntegrationException(
        cfg.origem === 'empresa'
          ? 'ClickSign da empresa sem token e/ou modelo de contrato na integração'
          : 'ClickSign não configurado (falta CLICKSIGN_ACCESS_TOKEN e/ou CLICKSIGN_TEMPLATE_KEY)',
        ErrorCode.INTEGRATION_ERROR,
      );
    }

    const envelope = await this.chamar<{ data: { id: string } }>(cfg, 'POST', '/envelopes', {
      data: {
        type: 'envelopes',
        attributes: { name: dados.titulo, locale: 'pt-BR', auto_close: true },
      },
    });
    const envelopeId = envelope.data.id;

    const documento = await this.chamar<{ data: { id: string } }>(
      cfg,
      'POST',
      `/envelopes/${envelopeId}/documents`,
      {
        data: {
          type: 'documents',
          attributes: {
            // A API exige extensão .docx aqui — é o formato do modelo.
            filename: 'contrato.docx',
            template: { key: cfg.modelo, data: dados.variaveis },
            ...(dados.metadata ? { metadata: dados.metadata } : {}),
          },
        },
      },
    );

    // Ordem importa: o cliente assina primeiro, a casa confirma depois.
    //
    // A assinatura automática da casa depende de um **Termo de Assinatura
    // Automática** assinado na conta — que não é self-service: pede-se ao
    // suporte da ClickSign. Enquanto o termo não existe, a assinatura automática
    // é RECUSADA e o contrato fica assinado só pelo cliente. Por isso a chave:
    // com ela desligada o Leandro entra como signatário normal e o fluxo roda
    // inteiro. É explícita de propósito — cair pro manual em silêncio esconderia
    // que o automático nunca funcionou.
    const paraAssinar: Array<SignatarioContrato & { automatico: boolean }> = [
      { ...dados.cliente, automatico: false },
      ...(cfg.somatec ? [{ ...cfg.somatec, automatico: cfg.autoAssinatura }] : []),
    ];
    const signatarios: Array<{
      id: string;
      email: string;
      automatico: boolean;
      telefone?: string;
    }> = [];
    for (const s of paraAssinar) {
      const criado = await this.chamar<{ data: { id: string } }>(
        cfg,
        'POST',
        `/envelopes/${envelopeId}/signers`,
        {
          data: {
            type: 'signers',
            attributes: {
              name: s.nome,
              email: s.email,
              ...(s.telefone ? { phone_number: s.telefone } : {}),
              ...(s.nascimento ? { birthday: s.nascimento } : {}),
              ...(s.documento ? { documentation: s.documento } : {}),
              // `has_documentation` faz a ClickSign PEDIR o CPF na hora de
              // assinar. Não precisamos ter o dado: quem preenche é o
              // signatário, e é isso que dá identificação de verdade — com
              // `false`, assinar era só clicar num link de e-mail.
              // Pro cliente, `true` faz a ClickSign PEDIR o CPF na hora de
              // assinar. Pra quem assina em automático não há "hora de
              // assinar" — o CPF tem que vir daqui, no `documentation`.
              has_documentation: s.automatico ? Boolean(s.documento) : true,
              refusable: !s.automatico,
            },
          },
        },
      );
      signatarios.push({
        id: criado.data.id,
        email: s.email,
        automatico: s.automatico,
        telefone: s.telefone,
      });
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
    //
    // ⚠️ A API impõe duas exclusividades, descobertas testando:
    //  1. `email`, `sms` e `whatsapp` são todos "token" — só UM por signatário
    //     ("já existe um requisito do tipo token");
    //  2. `official_document` NÃO anda junto de biometria facial ("não pode ser
    //     utilizado com facial_biometrics").
    // Ou seja: "WhatsApp E e-mail" não existe — é um ou outro. Fica o WhatsApp,
    // e sem telefone no cadastro cai pro e-mail: degradar a autenticação é
    // melhor que não conseguir mandar o contrato.
    for (const s of signatarios) {
      const token = s.telefone ? cfg.canalToken : 'email';
      const requisitos = s.automatico
        ? [
            { action: 'provide_evidence', auth: 'auto_signature' },
            { action: 'agree', role: 'sign' },
          ]
        : [
            // Só o token + o CPF que o signatário digita (`has_documentation`).
            // Biometria facial foi testada e funciona, mas o Léo tirou em
            // 04/09: contrato de 10 a 50 mil justifica mais que e-mail, e o
            // token no telefone já é um segundo canal — quem nega ter assinado
            // precisa explicar acesso ao celular E ao e-mail. Selfie com prova
            // de vida era atrito sem retorno proporcional.
            { action: 'provide_evidence', auth: token },
            { action: 'agree', role: 'sign' },
          ];
      for (const attributes of requisitos) {
        await this.chamar(cfg, 'POST', `/envelopes/${envelopeId}/requirements`, {
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

    await this.chamar(cfg, 'PATCH', `/envelopes/${envelopeId}`, {
      data: { id: envelopeId, type: 'envelopes', attributes: { status: 'running' } },
    });

    // ⚠️ `running` NÃO manda e-mail. Descoberto na marra em 03/09: o envelope
    // ficou "em andamento" e nenhum signatário recebeu nada. O aviso é uma
    // chamada à parte — sem ela o contrato existe e ninguém fica sabendo, que é
    // a pior falha possível aqui (parece que funcionou).
    await this.chamar(cfg, 'POST', `/envelopes/${envelopeId}/notifications`, {
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

  /**
   * Base da conta da empresa — a URL do PDF assinado é montada contra ela.
   *
   * Existe porque a ClickSign às vezes devolve o arquivo como CAMINHO relativo,
   * e montá-lo contra a base errada (sandbox × produção) dá download que falha
   * em silêncio: o contrato fica assinado e sem cópia local, sem nada acusando.
   */
  async baseDaEmpresa(empresaId: string): Promise<string> {
    return (await this.resolver(empresaId)).base;
  }

  /**
   * Estado do envelope, sob demanda.
   *
   * ⚠️ **Não existe "varredura de pendentes"** — o docblock dizia que existia e
   * mandava a próxima pessoa procurar um job que nunca foi escrito. E não deve
   * existir: a ClickSign PROÍBE polling em documentos, e desde 13/09/2026 os
   * três desfechos (assinado, recusado, prazo vencido) chegam por webhook. Isto
   * aqui é pra conferência pontual — "o que aconteceu com ESTE envelope?" —
   * quando há suspeita de webhook perdido.
   */
  async situacao(empresaId: string, envelopeId: string): Promise<string | null> {
    const r = await this.chamar<{ data: { attributes: { status: string } } }>(
      await this.resolver(empresaId),
      'GET',
      `/envelopes/${envelopeId}`,
    );
    return r.data?.attributes?.status ?? null;
  }

  private async chamar<T = unknown>(
    cfg: ConfigClickSign,
    metodo: 'GET' | 'POST' | 'PATCH',
    caminho: string,
    corpo?: unknown,
  ): Promise<T> {
    const url = `${cfg.base}/api/v3${caminho}${caminho.includes('?') ? '&' : '?'}access_token=${cfg.token}`;
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
      // 401 aqui é quase sempre token com lixo no valor, não token errado — e
      // dizer ONDE conferir importa agora que existem duas fontes possíveis.
      const onde =
        cfg.origem === 'empresa'
          ? 'o token guardado na integração ClickSign da empresa'
          : 'CLICKSIGN_ACCESS_TOKEN no ambiente';
      const dica = /status 401/.test(msg)
        ? ` — token recusado. Confira se ${onde} tem só o valor ` +
          '(sem o nome da variável junto, sem aspas e sem espaço no fim).'
        : '';
      throw new IntegrationException(
        `ClickSign ${metodo} ${caminho}: ${msg.slice(0, 300)}${dica}`,
        ErrorCode.INTEGRATION_ERROR,
      );
    }
  }
}
