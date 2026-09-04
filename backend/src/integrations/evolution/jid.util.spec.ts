import { describe, expect, it } from 'vitest';
import { normalizarJid } from './jid.util';

/**
 * O contato que vira DUAS conversas.
 *
 * Medido em produção (04/09): `+5511997524483@s.whatsapp.net` e
 * `5511997524483@s.whatsapp.net` — o mesmo número, na mesma caixa — eram duas
 * linhas de `Conversation`, porque o `upsertConversation` casa por `peerId`
 * EXATO. Resultado: 16 mensagens numa, 5 na outra, e quem abre uma delas jura
 * que o bot não respondeu.
 */
describe('normalizarJid', () => {
  it('tira o + do telefone em E.164 — é o que rachava a conversa em duas', () => {
    expect(normalizarJid('+5511997524483@s.whatsapp.net')).toBe('5511997524483@s.whatsapp.net');
  });

  it('jid já normal passa intacto', () => {
    expect(normalizarJid('5511997524483@s.whatsapp.net')).toBe('5511997524483@s.whatsapp.net');
  });

  it('não mexe em LID nem em grupo (o id ali é opaco, não é telefone)', () => {
    expect(normalizarJid('196348875923652@lid')).toBe('196348875923652@lid');
    expect(normalizarJid('120363429718571062@g.us')).toBe('120363429718571062@g.us');
  });

  it('só o + do INÍCIO some — não sai varrendo o resto da string', () => {
    expect(normalizarJid('5511+997524483@s.whatsapp.net')).toBe('5511+997524483@s.whatsapp.net');
  });

  it('string vazia não quebra', () => {
    expect(normalizarJid('')).toBe('');
  });
});
