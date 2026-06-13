import { describe, expect, it } from 'vitest';
import { interpolate } from './interpolate';

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
