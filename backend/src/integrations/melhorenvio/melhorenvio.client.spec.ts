import { describe, expect, it } from 'vitest';
import { MelhorEnvioEtiquetaClient, linkPdfConfiavel, resumoErros } from './melhorenvio.client';
import { vi } from 'vitest';

/** Mensagem do 422 do Melhor Envio (PED-0008, 14/10). */
describe('resumoErros', () => {
  it('erros por campo: junta até 3', () => {
    expect(
      resumoErros({
        errors: { 'to.email': ['E-mail obrigatório'], 'from.phone': ['Telefone inválido'] },
      }),
    ).toBe('E-mail obrigatório; Telefone inválido');
  });

  it('só message (+ suggestion): mostra os dois — era "dados inválidos"', () => {
    expect(
      resumoErros({
        message:
          'E-CRT-0001: O valor segurado em envios não comerciais não pode ser maior que R$ 1.000,00.',
        suggestion: 'Considere alterar o valor do seguro ou o tipo de envio.',
        context: [],
      }),
    ).toBe(
      'E-CRT-0001: O valor segurado em envios não comerciais não pode ser maior que R$ 1.000,00. Considere alterar o valor do seguro ou o tipo de envio.',
    );
  });

  it('nada aproveitável: "dados inválidos"', () => {
    expect(resumoErros(null)).toBe('dados inválidos');
    expect(resumoErros({ errors: {} })).toBe('dados inválidos');
  });
});

/** Etiqueta sem login (14/10): o PDF vem pela API, 1 id por chamada, só do S3. */
describe('pdfs da etiqueta', () => {
  const S3 = 'https://me-0047-sandbox.s3.amazonaws.com/pdf/x.pdf?X-Amz-Expires=1800';
  const pdf = new TextEncoder().encode('%PDF-1.4 teste');
  const resp = (corpo: unknown, ok = true, status = 200) => ({
    ok,
    status,
    json: async () => corpo,
    arrayBuffer: async () => (corpo instanceof Uint8Array ? corpo.buffer : new ArrayBuffer(0)),
  });

  it('link confiável: só https no S3 da Amazon', () => {
    expect(linkPdfConfiavel(S3)).toBe(true);
    expect(linkPdfConfiavel('http://me.s3.amazonaws.com/x.pdf')).toBe(false);
    expect(linkPdfConfiavel('https://evil.com/x.amazonaws.com.pdf')).toBe(false);
    expect(linkPdfConfiavel('não é url')).toBe(false);
  });

  it('uma chamada por etiqueta, com o token; baixa o S3 SEM o token', async () => {
    const f = vi.fn(async (u: string) => (u.includes('/imprimir/pdf/') ? resp([S3]) : resp(pdf)));
    const cli = new MelhorEnvioEtiquetaClient('tok', 'sandbox', 'tec@x', f as never);
    const r = await cli.pdfs(['a', 'b']);
    expect(r).toHaveLength(2);
    expect(f.mock.calls.map(([u]) => String(u))).toEqual([
      'https://sandbox.melhorenvio.com.br/api/v2/me/imprimir/pdf/a',
      S3,
      'https://sandbox.melhorenvio.com.br/api/v2/me/imprimir/pdf/b',
      S3,
    ]);
    const s3Init = (f.mock.calls[1] as unknown[])[1] as { headers?: unknown };
    expect(s3Init.headers).toBeUndefined();
  });

  it('link fora do S3 ou arquivo que não é PDF: erro, não entrega lixo', async () => {
    const fora = vi.fn(async () => resp(['https://evil.com/x.pdf']));
    await expect(
      new MelhorEnvioEtiquetaClient('tok', 'sandbox', '', fora as never).pdfs(['a']),
    ).rejects.toThrow(/fora do armazenamento/);
    const html = vi.fn(async (u: string) =>
      u.includes('/imprimir/pdf/') ? resp([S3]) : resp(new TextEncoder().encode('<html>login')),
    );
    await expect(
      new MelhorEnvioEtiquetaClient('tok', 'sandbox', '', html as never).pdfs(['a']),
    ).rejects.toThrow(/download falhou/);
  });
});
