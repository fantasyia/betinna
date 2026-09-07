import { describe, expect, it, vi } from 'vitest';
import { TEMPLATES_AMOSTRA, TransactionalEmailService } from './transactional-email.service';

/**
 * Amostra de template — o único teste de e-mail que vale.
 *
 * Preview de navegador e mensagem colada no Gmail NÃO valem: o compositor do
 * Gmail sanitiza o HTML na saída e come o fundo do botão; com rótulo branco, o
 * CTA some sem deixar rastro e quem revisa conclui que o template quebrou.
 * Estes testes garantem que a amostra sai pelo caminho real (mesmo HTML, mesmo
 * provedor) e com a marca do tenant — não com a do produto.
 */
const build = (
  marca: Record<string, unknown> | null = {
    corPrimaria: '#00416E',
    corAcao: '#F39200',
    logoEmailUrl: 'https://x/logo.png',
  },
) => {
  const enviar = vi.fn().mockResolvedValue({ status: 200, id: 'msg-1' });
  const prisma = {
    empresa: {
      findUnique: vi.fn().mockResolvedValue({
        nome: 'Somatec Blocking',
        config: marca ? { marca } : {},
      }),
    },
  };
  const svc = new TransactionalEmailService(
    { isConfigured: () => true, enviar } as never,
    { get: (k: string) => (k === 'FRONTEND_URL' ? 'https://app.tenant.com.br' : '') } as never,
    prisma as never,
    {} as never,
  );
  return { svc, enviar };
};

describe('amostra de template', () => {
  it('TODOS os templates que o sistema manda têm amostra — nenhum fica sem revisão', async () => {
    const { svc, enviar } = build();

    for (const t of TEMPLATES_AMOSTRA) {
      const r = await svc.enviarAmostraDeTemplate('emp-1', 'quem-revisa@x.com', t);
      expect(r.ok, `template ${t}`).toBe(true);
      expect(r.assunto.length, `template ${t}`).toBeGreaterThan(3);
    }
    expect(enviar).toHaveBeenCalledTimes(TEMPLATES_AMOSTRA.length);
  });

  it('sai com a marca do TENANT — é o ponto do teste', async () => {
    const { svc, enviar } = build();

    await svc.enviarAmostraDeTemplate('emp-1', 'quem-revisa@x.com', 'rastreio');

    const html = enviar.mock.calls[0][0].html as string;
    expect(html).toContain('#00416E');
    expect(html).toContain('logo.png');
    // Cor do CTA também no ATRIBUTO: sanitizador de cliente de e-mail derruba
    // o CSS antes do atributo, e sem o fundo o botão branco some no branco.
    expect(html).toMatch(/bgcolor="#F39200"|background-color:#F39200/i);
  });

  it('vai pro endereço pedido, não pro dono do token', async () => {
    // Quem revisa layout quase nunca é quem tem a credencial.
    const { svc, enviar } = build();

    await svc.enviarAmostraDeTemplate('emp-1', 'designer@outra.com', 'boas-vindas');

    expect(enviar.mock.calls[0][0].para).toBe('designer@outra.com');
  });

  it('tenant sem marca configurada cai no layout genérico, sem quebrar', async () => {
    // Marca é opt-in (logo E cor): meia configuração sairia com faixa colorida
    // e imagem quebrada, que é pior que o layout de sempre.
    const { svc } = build(null);

    const r = await svc.enviarAmostraDeTemplate('emp-1', 'x@y.com', 'comissao');

    expect(r.ok).toBe(true);
  });

  it('falha do provedor vira resultado, não exceção solta', async () => {
    const { svc, enviar } = build();
    enviar.mockResolvedValue({ status: 422, id: null });

    const r = await svc.enviarAmostraDeTemplate('emp-1', 'x@y.com', 'convite');

    expect(r).toMatchObject({ ok: false });
    expect(r.motivo).toContain('422');
  });
});
