import { describe, expect, it } from 'vitest';
import { interpolate, placeholdersPendentes } from './interpolate';
import { primeiroNome } from '@modules/vitrine/carrinho-recuperador';

/** Reserva de variável `{{x|padrão}}` (Léo/#01, 19/10). */

const comNome = { lead: { primeiro_nome: 'Ana' } };
const semNome = { lead: { primeiro_nome: '' } };

describe('interpolate — reserva', () => {
  it('com valor, usa o valor; vazio ou ausente, usa a reserva', () => {
    expect(interpolate('{{lead.primeiro_nome|Oi}}, tudo bem?', comNome)).toBe('Ana, tudo bem?');
    expect(interpolate('{{lead.primeiro_nome|Oi}}, esses são os modelos', semNome)).toBe(
      'Oi, esses são os modelos',
    );
    expect(interpolate('{{lead.primeiro_nome|Oi}}!', {})).toBe('Oi!');
  });

  it('reserva vazia some e leva o espaço antes da pontuação', () => {
    expect(interpolate('Oi {{lead.primeiro_nome|}}! Aqui é da Ribelt Têxtil', semNome)).toBe(
      'Oi! Aqui é da Ribelt Têxtil',
    );
    expect(interpolate('Oi {{lead.primeiro_nome|}}, tudo bem?', {})).toBe('Oi, tudo bem?');
    expect(interpolate('Oi {{lead.primeiro_nome|}} tudo bem', {})).toBe('Oi tudo bem');
    expect(interpolate('Oi {{lead.primeiro_nome|}}! Aqui é da Ribelt Têxtil', comNome)).toBe(
      'Oi Ana! Aqui é da Ribelt Têxtil',
    );
  });

  it('com reserva nunca sobra placeholder (não bloqueia o envio); sem reserva, segue como antes', () => {
    expect(placeholdersPendentes(interpolate('Oi {{x.y|}}!', {}))).toEqual([]);
    expect(interpolate('Oi {{lead.nome}}!', {})).toBe('Oi {{lead.nome}}!');
    expect(interpolate('Oi {{lead.nome}}!', {}, { ausenteVazio: true })).toBe('Oi !');
  });

  it('reserva entra escapada no e-mail (HTML)', () => {
    expect(interpolate('<p>{{x|<b>Oi</b>}}</p>', {}, { escapeHtml: true })).toBe(
      '<p>&lt;b&gt;Oi&lt;/b&gt;</p>',
    );
  });
});

describe('primeiroNome — "sem nome" (19/10)', () => {
  it('vazio, "Contato 123456" e só telefone contam como SEM nome', () => {
    for (const n of [
      '',
      '   ',
      null,
      'Contato 447710',
      'contato',
      'Contato (11) 99999-0000',
      '5511999990000',
      '+55 11 99999-0000',
    ]) {
      expect(primeiroNome(n)).toBe('');
    }
  });
  it('nome de gente continua sendo a 1ª palavra', () => {
    expect(primeiroNome('Ana Paula Souza')).toBe('Ana');
    expect(primeiroNome('Contatoria Ltda')).toBe('Contatoria');
  });
});
