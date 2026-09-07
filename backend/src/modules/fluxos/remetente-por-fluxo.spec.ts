import { describe, expect, it, vi } from 'vitest';
import { ResendService } from '@integrations/resend/resend.service';
import { TransactionalEmailService } from '@integrations/email/transactional-email.service';

/**
 * Remetente POR FLUXO — separação de reputação de e-mail.
 *
 * Até aqui o `From` era UMA env da instância inteira: régua fria e confirmação
 * de pedido saíam do mesmo endereço. Reclamação de spam numa base de 30 mil
 * derruba a reputação do domínio, e quem para de chegar junto é o
 * TRANSACIONAL — o e-mail que sustenta a venda derrubado pelo que prospecta.
 *
 * Quem se muda é a régua fria; o transacional FICA no domínio raiz. Por isso o
 * campo é opcional e o default continua sendo o env: fluxo que não configurou
 * nada não pode mudar de comportamento sozinho.
 */
const buildResend = () => {
  const http = { post: vi.fn().mockResolvedValue({ status: 200, data: { id: 'm1' } }) };
  const env = {
    get: (k: string) =>
      k === 'RESEND_API_KEY'
        ? 'key'
        : k === 'RESEND_FROM_EMAIL'
          ? 'transacional@empresa.com.br'
          : k === 'RESEND_FROM_NAME'
            ? 'Empresa'
            : '',
  };
  const svc = new ResendService(http as never, env as never);
  return { svc, http };
};

const corpoEnviado = (http: { post: ReturnType<typeof vi.fn> }) =>
  (http.post.mock.calls[0][1] as { body: { from: string } }).body;

describe('endereço de envio', () => {
  it('sem remetente próprio, sai do endereço do AMBIENTE — nada muda pra quem não configurou', async () => {
    const { svc, http } = buildResend();

    await svc.enviar({ para: 'x@y.com', assunto: 'oi', html: '<p>oi</p>' });

    expect(corpoEnviado(http).from).toBe('Empresa <transacional@empresa.com.br>');
  });

  it('com remetente do fluxo, a régua sai do subdomínio dela', async () => {
    const { svc, http } = buildResend();

    await svc.enviar({
      para: 'x@y.com',
      assunto: 'oi',
      html: '<p>oi</p>',
      fromEmail: 'nutricao@mkt.empresa.com.br',
    });

    // O NOME de exibição continua o do tenant: quem muda é o domínio de envio,
    // não a identidade que o destinatário lê.
    expect(corpoEnviado(http).from).toBe('Empresa <nutricao@mkt.empresa.com.br>');
  });

  it('remetente em branco cai no padrão em vez de mandar sem endereço', async () => {
    const { svc, http } = buildResend();

    await svc.enviar({ para: 'x@y.com', assunto: 'oi', html: '<p>oi</p>', fromEmail: '   ' });

    expect(corpoEnviado(http).from).toBe('Empresa <transacional@empresa.com.br>');
  });
});

describe('o caminho da régua (enviarHtmlLivre) leva o remetente até o provedor', () => {
  const build = () => {
    const enviar = vi.fn().mockResolvedValue({ status: 200, id: 'm1' });
    const prisma = {
      empresa: { findUnique: vi.fn().mockResolvedValue({ nome: 'X', config: {} }) },
    };
    const svc = new TransactionalEmailService(
      { isConfigured: () => true, enviar } as never,
      { get: () => '' } as never,
      prisma as never,
      {} as never,
    );
    return { svc, enviar };
  };

  it('repassa o endereço do fluxo', async () => {
    const { svc, enviar } = build();

    await svc.enviarHtmlLivre({
      para: 'lead@empresa.com',
      assunto: 'Régua 1',
      html: '<p>oi</p>',
      empresaId: 'emp-1',
      remetenteEmail: 'nutricao@mkt.empresa.com.br',
    });

    expect(enviar.mock.calls[0][0].fromEmail).toBe('nutricao@mkt.empresa.com.br');
  });

  it('e-mail SEM remetente próprio não inventa endereço nenhum', async () => {
    // O transacional passa por aqui também. Se este caminho começasse a mandar
    // um endereço qualquer, a separação viraria o oposto do que ela existe pra
    // fazer.
    const { svc, enviar } = build();

    await svc.enviarHtmlLivre({
      para: 'cliente@empresa.com',
      assunto: 'Pedido confirmado',
      html: '<p>oi</p>',
      empresaId: 'emp-1',
    });

    expect(enviar.mock.calls[0][0].fromEmail).toBeUndefined();
  });
});
