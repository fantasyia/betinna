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

  it('token sem modelo ainda é desligada — não há o que mandar assinar', async () => {
    const { svc } = montar({ CLICKSIGN_ACCESS_TOKEN: TOKEN }, null);
    expect(await svc.configurado('emp-1')).toBe(false);
  });

  it('token e modelo da própria empresa ligam a integração', async () => {
    const { svc } = montar({}, { accessToken: 'tok', templateKey: 'mod' });
    expect(await svc.configurado('emp-1')).toBe(true);
  });
});
