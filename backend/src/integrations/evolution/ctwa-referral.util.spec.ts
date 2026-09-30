import { describe, expect, it } from 'vitest';
import { campanhaDoReferral, extrairCtwaReferral, metaDoReferral } from './ctwa-referral.util';

describe('extrairCtwaReferral', () => {
  it('acha o externalAdReply em QUALQUER variante da mensagem (não só extendedText)', () => {
    const proto = {
      imageMessage: {
        caption: 'oi',
        contextInfo: {
          externalAdReply: {
            title: 'VTCD Industria Alimenticia',
            body: 'Pare de perder produção',
            sourceId: '120210000',
            sourceType: 'ad',
            sourceUrl: 'https://fb.me/x',
            ctwaClid: 'ARabc123',
          },
        },
      },
    };
    expect(extrairCtwaReferral(proto)).toMatchObject({
      ctwaClid: 'ARabc123',
      sourceId: '120210000',
      sourceType: 'ad',
      headline: 'VTCD Industria Alimenticia',
      body: 'Pare de perder produção',
    });
  });

  it('texto SIMPLES ("conversation"): acha o anúncio no contextInfo da RAIZ (formato real do Evolution, 30/09)', () => {
    // Estrutura medida no 1º clique real (anúncio da Ribelt): `message` só tem
    // `conversation` (string) + messageContextInfo; o externalAdReply fica no
    // contextInfo IRMÃO de `message`.
    const message = {
      conversation: 'Olá! Posso ter mais informações sobre isso?',
      messageContextInfo: { deviceListMetadataVersion: 2 },
    };
    const contextInfoRaiz = {
      mentionedJid: [],
      groupMentions: [],
      externalAdReply: {
        title: 'Sua indústria em 16 canais de venda',
        body: 'Indústria de cosméticos…',
        ctwaClid: 'AffABC',
        sourceId: '120255319246460496',
        sourceType: 'ad',
        sourceUrl: 'https://fb.me/x',
        sourceApp: 'facebook',
        showAdAttribution: true,
      },
    };
    expect(extrairCtwaReferral(message)).toBeUndefined(); // o defeito: só olhava as variantes
    expect(extrairCtwaReferral(message, contextInfoRaiz)).toMatchObject({
      ctwaClid: 'AffABC',
      sourceId: '120255319246460496',
      sourceType: 'ad',
      headline: 'Sua indústria em 16 canais de venda',
    });
  });

  it('contextInfo da raiz SEM anúncio (mensagem comum) → undefined', () => {
    expect(
      extrairCtwaReferral({ conversation: 'oi' }, { mentionedJid: [], groupMentions: [] }),
    ).toBeUndefined();
  });

  it('guarda o bloco CRU (raw) — não perde campo que não mapeamos', () => {
    const r = extrairCtwaReferral({
      extendedTextMessage: {
        contextInfo: { externalAdReply: { sourceId: 'x', campoNovoDoMeta: 'valor' } },
      },
    });
    // desde 29/09 o cru agrupa o externalAdReply E os campos de conversão
    expect(
      ((r?.raw as Record<string, unknown>).externalAdReply as Record<string, unknown>)
        .campoNovoDoMeta,
    ).toBe('valor');
  });

  it('anúncio SEM externalAdReply, só com o entryPoint/conversionSource, ainda é anúncio', () => {
    const r = extrairCtwaReferral({
      conversation: 'oi',
      extendedTextMessage: {
        contextInfo: {
          conversionSource: 'FB_Ads',
          entryPointConversionSource: 'ctwa_ad',
          entryPointConversionApp: 'instagram',
          entryPointConversionDelaySeconds: 7,
        },
      },
    });
    expect(r).toMatchObject({
      conversionSource: 'FB_Ads',
      entryPointSource: 'ctwa_ad',
      entryPointApp: 'instagram',
    });
    expect(r?.raw).toMatchObject({ entryPointConversionDelaySeconds: 7 });
  });

  it('metaDoReferral separa o cru (vai pra Conversation, não pra cada Message)', () => {
    const r = extrairCtwaReferral({
      extendedTextMessage: { contextInfo: { externalAdReply: { sourceId: '123', title: 'MB' } } },
    })!;
    const meta = metaDoReferral(r);
    expect(meta.ctwaReferral).toEqual({ sourceId: '123', headline: 'MB' });
    expect(meta.ctwaReferralCru).toMatchObject({ externalAdReply: { sourceId: '123' } });
  });

  it('SEM ctwaClid (limitação do Baileys/Web) ainda extrai o resto', () => {
    // O ctwa_clid é campo da Cloud API oficial; no protocolo Web pode não vir.
    const r = extrairCtwaReferral({
      extendedTextMessage: { contextInfo: { externalAdReply: { title: 'Campanha X' } } },
    });
    expect(r?.ctwaClid).toBeUndefined();
    expect(r?.headline).toBe('Campanha X');
  });

  it('mensagem normal (sem anúncio) → undefined, não inventa atribuição', () => {
    expect(extrairCtwaReferral({ conversation: 'oi, bom dia' })).toBeUndefined();
    expect(extrairCtwaReferral({ extendedTextMessage: { contextInfo: {} } })).toBeUndefined();
    expect(extrairCtwaReferral(undefined)).toBeUndefined();
    // externalAdReply vazio = sem nenhum campo útil → não cria atribuição fantasma
    expect(
      extrairCtwaReferral({ extendedTextMessage: { contextInfo: { externalAdReply: {} } } }),
    ).toBeUndefined();
  });

  it('sanitiza: tira controle e corta em 500', () => {
    const r = extrairCtwaReferral({
      extendedTextMessage: {
        contextInfo: { externalAdReply: { title: 'camp\x01anha', body: 'b'.repeat(900) } },
      },
    });
    expect(r?.headline).toBe('campanha');
    expect(r?.body).toHaveLength(500);
  });
});

describe('campanhaDoReferral', () => {
  it('usa o título do criativo (lower) como slug da campanha', () => {
    expect(campanhaDoReferral({ headline: 'VTCD-Alimenticia' })).toBe('vtcd-alimenticia');
  });
  it('cai no sourceId quando não há título', () => {
    expect(campanhaDoReferral({ sourceId: '12345' })).toBe('12345');
  });
  it('sem referral → undefined (conversa orgânica não ganha campanha)', () => {
    expect(campanhaDoReferral(undefined)).toBeUndefined();
    expect(campanhaDoReferral({})).toBeUndefined();
  });
});
