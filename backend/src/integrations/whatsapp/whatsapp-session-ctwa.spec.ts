import { describe, expect, it, vi } from 'vitest';
import { WhatsAppSessionService } from './whatsapp-session.service';

/**
 * Click-to-WhatsApp no Baileys DIRETO (29/09). É o provider PADRÃO e jogava
 * fora o referral do anúncio — só o Evolution lia. A conversa de anúncio
 * entrava como orgânica e a campanha se perdia.
 */
function montar() {
  const inbox = {
    processarMensagemEntrante: vi.fn(async () => ({ conversationId: 'c1', messageId: 'm1' })),
  };
  const svc = new WhatsAppSessionService(
    {} as never,
    {} as never,
    inbox as never,
    { baixarEArmazenar: vi.fn(async () => null) } as never,
    {} as never,
    {} as never,
  );
  const ctx = {
    empresaId: 'emp-1',
    owner: { type: 'EMPRESA', id: 'emp-1' },
    groupNameCache: new Map(),
  };
  const entrar = (m: unknown) =>
    (
      svc as unknown as { handleMensagensEntrantes: (c: unknown, m: unknown[]) => Promise<void> }
    ).handleMensagensEntrantes(ctx, [m]);
  return { inbox, entrar };
}

const mensagemDeAnuncio = (fromMe = false, jid = '5511988880001@s.whatsapp.net') => ({
  key: { remoteJid: jid, fromMe, id: 'wamid-1' },
  pushName: 'Ana',
  messageTimestamp: 1_759_000_000,
  message: {
    extendedTextMessage: {
      text: 'Olá, vi o anúncio',
      contextInfo: {
        externalAdReply: { sourceId: '120210000000001', title: 'Master Block', ctwaClid: 'clid-9' },
        conversionSource: 'FB_Ads',
        entryPointConversionSource: 'ctwa_ad',
      },
    },
  },
});

describe('WhatsAppSessionService — referral do Click-to-WhatsApp', () => {
  it('lê o referral e manda o cru À PARTE (vai só pra Conversation)', async () => {
    const m = montar();
    await m.entrar(mensagemDeAnuncio());
    const meta = (
      m.inbox.processarMensagemEntrante.mock.calls[0] as unknown as [
        { meta: Record<string, unknown> },
      ]
    )[0].meta;
    expect(meta.ctwaReferral).toMatchObject({
      sourceId: '120210000000001',
      ctwaClid: 'clid-9',
      headline: 'Master Block',
      conversionSource: 'FB_Ads',
      entryPointSource: 'ctwa_ad',
    });
    expect((meta.ctwaReferral as Record<string, unknown>).raw).toBeUndefined();
    expect(meta.ctwaReferralCru).toMatchObject({
      externalAdReply: { sourceId: '120210000000001' },
    });
  });

  it('mensagem NOSSA (fromMe) não carrega referral', async () => {
    const m = montar();
    await m.entrar(mensagemDeAnuncio(true));
    const meta = (
      m.inbox.processarMensagemEntrante.mock.calls[0] as unknown as [
        { meta: Record<string, unknown> },
      ]
    )[0].meta;
    expect(meta.ctwaReferral).toBeUndefined();
  });
});
