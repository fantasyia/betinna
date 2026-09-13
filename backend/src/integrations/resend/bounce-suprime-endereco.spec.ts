import { describe, expect, it, vi } from 'vitest';
import { ResendWebhookService } from './resend-webhook.service';
import { SupressaoService } from '@shared/supressao/supressao.service';

/**
 * Bounce e reclamação de e-mail de FLUXO param de ser descartados.
 *
 * O webhook casava o evento só em `campanhaDestinatario`. E-mail mandado por
 * fluxo não tem linha lá, então `count === 0` e o evento morria em silêncio —
 * tratado no código como caso normal, e era, até as réguas existirem. Resultado:
 * endereço morto seguia sendo alvo, régua após régua.
 *
 * Com 6.317 leads com e-mail numa base fria, insistir em caixa inexistente é o
 * sinal que mais rápido queima um domínio de envio: o provedor lê como lista
 * comprada. E o domínio de marketing acabou de nascer, sem reputação.
 */
const build = (over: { leads?: Array<{ empresaId: string }>; corpo?: unknown } = {}) => {
  const prisma = {
    campanhaDestinatario: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    lead: { findMany: vi.fn().mockResolvedValue(over.leads ?? [{ empresaId: 'emp-1' }]) },
    cliente: { findMany: vi.fn().mockResolvedValue([]) },
  };
  const supressao = { marcarEmailInvalido: vi.fn().mockResolvedValue(1) };
  const inbound = { registrar: vi.fn().mockResolvedValue({ efeito: 'registrado' }) };
  // C-7: o corpo do e-mail recebido vem da API, não do webhook.
  const resend = { obterRecebido: vi.fn().mockResolvedValue(over.corpo ?? null) };
  const svc = new ResendWebhookService(
    { get: () => '' } as never,
    prisma as never,
    supressao as never,
    inbound as never,
    resend as never,
  );
  return { svc, prisma, supressao, inbound, resend };
};

const evento = (type: string, to = ['morto@empresa.com.br']) => ({
  type,
  data: { email_id: 'em-1', to },
});

describe('bounce de e-mail de fluxo', () => {
  it('endereço morto é marcado como inválido no tenant do lead', async () => {
    const { svc, supressao } = build();

    const r = await svc.aplicar(evento('email.bounced'));

    expect(r).toBe('emailSuprimido');
    expect(supressao.marcarEmailInvalido).toHaveBeenCalledWith(
      'emp-1',
      'morto@empresa.com.br',
      'bounce',
    );
  });

  it('reclamação de spam vale a mesma coisa — as duas dizem "não mande mais"', async () => {
    const { svc, supressao } = build();

    await svc.aplicar(evento('email.complained'));

    expect(supressao.marcarEmailInvalido).toHaveBeenCalledWith(
      'emp-1',
      'morto@empresa.com.br',
      'reclamacao',
    );
  });

  it('o mesmo endereço em DOIS tenants é marcado nos dois', async () => {
    // Caixa inexistente é inexistente pra todo mundo.
    const { svc, supressao } = build({ leads: [{ empresaId: 'emp-1' }, { empresaId: 'emp-2' }] });

    await svc.aplicar(evento('email.bounced'));

    expect(supressao.marcarEmailInvalido).toHaveBeenCalledTimes(2);
  });

  it('entrega e abertura sem destinatário de campanha seguem sendo ignoradas', async () => {
    // Transacional (convite, comissão) gera esses eventos e não tem linha de
    // campanha — isso É normal, e virar supressão seria desastre.
    const { svc, supressao } = build();

    expect(await svc.aplicar(evento('email.delivered'))).toBe('semDestinatario');
    expect(await svc.aplicar(evento('email.opened'))).toBe('semDestinatario');
    expect(supressao.marcarEmailInvalido).not.toHaveBeenCalled();
  });

  it('bounce de endereço que não é de lead nenhum não quebra nada', async () => {
    const { svc } = build({ leads: [] });

    expect(await svc.aplicar(evento('email.bounced'))).toBe('semDestinatario');
  });

  it('falha ao suprimir um endereço não derruba o webhook', async () => {
    // Erro aqui faria o Resend reentregar pra sempre.
    const { svc, supressao } = build();
    supressao.marcarEmailInvalido.mockRejectedValue(new Error('banco fora'));

    await expect(svc.aplicar(evento('email.bounced'))).resolves.toBe('semDestinatario');
  });
});

describe('a tag de e-mail é SEPARADA da de LGPD', () => {
  it('são strings diferentes — e a diferença não é cosmética', () => {
    // A tag de LGPD cala TODO outbound (WhatsApp, IA, campanha). Caixa de
    // e-mail morta não diz nada sobre o telefone da pessoa: reusar a tag de
    // LGPD silenciaria o canal que ainda funciona.
    expect(SupressaoService.TAG_EMAIL_INVALIDO).not.toBe(SupressaoService.TAG_LGPD);
  });
});

describe('e-mail RECEBIDO chega pelo mesmo webhook', () => {
  it('evento de recebimento vai pra ingestão, não pro fluxo de campanha', async () => {
    // O "Enable Receiving" do domínio no Resend entrega inbound por webhook —
    // o mesmo já assinado. Então a resposta do lead vira evento sem rota nova
    // nem segredo separado.
    const { svc, inbound, supressao } = build();

    const r = await svc.aplicar({
      type: 'email.received',
      data: { from: 'anna@x.com', to: ['comercial@y.com'], text: 'pode ligar' },
    } as never);

    expect(inbound.registrar).toHaveBeenCalled();
    expect(r).toBe('entrada:registrado');
    // Recebimento não é bounce: não pode encostar na supressão.
    expect(supressao.marcarEmailInvalido).not.toHaveBeenCalled();
  });

  it('os eventos de ENTREGA seguem no caminho de sempre', async () => {
    const { svc, inbound } = build();

    await svc.aplicar(evento('email.delivered'));

    expect(inbound.registrar).not.toHaveBeenCalled();
  });
});

/**
 * Auditoria 13/09/2026 (C-4): a supressão só rodava quando NÃO havia linha de
 * campanha (count === 0). E-mail de CAMPANHA ganhava `bounceEm` e o Cliente
 * seguia alvo da campanha seguinte.
 */
describe('bounce de e-mail de CAMPANHA também queima o endereço', () => {
  it('linha de campanha casada (count 1) + reclamação → marcarEmailInvalido roda mesmo assim', async () => {
    const { svc, prisma, supressao } = build();
    prisma.campanhaDestinatario.updateMany.mockResolvedValue({ count: 1 });

    const efeito = await svc.aplicar(evento('email.complained'));

    expect(efeito).toBe('aplicado');
    expect(supressao.marcarEmailInvalido).toHaveBeenCalledWith(
      'emp-1',
      'morto@empresa.com.br',
      'reclamacao',
    );
  });

  it('endereço que só existe como CLIENTE (sem lead) também é marcado', async () => {
    const { svc, prisma, supressao } = build({ leads: [] });
    prisma.cliente.findMany.mockResolvedValue([{ empresaId: 'emp-9' }]);

    await svc.aplicar(evento('email.bounced'));

    expect(supressao.marcarEmailInvalido).toHaveBeenCalledWith(
      'emp-9',
      'morto@empresa.com.br',
      'bounce',
    );
  });
});

/**
 * Auditoria 13/09/2026 (C-7): o webhook `email.received` do Resend NÃO traz o
 * corpo — a resposta do lead entrava na Inbox só com o assunto, sem dedup e
 * sem data. Agora o corpo vem de `GET /emails/receiving/{id}`.
 */
describe('e-mail recebido: o corpo vem da API do Resend', () => {
  it('busca o corpo pelo email_id e entrega texto, message_id e created_at ao inbound', async () => {
    const { svc, inbound, resend } = build({
      corpo: {
        text: 'Oi, tenho interesse sim. Pode me ligar amanhã?',
        html: null,
        subject: 'Re: Sua proposta',
        from: 'lead@x.com',
        to: ['comercial@somatec.com.br'],
        messageId: '<abc@x.com>',
        createdAt: '2026-09-13T20:00:00.000Z',
      },
    });

    await svc.aplicar({
      type: 'email.received',
      data: {
        email_id: 'rcv-1',
        from: 'lead@x.com',
        to: ['comercial@somatec.com.br'],
        subject: 'Re: Sua proposta',
      },
    } as never);

    expect(resend.obterRecebido).toHaveBeenCalledWith('rcv-1');
    const entregue = inbound.registrar.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(entregue.data.text).toBe('Oi, tenho interesse sim. Pode me ligar amanhã?');
    expect(entregue.data.message_id).toBe('<abc@x.com>');
    expect(entregue.data.created_at).toBe('2026-09-13T20:00:00.000Z');
  });

  it('API fora do ar → registra o que o evento trouxe (não perde o evento)', async () => {
    const { svc, inbound, resend } = build();
    resend.obterRecebido.mockRejectedValue(new Error('502'));

    const efeito = await svc.aplicar({
      type: 'email.received',
      data: { email_id: 'rcv-2', from: 'lead@x.com', subject: 'Re: oi' },
    } as never);

    expect(efeito).toBe('entrada:registrado');
    expect(inbound.registrar).toHaveBeenCalled();
  });
});
