import { describe, expect, it } from 'vitest';
import { campanhaDoReferral, extrairCtwaReferral } from './ctwa-referral.util';

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

  it('guarda o bloco CRU (raw) — não perde campo que não mapeamos', () => {
    const r = extrairCtwaReferral({
      extendedTextMessage: {
        contextInfo: { externalAdReply: { sourceId: 'x', campoNovoDoMeta: 'valor' } },
      },
    });
    expect((r?.raw as Record<string, unknown>).campoNovoDoMeta).toBe('valor');
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
