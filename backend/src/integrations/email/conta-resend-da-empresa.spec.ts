import { describe, expect, it, vi } from 'vitest';
import { CryptoUtil } from '@shared/utils/crypto.util';
import { TransactionalEmailService } from './transactional-email.service';

/** Conta Resend PRÓPRIA da empresa (Léo, 19/10: Ribelt manda do domínio dela). */

const CHAVE = 'b'.repeat(64);
const cifrar = (o: unknown) => new CryptoUtil(CHAVE).encrypt(JSON.stringify(o));

function montar(o: {
  conexao?: { ativo: boolean; credenciais: string } | null;
  falhaEmpresa?: boolean;
}) {
  const resend = {
    isConfigured: vi.fn().mockReturnValue(true),
    enviar: vi.fn(async (p: { apiKey?: string }) => {
      if (o.falhaEmpresa && p.apiKey) throw new Error('Resend HTTP 403: domain not verified');
      return { id: 're_1', status: 200 };
    }),
  };
  const prisma = {
    empresa: { findUnique: vi.fn().mockResolvedValue({ nome: 'Ribelt Têxtil', config: null }) },
    integracaoConexao: { findUnique: vi.fn().mockResolvedValue(o.conexao ?? null) },
  };
  const env = { get: vi.fn((k: string) => (k === 'ENCRYPTION_KEY' ? CHAVE : '')) };
  const svc = new TransactionalEmailService(
    resend as never,
    env as never,
    prisma as never,
    undefined as never,
  );
  return { svc, resend };
}

const enviar = (svc: TransactionalEmailService, extra: Record<string, unknown> = {}) =>
  svc.enviarHtmlLivre({
    para: 'cliente@x.com',
    assunto: 'Oi',
    html: '<p>oi</p>',
    empresaId: 'emp-1',
    ...extra,
  });

describe('conta Resend da empresa', () => {
  it('com a conexão: sai pela chave e pelo remetente DA EMPRESA', async () => {
    const { svc, resend } = montar({
      conexao: {
        ativo: true,
        credenciais: cifrar({ apiKey: 're_empresa', fromEmail: 'Comercial@Ribelt.com.br' }),
      },
    });
    expect((await enviar(svc)).ok).toBe(true);
    expect(resend.enviar.mock.calls[0][0]).toMatchObject({
      apiKey: 're_empresa',
      fromEmail: 'comercial@ribelt.com.br',
      fromNome: 'Ribelt Têxtil',
    });
  });

  it('sem conexão (ou desativada): conta do sistema, como sempre', async () => {
    for (const conexao of [
      null,
      { ativo: false, credenciais: cifrar({ apiKey: 're_x', fromEmail: 'a@b.com' }) },
    ]) {
      const { svc, resend } = montar({ conexao });
      await enviar(svc);
      expect(resend.enviar.mock.calls[0][0].apiKey).toBeUndefined();
    }
  });

  it('a conta da empresa recusou: o e-mail sai pela do sistema (não deixa de sair)', async () => {
    const { svc, resend } = montar({
      conexao: {
        ativo: true,
        credenciais: cifrar({ apiKey: 're_empresa', fromEmail: 'comercial@ribelt.com.br' }),
      },
      falhaEmpresa: true,
    });
    expect((await enviar(svc)).ok).toBe(true);
    expect(resend.enviar).toHaveBeenCalledTimes(2);
    expect(resend.enviar.mock.calls[1][0]).toMatchObject({ fromEmail: undefined });
    expect(resend.enviar.mock.calls[1][0].apiKey).toBeUndefined();
  });

  it('credencial ilegível: conta do sistema', async () => {
    const { svc, resend } = montar({ conexao: { ativo: true, credenciais: 'lixo' } });
    expect((await enviar(svc)).ok).toBe(true);
    expect(resend.enviar.mock.calls[0][0].apiKey).toBeUndefined();
  });
});
