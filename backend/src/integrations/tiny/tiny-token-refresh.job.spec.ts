import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TinyTokenRefreshJob } from './tiny-token-refresh.job';

/**
 * O refresh token do Tiny dura 1 DIA — não 30 dias como o do ML, nem 1 ano como
 * o do TikTok. Renovar só sob demanda (que é o que os outros OAuth fazem) não
 * basta: um fim de semana sem tráfego mata a conexão, e mata em silêncio.
 *
 * Este cron é a peça que impede isso. Os casos abaixo são os quatro estados que
 * uma conexão pode estar quando ele acorda.
 */
const HORA = 60 * 60_000;

function build(credenciais: Record<string, unknown> | null, lockOk = true) {
  const prisma = {
    integracaoConexao: {
      findMany: vi.fn().mockResolvedValue(credenciais ? [{ empresaId: 'emp-1' }] : []),
    },
  };
  const integracoes = {
    obterCredenciaisInternas: vi.fn().mockResolvedValue({ credenciais: credenciais ?? {} }),
    marcarDesconectado: vi.fn().mockResolvedValue(undefined),
  };
  const oauth = { renovar: vi.fn().mockResolvedValue({}) };
  const job = new TinyTokenRefreshJob(
    prisma as never,
    { get: () => 'production' } as never,
    { acquire: vi.fn().mockResolvedValue(lockOk) } as never,
    oauth as never,
    integracoes as never,
  );
  return { job, oauth, integracoes, prisma };
}

const cred = (horasRestantesDeRefresh: number) => ({
  accessToken: 'a',
  refreshToken: 'r',
  expiresAt: Date.now() + 4 * HORA,
  refreshExpiresAt: Date.now() + horasRestantesDeRefresh * HORA,
});

describe('cron de refresh do Tiny', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renova quando falta pouco de refresh (menos de 12h)', async () => {
    const { job, oauth } = build(cred(6));
    await job.renovarTokens();
    expect(oauth.renovar).toHaveBeenCalledWith(
      'emp-1',
      expect.objectContaining({ refreshToken: 'r' }),
    );
  });

  it('NÃO renova quando ainda há folga — não queima rotação à toa', async () => {
    // Cada renovação rotaciona o refresh; renovar de 3 em 3h sem necessidade só
    // aumenta a chance de corrida com uma renovação sob demanda.
    const { job, oauth } = build(cred(20));
    await job.renovarTokens();
    expect(oauth.renovar).not.toHaveBeenCalled();
  });

  it('refresh JÁ vencido: não tenta renovar, marca desconectado e avisa', async () => {
    // Aqui não há o que salvar — só reconexão manual pelo navegador resolve. O
    // alerta É o produto: sem ele, a descoberta viria por um pedido que não subiu.
    const { job, oauth, integracoes } = build(cred(-1));
    await job.renovarTokens();
    expect(oauth.renovar).not.toHaveBeenCalled();
    expect(integracoes.marcarDesconectado).toHaveBeenCalledWith(
      'emp-1',
      'tiny',
      expect.stringContaining('reconecte'),
    );
  });

  it('falha numa empresa não impede as outras', async () => {
    const { job, oauth, prisma, integracoes } = build(cred(6));
    prisma.integracaoConexao.findMany.mockResolvedValue([
      { empresaId: 'emp-1' },
      { empresaId: 'emp-2' },
    ]);
    integracoes.obterCredenciaisInternas
      .mockRejectedValueOnce(new Error('banco fora'))
      .mockResolvedValue({ credenciais: cred(6) });

    await expect(job.renovarTokens()).resolves.toBeUndefined();
    // A segunda empresa foi renovada mesmo com a primeira falhando — cada uma
    // tem seu próprio relógio de 1 dia correndo.
    expect(oauth.renovar).toHaveBeenCalledWith('emp-2', expect.anything());
  });

  it('sem o lock (outra instância na frente), não faz nada', async () => {
    // api e worker rodam o mesmo cron. Renovar em paralelo rotacionaria o
    // refresh duas vezes e derrubaria a conexão.
    const { job, prisma } = build(cred(6), false);
    await job.renovarTokens();
    expect(prisma.integracaoConexao.findMany).not.toHaveBeenCalled();
  });

  it('credencial incompleta é pulada, não explode o cron', async () => {
    const { job, oauth } = build({ accessToken: 'a' });
    await expect(job.renovarTokens()).resolves.toBeUndefined();
    expect(oauth.renovar).not.toHaveBeenCalled();
  });
});
