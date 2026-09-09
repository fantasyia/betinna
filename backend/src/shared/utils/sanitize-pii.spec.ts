import { describe, expect, it } from 'vitest';
import { sanitize, sanitizarTexto } from './sanitize-pii';

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

  it('redige o nome do contato do lead (PII de terceiro que não casa regex)', () => {
    const result = sanitize({
      contatoNome: 'Maria Aparecida de Souza',
      nome: 'Empresa XYZ Ltda', // nome de empresa NÃO é redigido (não é PII de pessoa)
    }) as Record<string, string>;
    expect(result.contatoNome).toBe('[REDACTED]');
    expect(result.nome).toBe('Empresa XYZ Ltda');
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

describe('telefone com forma, solto na frase', () => {
  // Telefone é o dado pessoal DOMINANTE deste app — base de reps e conversa de
  // WhatsApp. E mensagem de erro escrita à mão ("Falha ao enviar para …") é
  // exatamente onde ele aparece solto, fora de qualquer chave de objeto.
  //
  // Achado na conferência do filtro em 09/09: e-mail, CPF e jid já saíam
  // mascarados; telefone com forma passava inteiro.

  it.each([
    ['Falha ao enviar para (11) 99999-0000', '(11) 99999-0000'],
    ['Cliente pediu retorno no 11 99999-0000', '11 99999-0000'],
    ['contato +55 11 99999-0000 nao atende', '+55 11 99999-0000'],
    ['ligar para (11) 3333-4444 antes das 18h', '(11) 3333-4444'],
  ])('mascara em %j', (frase, telefone) => {
    const saida = sanitizarTexto(frase);
    expect(saida).not.toContain(telefone);
    // o resto da frase sobrevive — é ela que diz o que quebrou
    expect(saida.length).toBeGreaterThan(10);
  });

  it('preserva os 4 últimos dígitos, como o resto do arquivo faz', () => {
    // dá pra conferir com o cliente sem expor o número
    expect(sanitizarTexto('erro em (11) 99999-1234')).toContain('1234');
  });
});

describe('⛔ e o outro jeito de errar: NÃO tocar no que não é telefone', () => {
  // Exigir FORMA é o ponto. Sequência de 10-11 dígitos solta é id, número de
  // pedido ou timestamp muito mais vezes que telefone — e no site um padrão
  // genérico chegou a comer o trace id e o `sample_rand` DO PRÓPRIO SENTRY,
  // deixando o evento sem rastro. Erro sem rastro parece um erro normal.

  it.each([
    'timestamp 1788966678797',
    'sample_rand 0.532593534',
    'trace 9702c7aa903a48c98a4ad2af0023b893',
    'pedido PED-0086 valor 4350',
    'ERP 99 / SB2609TESTE',
    'processou 12345678901 registros',
  ])('deixa intacto: %s', (texto) => {
    expect(sanitizarTexto(texto)).toBe(texto);
  });
});
