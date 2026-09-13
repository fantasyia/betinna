import { describe, expect, it } from 'vitest';
import { escapeHtml, interpolate, placeholdersPendentes } from './interpolate';

describe('interpolate', () => {
  const vars = { cliente: { nome: 'João' }, empresa: { nome: 'Acme' } };

  it('resolve caminho pontilhado', () => {
    expect(interpolate('Olá {{cliente.nome}} da {{empresa.nome}}', vars)).toBe('Olá João da Acme');
  });

  it('default: variável ausente mantém o literal {{x}} (fluxos/IA)', () => {
    expect(interpolate('Oi {{cliente.sobrenome}}', vars)).toBe('Oi {{cliente.sobrenome}}');
    expect(interpolate('Oi {{lead.nome}}', vars)).toBe('Oi {{lead.nome}}');
  });

  it('ausenteVazio: variável ausente vira string vazia (campanhas)', () => {
    expect(interpolate('Oi {{cliente.sobrenome}}', vars, { ausenteVazio: true })).toBe('Oi ');
    expect(interpolate('Oi {{lead.nome}}!', vars, { ausenteVazio: true })).toBe('Oi !');
  });

  it('valor presente é usado em ambos os modos', () => {
    expect(interpolate('{{cliente.nome}}', vars, { ausenteVazio: true })).toBe('João');
    expect(interpolate('{{cliente.nome}}', vars)).toBe('João');
  });

  it('vars null/não-objeto não quebra', () => {
    expect(interpolate('Oi {{x}}', null)).toBe('Oi {{x}}');
    expect(interpolate('Oi {{x}}', null, { ausenteVazio: true })).toBe('Oi ');
  });
});

describe('placeholdersPendentes', () => {
  it('lista o que sobrou depois de interpolar', () => {
    const texto = interpolate('Oi {{lead.nome}}, na {{empresa}}', { lead: { nome: 'Ana' } });

    expect(placeholdersPendentes(texto)).toEqual(['empresa']);
  });

  it('texto totalmente resolvido não tem pendência', () => {
    expect(placeholdersPendentes('Oi Ana, na Padaria')).toEqual([]);
  });

  it('não repete a mesma variável usada duas vezes', () => {
    expect(placeholdersPendentes('{{x}} e {{x}} de novo')).toEqual(['x']);
  });

  it('chave só com "{" solto não conta — o regex é estreito de propósito', () => {
    expect(placeholdersPendentes('preço { 10 } e { { a } }')).toEqual([]);
  });
});

/**
 * Auditoria 13/09/2026 (C-2): valor interpolado num template HTML ia cru —
 * nome digitado no site virava HTML no e-mail com a marca do tenant.
 */
describe('interpolate — escapeHtml pra template de e-mail', () => {
  it('escapa o VALOR, não o template', () => {
    const html = interpolate(
      '<p>Olá, {{lead.nome}}!</p>',
      { lead: { nome: 'Ana</p><a href="https://evil">x</a>' } },
      { escapeHtml: true },
    );
    expect(html).toBe(
      '<p>Olá, Ana&lt;/p&gt;&lt;a href=&quot;https://evil&quot;&gt;x&lt;/a&gt;!</p>',
    );
  });

  it('sem a opção, segue cru (WhatsApp é texto puro)', () => {
    expect(interpolate('Oi {{n}}', { n: '<b>' })).toBe('Oi <b>');
  });

  it('escapeHtml cobre & < > " \'', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });
});
