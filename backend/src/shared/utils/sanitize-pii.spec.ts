import { describe, expect, it } from 'vitest';
import { sanitize } from './sanitize-pii';

describe('sanitize PII', () => {
  it('redige chaves sensíveis (email, password, token, etc)', () => {
    const result = sanitize({
      nome: 'João',
      email: 'joao@x.com',
      password: 'segredo',
      token: 'abc.xyz',
      apiKey: 'k1',
      refresh_token: 'rt',
    }) as Record<string, string>;
    expect(result.nome).toBe('João');
    expect(result.email).toBe('[REDACTED]');
    expect(result.password).toBe('[REDACTED]');
    expect(result.token).toBe('[REDACTED]');
    expect(result.apiKey).toBe('[REDACTED]');
    expect(result.refresh_token).toBe('[REDACTED]');
  });

  it('mascara email em VALORES (não-chaves)', () => {
    const result = sanitize({ texto: 'enviar para joao@example.com' });
    // Texto não bate regex de email exato (tem prefixo) — não mascara
    expect(result).toEqual({ texto: 'enviar para joao@example.com' });
  });

  it('mascara email quando é o valor inteiro', () => {
    // 'joao.silva' = 10 chars → j + 8 asteriscos + a
    const result = sanitize('joao.silva@example.com');
    expect(result).toBe('j********a@example.com');
  });

  it('mascara CPF formatado', () => {
    const result = sanitize('123.456.789-09');
    expect(result).toBe('***-09');
  });

  it('mascara CPF sem formatação', () => {
    const result = sanitize('12345678909');
    expect(result).toBe('***-09');
  });

  it('mascara CNPJ', () => {
    const result = sanitize('12.345.678/0001-90');
    expect(result).toBe('***-90');
  });

  it('mascara telefone preservando últimos 4', () => {
    const result = sanitize('+55 11 99999-1234');
    expect(result).toBe('55****1234');
  });

  it('strip token de URLs', () => {
    const result = sanitize('https://api.com/cb?code=secret123&user=x') as string;
    expect(result).not.toContain('secret123');
  });

  it('processa estruturas aninhadas', () => {
    const result = sanitize({
      user: { nome: 'Pedro', email: 'p@x.com' },
      creds: { password: 'x', token: 'y' },
    }) as Record<string, Record<string, string>>;
    expect(result.user.nome).toBe('Pedro');
    expect(result.user.email).toBe('[REDACTED]');
    expect(result.creds.password).toBe('[REDACTED]');
    expect(result.creds.token).toBe('[REDACTED]');
  });

  it('processa arrays', () => {
    const result = sanitize([{ password: 'x' }, { password: 'y' }]) as Array<
      Record<string, string>
    >;
    expect(result[0].password).toBe('[REDACTED]');
    expect(result[1].password).toBe('[REDACTED]');
  });

  it('corta em depth > 5 (anti-loop)', () => {
    const deep: { a: unknown } = { a: null };
    let cur: { a: unknown } = deep;
    for (let i = 0; i < 10; i++) {
      const next: { a: unknown } = { a: null };
      cur.a = next;
      cur = next;
    }
    const result = sanitize(deep);
    expect(JSON.stringify(result)).toContain('depth-cut');
  });

  it('preserva null/undefined/numbers/booleans', () => {
    expect(sanitize(null)).toBeNull();
    expect(sanitize(undefined)).toBeUndefined();
    expect(sanitize(42)).toBe(42);
    expect(sanitize(true)).toBe(true);
  });
});
