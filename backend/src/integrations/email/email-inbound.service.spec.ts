import { describe, expect, it, vi } from 'vitest';
import { EmailInboundService } from './email-inbound.service';

/**
 * Resposta de e-mail virando evento.
 *
 * O buraco que isto fecha: quem respondia um e-mail da régua não gerava evento
 * nenhum — não parava a sequência, não saía de "em nutrição", não virava
 * tarefa. A régua seguia mandando os próximos pra quem já tinha respondido.
 *
 * O `processarMensagemEntrante` é o gatilho: o hook da Inbox resolve o lead
 * POR E-MAIL e dispara o `LEAD_RESPONDEU`. Por isso os testes olham o que chega
 * nele — é ali que a resposta vira evento.
 */
const build = (
  over: { empresas?: Array<{ id: string; config: unknown }>; segredo?: string } = {},
) => {
  const prisma = {
    empresa: {
      findMany: vi
        .fn()
        .mockResolvedValue(
          over.empresas ?? [
            { id: 'emp-1', config: { emailTransacional: { replyTo: 'comercial@empresa.com.br' } } },
          ],
        ),
    },
  };
  const inbox = {
    processarMensagemEntrante: vi
      .fn()
      .mockResolvedValue({ conversationId: 'c1', messageId: 'm1', duplicada: false }),
  };
  const env = { get: () => over.segredo ?? 'segredo-com-mais-de-16-chars' };
  const svc = new EmailInboundService(prisma as never, env as never, inbox as never);
  return { svc, inbox, prisma };
};

const CORPO = {
  from: 'Anna Rodrigues <anna@industria.com.br>',
  to: ['comercial@empresa.com.br'],
  subject: 'Re: Sua proposta',
  text: 'Tenho interesse, pode me ligar amanhã?',
  messageId: '<abc@mail>',
};

describe('entrada de e-mail', () => {
  it('registra a resposta na Inbox pelo canal EMAIL, com o e-mail como identidade', async () => {
    const { svc, inbox } = build();

    const r = await svc.registrar(CORPO);

    expect(r).toMatchObject({ efeito: 'registrado', empresaId: 'emp-1' });
    const arg = inbox.processarMensagemEntrante.mock.calls[0][0];
    expect(arg).toMatchObject({
      empresaId: 'emp-1',
      canal: 'EMAIL',
      // peerEmail é o que o hook usa pra achar o lead e disparar LEAD_RESPONDEU.
      peerEmail: 'anna@industria.com.br',
      peerId: 'anna@industria.com.br',
      peerNome: 'Anna Rodrigues',
    });
    expect(arg.conteudo).toContain('Tenho interesse');
  });

  it('corta a thread citada — senão o fluxo lê o que NÓS mandamos', async () => {
    // Um "não tenho interesse" de duas palavras viraria uma parede repetindo a
    // própria oferta, e é esse texto que a IA e as condições do fluxo leem.
    const { svc, inbox } = build();

    await svc.registrar({
      ...CORPO,
      text: 'Não tenho interesse.\n\nEm 8 de setembro, Somatec escreveu:\n> Conheça o Master Block\n> Fale com a gente',
    });

    const { conteudo } = inbox.processarMensagemEntrante.mock.calls[0][0];
    expect(conteudo).toContain('Não tenho interesse');
    expect(conteudo).not.toContain('Master Block');
  });

  it('e-mail pra endereço de OUTRA empresa não entra na caixa errada', async () => {
    const { svc, inbox } = build({
      empresas: [
        { id: 'emp-1', config: { emailTransacional: { replyTo: 'comercial@empresa-a.com.br' } } },
      ],
    });

    const r = await svc.registrar({ ...CORPO, to: ['contato@empresa-b.com.br'] });

    expect(r.efeito).toBe('sem-tenant');
    expect(inbox.processarMensagemEntrante).not.toHaveBeenCalled();
  });

  it('endereço declarado em config.emailInbound também resolve o tenant', async () => {
    const { svc } = build({
      empresas: [
        { id: 'emp-9', config: { emailInbound: { enderecos: ['resposta@mkt.empresa.com.br'] } } },
      ],
    });

    const r = await svc.registrar({ ...CORPO, to: ['Resposta@MKT.empresa.com.br'] });

    expect(r).toMatchObject({ efeito: 'registrado', empresaId: 'emp-9' });
  });

  it('aceita o formato do provedor com envelope `data` e só HTML', async () => {
    // Trocar de provedor de entrada não pode virar migração de código.
    const { svc, inbox } = build();

    await svc.registrar({
      type: 'email.received',
      data: {
        from: 'anna@industria.com.br',
        to: 'comercial@empresa.com.br',
        subject: 'Re: proposta',
        html: '<p>Pode ligar<br>amanh&nbsp;cedo</p>',
      },
    });

    expect(inbox.processarMensagemEntrante.mock.calls[0][0].conteudo).toContain('Pode ligar');
  });

  it('sem remetente válido não inventa conversa', async () => {
    const { svc, inbox } = build();

    expect(await svc.registrar({ to: ['comercial@empresa.com.br'], text: 'oi' })).toMatchObject({
      efeito: 'sem-remetente',
    });
    expect(inbox.processarMensagemEntrante).not.toHaveBeenCalled();
  });

  it('reentrega do provedor não vira segunda resposta', async () => {
    const { svc, inbox } = build();
    inbox.processarMensagemEntrante.mockResolvedValue({
      conversationId: 'c1',
      messageId: 'm1',
      duplicada: true,
    });

    expect((await svc.registrar(CORPO)).efeito).toBe('duplicado');
  });
});

describe('segredo da rota de entrada', () => {
  it('sem segredo configurado, NADA entra', () => {
    const { svc } = build({ segredo: '' });

    expect(svc.segredoConfere('qualquer-coisa')).toBe(false);
  });

  it('segredo errado é recusado; o certo passa', () => {
    const { svc } = build();

    expect(svc.segredoConfere('outro')).toBe(false);
    expect(svc.segredoConfere('segredo-com-mais-de-16-chars')).toBe(true);
  });
});
