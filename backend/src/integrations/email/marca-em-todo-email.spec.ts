import { describe, expect, it, vi } from 'vitest';
import { TransactionalEmailService } from './transactional-email.service';

/**
 * TODO e-mail de tenant sai com a marca DELE — inclusive o remetente.
 *
 * Achado em produção em 07/09: o convite de um representante da Somatec chegou
 * com o layout genérico e assinado **"Betinna.ai"**. A causa não era o
 * template: só `enviarPedidoRastreio` resolvia a marca. Os outros sete mandavam
 * sem `empresaId` nenhum, então não tinham nem marca nem remetente por tenant —
 * e o nome do produto aparecia no lugar mais visível de um e-mail, a linha do
 * "De:".
 *
 * Este teste é table-driven de propósito: método de envio novo entra na tabela,
 * e quem esquecer o `empresaId` quebra aqui em vez de na caixa de um cliente.
 */
const build = () => {
  const enviar = vi.fn().mockResolvedValue({ status: 200, id: 'm1' });
  const prisma = {
    empresa: {
      findUnique: vi.fn().mockResolvedValue({
        nome: 'Somatec Blocking',
        config: {
          branding: { nome: 'Somatec Blocking', dominio: 'app.somatecblocking.com.br' },
          marca: {
            corPrimaria: '#00416E',
            corAcao: '#F39200',
            logoEmailUrl: 'https://x/logo-somatec.png',
          },
        },
      }),
    },
  };
  const svc = new TransactionalEmailService(
    { isConfigured: () => true, enviar } as never,
    { get: (k: string) => (k === 'FRONTEND_URL' ? 'https://app-do-produto.com' : '') } as never,
    prisma as never,
    { gerarToken: () => 't', urlDescadastro: () => 'https://x/desc' } as never,
  );
  return { svc, enviar };
};

const EMPRESA = 'emp-1';

/** Um por e-mail que o sistema manda pra dentro de um tenant. */
const ENVIOS: Array<[string, (s: TransactionalEmailService) => Promise<unknown>]> = [
  [
    'boas-vindas',
    (s) =>
      s.enviarBoasVindas({
        para: 'rep@x.com',
        nome: 'Anna',
        empresaNome: 'Somatec Blocking',
        empresaId: EMPRESA,
      }),
  ],
  [
    'reenvio de convite',
    (s) =>
      s.enviarReenvioConvite({
        para: 'rep@x.com',
        nome: 'Anna',
        empresaNome: 'Somatec Blocking',
        inviteUrl: 'https://x/invite',
        empresaId: EMPRESA,
      }),
  ],
  [
    'recuperar senha',
    (s) =>
      s.enviarRecuperacaoSenha({
        para: 'rep@x.com',
        nome: 'Anna',
        resetUrl: 'https://x/reset',
        empresaId: EMPRESA,
      }),
  ],
  [
    'aprovação resolvida',
    (s) =>
      s.enviarAprovacaoResolvida({
        para: 'rep@x.com',
        repNome: 'Anna',
        pedidoId: 'p1',
        pedidoNumero: 'SB1',
        status: 'APROVADA',
        empresaId: EMPRESA,
      }),
  ],
  [
    'comissão fechada',
    (s) =>
      s.enviarComissaoFechada({
        para: 'rep@x.com',
        repNome: 'Anna',
        mes: 8,
        ano: 2026,
        totalVendas: 1000,
        totalComissao: 100,
        empresaId: EMPRESA,
      }),
  ],
  [
    'ocorrência crítica',
    (s) =>
      s.enviarOcorrenciaCritica({
        para: 'rep@x.com',
        destinatarioNome: 'Anna',
        ocorrenciaId: 'o1',
        numero: 'OC-1',
        titulo: 'Avaria',
        severidade: 'CRITICA',
        slaHoras: 4,
        empresaId: EMPRESA,
      }),
  ],
  [
    'follow-up de amostra',
    (s) =>
      s.enviarAmostraFollowup({
        para: 'rep@x.com',
        repNome: 'Anna',
        clienteNome: 'Indústria X',
        produtoNome: 'Produto',
        diasDesdeEnvio: 7,
        empresaId: EMPRESA,
      }),
  ],
  [
    'rastreio do pedido',
    (s) =>
      s.enviarPedidoRastreio({
        para: 'cliente@x.com',
        empresaId: EMPRESA,
        pedidoId: 'p1',
        nome: 'Cliente',
        numeroPedido: 'SB1',
        codigo: 'BR1',
        url: 'https://x/rastreio',
      }),
  ],
];

describe.each(ENVIOS)('e-mail de tenant: %s', (_nome, enviarEmail) => {
  it('sai com a cor e a logo do tenant', async () => {
    const { svc, enviar } = build();

    await enviarEmail(svc);

    const html = enviar.mock.calls[0][0].html as string;
    expect(html).toContain('#00416E');
    expect(html).toContain('logo-somatec.png');
  });

  it('NÃO leva o nome do produto — nem no corpo, nem no remetente', async () => {
    const { svc, enviar } = build();

    await enviarEmail(svc);

    const { html, fromNome } = enviar.mock.calls[0][0] as { html: string; fromNome?: string };
    expect(html).not.toMatch(/betinna/i);
    // O "De:" é o campo mais visível do e-mail: errar ali desfaz o white-label
    // inteiro, por mais certo que o corpo esteja.
    expect(fromNome).toBe('Somatec Blocking');
  });
});

describe('sem tenant, o produto continua sendo o produto', () => {
  it('e-mail sem empresaId sai no layout do Betinna — white-label não é rename', async () => {
    const { svc, enviar } = build();

    await svc.enviarBoasVindas({ para: 'x@y.com', nome: 'Fulano', empresaNome: 'Empresa' });

    expect(enviar.mock.calls[0][0].html as string).toMatch(/betinna/i);
  });
});
