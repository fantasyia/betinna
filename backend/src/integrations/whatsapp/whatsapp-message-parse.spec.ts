import { describe, expect, it } from 'vitest';
import { extrairTextoProfundo } from './whatsapp-session.service';

/**
 * Varredura profunda — último recurso do parser do WhatsApp. Garante que QUALQUER
 * tipo de mensagem com texto legível (inclusive tipos novos da API oficial que
 * ainda não mapeamos explicitamente) saia como texto em vez de "[não suportada]".
 */
describe('extrairTextoProfundo', () => {
  it('acha texto em resposta de botão (API oficial)', () => {
    expect(extrairTextoProfundo({ buttonsResponseMessage: { selectedDisplayText: 'Sim' } })).toBe(
      'Sim',
    );
  });

  it('acha texto aninhado fundo (tipo desconhecido com body.text)', () => {
    expect(extrairTextoProfundo({ tipoNovoQualquer: { body: { text: 'Olá!' } } })).toBe('Olá!');
  });

  it('prioriza chave de texto sobre id/url no mesmo nível', () => {
    expect(extrairTextoProfundo({ x: { id: '123', url: 'http://a', text: 'oi' } })).toBe('oi');
  });

  it('ignora espaços e acha o primeiro texto real', () => {
    expect(extrairTextoProfundo({ a: { caption: '   ' }, b: { conversation: 'eai' } })).toBe('eai');
  });

  it('retorna undefined quando não há texto algum (só números/flags)', () => {
    expect(extrairTextoProfundo({ protocolMessage: { type: 0, key: { id: 'abc' } } })).toBe(
      undefined,
    );
    expect(extrairTextoProfundo(null)).toBeUndefined();
    expect(extrairTextoProfundo(undefined)).toBeUndefined();
  });
});
