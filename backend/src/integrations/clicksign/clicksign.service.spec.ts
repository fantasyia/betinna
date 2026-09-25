import { describe, expect, it, vi } from 'vitest';
import { ClickSignService } from './clicksign.service';

/**
 * Duas coisas são testadas aqui, e as duas já custaram (ou custariam) contrato:
 *
 * 1. **Lixo de paste no valor.** O caso real (03/09): a instrução dizia
 *    `CLICKSIGN_ACCESS_TOKEN=<seu token>` e o valor foi colado DENTRO dos
 *    sinais — 38 caracteres em vez de 36, 401 da ClickSign, contrato que não
 *    sai. Agora existem DUAS fontes (ambiente e integração da empresa), e o
 *    campo do app é colado pela mesma mão.
 *
 * 2. **De qual fonte a configuração vem.** Ela é escolhida INTEIRA. Misturar o
 *    token de um tenant com o signatário da casa de outro não dá erro nenhum —
 *    dá contrato saindo pela conta errada.
 */
const TOKEN = 'eafbdf20-05ef-43cc-a6ec-2b9de697d39d';

type Interno = {
  resolver: (empresaId: string) => Promise<{
    token: string;
    modelo: string;
    base: string;
    canalToken: string;
    somatec: { nome: string; email: string; documento?: string } | null;
    autoAssinatura: boolean;
    origem: 'empresa' | 'ambiente';
  }>;
  configurado: (empresaId: string) => Promise<boolean>;
};

/** `credenciais: null` = empresa sem a integração ligada (o service trata o throw). */
const montar = (envs: Record<string, string>, credenciais: Record<string, unknown> | null) => {
  const integracoes = {
    obterCredenciaisInternas: vi.fn(async () => {
      if (!credenciais) throw new Error('Integração clicksign não configurada para esta empresa');
      return { credenciais };
    }),
  };
  const svc = new ClickSignService(
    { get: (k: string) => envs[k] } as never,
    {} as never,
    integracoes as never,
  );
  return { svc: svc as unknown as Interno, integracoes };
};

const AMBIENTE = {
  CLICKSIGN_ACCESS_TOKEN: TOKEN,
  CLICKSIGN_TEMPLATE_KEY: 'modelo-do-ambiente',
  CLICKSIGN_SIGNATARIO_NOME: 'Leonardo Beltran',
  CLICKSIGN_SIGNATARIO_EMAIL: 'marketing@somatecblocking.com.br',
};

describe('ClickSignService — limpeza do valor colado', () => {
  it.each([
    ['os sinais <> do exemplo', `<${TOKEN}>`],
    ['o nome da variável colado junto', `CLICKSIGN_ACCESS_TOKEN=${TOKEN}`],
    ['aspas e espaço nas pontas', `  "${TOKEN}"  `],
    ['valor já limpo', TOKEN],
  ])('tira %s — vindo do AMBIENTE', async (_caso, sujo) => {
    const { svc } = montar({ ...AMBIENTE, CLICKSIGN_ACCESS_TOKEN: sujo }, null);
    expect((await svc.resolver('emp-1')).token).toBe(TOKEN);
  });

  it.each([
    ['os sinais <> do exemplo', `<${TOKEN}>`],
    ['o nome da variável colado junto', `CLICKSIGN_ACCESS_TOKEN=${TOKEN}`],
    ['aspas e espaço nas pontas', `  "${TOKEN}"  `],
  ])('tira %s — vindo da INTEGRAÇÃO da empresa', async (_caso, sujo) => {
    const { svc } = montar({}, { accessToken: sujo, templateKey: 'modelo-do-tenant' });
    expect((await svc.resolver('emp-1')).token).toBe(TOKEN);
  });
});

describe('ClickSignService — de qual fonte vem a configuração', () => {
  it('empresa sem integração ligada cai no ambiente', async () => {
    const { svc } = montar(AMBIENTE, null);
    const cfg = await svc.resolver('emp-1');
    expect(cfg.origem).toBe('ambiente');
    expect(cfg.modelo).toBe('modelo-do-ambiente');
  });

  it('empresa com token próprio usa a conta DELA', async () => {
    const { svc } = montar(AMBIENTE, {
      accessToken: 'tok-do-tenant',
      templateKey: 'modelo-do-tenant',
    });
    const cfg = await svc.resolver('emp-1');
    expect(cfg.origem).toBe('empresa');
    expect(cfg.token).toBe('tok-do-tenant');
  });

  /**
   * 🔴 O ponto do arquivo. O signatário da casa é amarrado à CONTA: o Termo de
   * Assinatura Automática vale por conta e fica vinculado ao e-mail. Se um
   * campo faltante caísse pro ambiente, o contrato do tenant sairia com o
   * signatário da Somatec — e a ClickSign aceitaria sem reclamar.
   */
  it('campo que falta na integração NÃO é completado pelo ambiente', async () => {
    const { svc } = montar(AMBIENTE, {
      accessToken: 'tok-do-tenant',
      templateKey: 'modelo-do-tenant',
      // sem signatarioNome / signatarioEmail de propósito
    });
    const cfg = await svc.resolver('emp-1');
    expect(cfg.somatec).toBeNull();
    expect(cfg.modelo).toBe('modelo-do-tenant');
  });

  /** Integração ligada mas sem token é o mesmo que não ter — volta pro ambiente. */
  it('integração sem token não sequestra a configuração', async () => {
    const { svc } = montar(AMBIENTE, { templateKey: 'modelo-do-tenant' });
    expect((await svc.resolver('emp-1')).origem).toBe('ambiente');
  });
});

describe('ClickSignService — assinatura automática da casa', () => {
  const base = { accessToken: 'tok', templateKey: 'mod' };

  it('ausente = ligada (é o padrão de quem tem o Termo assinado)', async () => {
    const { svc } = montar({}, base);
    expect((await svc.resolver('emp-1')).autoAssinatura).toBe(true);
  });

  /**
   * ⚠️ O JSON guardado pode trazer booleano OU string. Tratar só a string
   * deixaria `false` passar como LIGADO: assinatura automática que o tenant
   * desligou e continuou valendo, sem nada acusando na tela.
   */
  it.each([
    ['booleano false', false],
    ['string "false"', 'false'],
    ['string "FALSE"', 'FALSE'],
  ])('%s desliga', async (_caso, valor) => {
    const { svc } = montar({}, { ...base, assinaturaAutomatica: valor });
    expect((await svc.resolver('emp-1')).autoAssinatura).toBe(false);
  });
});

describe('ClickSignService.configurado', () => {
  it('sem token e sem modelo em lugar nenhum, se declara desligada', async () => {
    const { svc } = montar({}, null);
    expect(await svc.configurado('emp-1')).toBe(false);
  });

  it('token sem modelo LIGA — o documento vai pronto do app (24/09)', async () => {
    // Antes o contrato era um Modelo guardado na ClickSign e, sem ele, não havia
    // o que assinar. Agora o app monta o .docx: exigir o modelo deixaria a
    // integração "desligada" e o contrato não sairia, calado.
    const { svc } = montar({ CLICKSIGN_ACCESS_TOKEN: TOKEN }, null);
    expect(await svc.configurado('emp-1')).toBe(true);
  });

  it('token e modelo da própria empresa ligam a integração', async () => {
    const { svc } = montar({}, { accessToken: 'tok', templateKey: 'mod' });
    expect(await svc.configurado('emp-1')).toBe(true);
  });
});

/**
 * Documento PRONTO (montado pelo app) vs Modelo da ClickSign.
 *
 * O caminho novo existe por causa da tabela que cresce com o levantamento. O
 * que se trava aqui é o que vai no POST do documento — é ele que decide qual
 * texto o cliente assina.
 */
describe('ClickSignService.enviarParaAssinatura — de onde vem o documento', () => {
  const montarEnvio = (envs: Record<string, string>) => {
    const post = vi.fn(async (url: string, _o: { body: unknown }) => ({
      data: {
        data: {
          id: url.includes('/signers') ? 'sig-1' : url.includes('/documents') ? 'doc-1' : 'env-1',
        },
      },
    }));
    const patch = vi.fn(async () => ({ data: {} }));
    const svc = new ClickSignService(
      { get: (k: string) => envs[k] } as never,
      { post, patch, get: vi.fn() } as never,
      {
        obterCredenciaisInternas: vi.fn(async () => {
          throw new Error('não configurada');
        }),
      } as never,
    );
    const corpoDoDocumento = () => {
      const chamada = post.mock.calls.find(([url]) => url.includes('/documents'));
      return (chamada?.[1].body as { data: { attributes: Record<string, unknown> } }).data
        .attributes;
    };
    return { svc, post, corpoDoDocumento };
  };

  const cliente = { nome: 'Fulano de Tal', email: 'fulano@cliente.com' };
  const arquivo = Buffer.from('PK\u0003\u0004 docx de mentira');

  it('documento pronto sobe por content_base64 com o prefixo data URI — sem template', async () => {
    const { svc, corpoDoDocumento } = montarEnvio({ CLICKSIGN_ACCESS_TOKEN: TOKEN });
    await svc.enviarParaAssinatura('emp-1', {
      titulo: 'Contrato',
      cliente,
      documento: { arquivo, nome: 'PROP-0042.docx' },
    });
    const attrs = corpoDoDocumento();
    expect(attrs.filename).toBe('PROP-0042.docx');
    expect(attrs.content_base64).toBe(
      `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${arquivo.toString('base64')}`,
    );
    expect(attrs).not.toHaveProperty('template');
  });

  /** Léo, 25/09: o envelope leva o contrato + o Levantamento técnico de projeto. */
  it('anexo sobe como 2º documento (PDF), sem metadata, e o signatário concorda com CADA um', async () => {
    const { svc, post } = montarEnvio({ CLICKSIGN_ACCESS_TOKEN: TOKEN });
    let n = 0;
    post.mockImplementation(async (url: string) => ({
      data: {
        data: {
          id: url.includes('/signers')
            ? 'sig-1'
            : url.includes('/documents')
              ? `doc-${++n}`
              : 'env-1',
        },
      },
    }));
    const pdf = Buffer.from('%PDF levantamento');
    const r = await svc.enviarParaAssinatura('emp-1', {
      titulo: 'Contrato',
      cliente,
      documento: { arquivo, nome: 'PROP-0042.docx' },
      metadata: { proposta: 'PROP-0042' },
      anexos: [{ arquivo: pdf, nome: 'PROP-0042-levantamento-tecnico.pdf' }],
    });
    // O documento PRINCIPAL continua sendo o contrato (é por ele que o webhook acha).
    expect(r.documentoId).toBe('doc-1');
    const docs = post.mock.calls.filter(([url]) => url.includes('/documents'));
    expect(docs).toHaveLength(2);
    const anexo = (docs[1][1].body as { data: { attributes: Record<string, unknown> } }).data
      .attributes;
    expect(anexo.filename).toBe('PROP-0042-levantamento-tecnico.pdf');
    expect(anexo.content_base64).toBe(`data:application/pdf;base64,${pdf.toString('base64')}`);
    expect(anexo).not.toHaveProperty('metadata');
    const reqs = post.mock.calls
      .filter(([url]) => url.includes('/requirements'))
      .map(
        ([, o]) =>
          (o.body as { data: { relationships: { document: { data: { id: string } } } } }).data
            .relationships.document.data.id,
      );
    expect(new Set(reqs)).toEqual(new Set(['doc-1', 'doc-2']));
    expect(reqs.filter((d) => d === 'doc-2').length).toBe(reqs.filter((d) => d === 'doc-1').length);
  });

  it('documento pronto NÃO exige o Modelo da ClickSign configurado', async () => {
    const { svc } = montarEnvio({ CLICKSIGN_ACCESS_TOKEN: TOKEN });
    await expect(
      svc.enviarParaAssinatura('emp-1', {
        titulo: 'C',
        cliente,
        documento: { arquivo, nome: 'a.docx' },
      }),
    ).resolves.toMatchObject({ documentoId: 'doc-1' });
  });

  it('variáveis seguem indo pro Modelo, como antes', async () => {
    const { svc, corpoDoDocumento } = montarEnvio(AMBIENTE);
    await svc.enviarParaAssinatura('emp-1', { titulo: 'C', cliente, variaveis: { a: '1' } });
    const attrs = corpoDoDocumento();
    expect(attrs.template).toEqual({ key: 'modelo-do-ambiente', data: { a: '1' } });
    expect(attrs).not.toHaveProperty('content_base64');
  });

  it.each([
    ['os dois', { variaveis: { a: '1' }, documento: { arquivo, nome: 'a.docx' } }],
    ['nenhum', {}],
  ])('recusa %s — escolher sozinho mandaria o texto errado', async (_c, conteudo) => {
    const { svc, post } = montarEnvio(AMBIENTE);
    await expect(
      svc.enviarParaAssinatura('emp-1', { titulo: 'C', cliente, ...conteudo }),
    ).rejects.toThrow(/exatamente um/);
    expect(post).not.toHaveBeenCalled();
  });
});
