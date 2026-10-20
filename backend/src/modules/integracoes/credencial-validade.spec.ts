import { describe, expect, it, vi } from 'vitest';
import { diasParaVencer, validadeDaCredencial } from './credencial-validade';
import { ValidadeCredencialJob } from './validade-credencial.job';

const jwt = (exp: number) =>
  `h.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.assinatura`;

describe('validadeDaCredencial', () => {
  it('Melhor Envio: lê o vencimento de DENTRO do token (JWT exp) — renovação manual', () => {
    const exp = Date.parse('2027-10-15T05:23:59Z') / 1000;
    const v = validadeDaCredencial('melhorenvio', { token: jwt(exp), email: 'a@b.com' });
    expect(v.expiraEm?.toISOString()).toBe('2027-10-15T05:23:59.000Z');
    expect(v.renovaSozinho).toBe(false);
  });

  it('chave que não vence (Asaas) não inventa data', () => {
    const v = validadeDaCredencial('asaas', { apiKey: '$aact_prod_xyz', webhookToken: 'abc' });
    expect(v).toEqual({ expiraEm: null, renovaSozinho: false });
  });

  it('Meta: a data é a do token de usuário, e o app renova sozinho', () => {
    const v = validadeDaCredencial('facebook', { userTokenExpiresAt: 1_800_000_000_000 });
    expect(v.renovaSozinho).toBe(true);
    expect(v.expiraEm?.getTime()).toBe(1_800_000_000_000);
  });

  it('OAuth com refresh (Tiny/ML): sem data — o token de horas seria ruído', () => {
    const v = validadeDaCredencial('tiny', { accessToken: jwt(2_000_000_000), expiresAt: 5 });
    expect(v).toEqual({ expiraEm: null, renovaSozinho: true });
  });
});

describe('diasParaVencer', () => {
  it('conta por data de São Paulo', () => {
    const agora = new Date('2027-09-15T12:00:00Z');
    expect(diasParaVencer(new Date('2027-10-15T05:23:59Z'), agora)).toBe(30);
    expect(diasParaVencer(new Date('2027-09-15T23:00:00Z'), agora)).toBe(0);
  });
});

describe('ValidadeCredencialJob.avisar', () => {
  const montar = (expiraEm: Date) => {
    const status = { alertarValidade: vi.fn(async () => undefined) };
    const integracoes = {
      validadesManuais: vi.fn(async () => [{ empresaId: 'e1', servico: 'melhorenvio', expiraEm }]),
    };
    const job = new ValidadeCredencialJob(
      integracoes as never,
      status as never,
      {} as never,
      {} as never,
    );
    return { job, status };
  };

  it('avisa a 30, 7, 1 e 0 dias — e só nesses dias', async () => {
    const vence = new Date('2027-10-15T12:00:00Z');
    const dias: number[] = [];
    for (let d = 40; d >= -2; d--) {
      const { job, status } = montar(vence);
      await job.avisar(new Date(vence.getTime() - d * 86_400_000));
      if (status.alertarValidade.mock.calls.length) dias.push(d);
    }
    expect(dias).toEqual([30, 7, 1, 0]);
  });
});
