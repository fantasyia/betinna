import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { Reflector } from '@nestjs/core';
import { BusinessRuleException, IntegrationException } from '@shared/errors/app-exception';
import { CheckoutController } from './checkout.controller';
import { CheckoutService } from './checkout.service';

const user = {
  id: 'u-1',
  email: 'leo@x.com',
  role: 'DIRECTOR',
  empresaIdAtiva: 'emp-1',
  empresaIds: ['emp-1'],
};
const TOKEN = 'a'.repeat(64);

function montar(
  opts: { cred?: Record<string, unknown> | null; config?: unknown; publica?: string } = {},
) {
  const prisma = {
    empresa: { findUnique: vi.fn().mockResolvedValue({ config: opts.config ?? {} }) },
    $executeRaw: vi.fn().mockResolvedValue(1),
    asaasEvento: { create: vi.fn().mockResolvedValue({}) },
  };
  const integracoes = {
    obterCredenciaisInternas: vi.fn(async () => {
      if (opts.cred === null) throw new Error('não configurada');
      return { credenciais: opts.cred ?? { apiKey: '$aact_hmlg_x' } };
    }),
    salvarCredenciaisInternas: vi.fn().mockResolvedValue(undefined),
  };
  const env = {
    get: (k: string) =>
      k === 'API_PUBLIC_URL'
        ? (opts.publica ?? 'https://api.exemplo.com')
        : k === 'API_PREFIX'
          ? 'api/v1'
          : undefined,
  };
  const asaas = {
    ambiente: 'sandbox',
    saldo: vi.fn().mockResolvedValue({ balance: 0 }),
    taxas: vi.fn().mockResolvedValue({
      cartao: { fixa: 0.49, umaVez: 1.99, ateSeis: 2.49, ateDoze: 2.99 },
      pix: { percentual: 0.99, fixa: null, minima: 0.29, maxima: 1.99 },
    }),
    salvarWebhook: vi.fn().mockResolvedValue({ id: 'wh_1' }),
  };
  class Svc extends CheckoutService {
    protected override cliente() {
      return asaas as never;
    }
  }
  const svc = new Svc(prisma as never, integracoes as never, env as never);
  return { svc, prisma, integracoes, asaas };
}

describe('CheckoutService — ligar a conta Asaas (entrega 1)', () => {
  it('controller: só ADMIN e DIRECTOR', () => {
    expect(new Reflector().get<string[]>('roles', CheckoutController)).toEqual([
      'ADMIN',
      'DIRECTOR',
    ]);
  });

  it('ativar sem conta conectada em Integrações: recusa com instrução', async () => {
    const { svc } = montar({ cred: null });
    await expect(svc.ativar(user as never)).rejects.toThrow(/Conecte a conta do Asaas/);
  });

  it('ativar: confere a chave, lê taxas, cadastra o aviso e guarda o código só na credencial', async () => {
    const { svc, asaas, integracoes, prisma } = montar();
    await svc.ativar(user as never);
    expect(asaas.saldo).toHaveBeenCalled();
    const [dados, id] = asaas.salvarWebhook.mock.calls[0];
    expect(dados.url).toBe('https://api.exemplo.com/api/v1/webhooks/asaas/emp-1');
    expect(dados.authToken).toMatch(/^[0-9a-f]{64}$/);
    expect(dados.email).toBe('leo@x.com');
    expect(id).toBeUndefined();
    const cred = integracoes.salvarCredenciaisInternas.mock.calls[0][2];
    expect(cred).toMatchObject({
      apiKey: '$aact_hmlg_x',
      webhookId: 'wh_1',
      webhookToken: dados.authToken,
    });
    // config.checkout: estado e taxas, NUNCA a chave nem o código
    // Tagged template: [partes do SQL, ...valores] — o JSON da config é um dos valores.
    const sql = prisma.$executeRaw.mock.calls[0].slice(1).map(String).join(' ');
    expect(sql).toContain('"ativo":true');
    expect(sql).toContain('"ambiente":"sandbox"');
    expect(sql).not.toContain('$aact_');
    expect(sql).not.toContain(dados.authToken);
  });

  it('empresa com domínio de API próprio (Ribelt, 15/10): o aviso usa o domínio dela', async () => {
    const { svc, asaas } = montar({ config: { dominioApi: 'https://api.ribelt.com.br' } });
    await svc.ativar(user as never);
    expect(asaas.salvarWebhook.mock.calls[0][0].url).toBe(
      'https://api.ribelt.com.br/api/v1/webhooks/asaas/emp-1',
    );
    // valor torto não vira endereço: cai na origem geral
    expect(svc.urlDoWebhook('emp-1', 'javascript:alert(1)')).toBe(
      'https://api.exemplo.com/api/v1/webhooks/asaas/emp-1',
    );
  });

  it('ativar de novo reaproveita o mesmo aviso e o mesmo código (atualiza, não duplica)', async () => {
    const { svc, asaas } = montar({
      cred: { apiKey: '$aact_hmlg_x', webhookId: 'wh_9', webhookToken: TOKEN },
    });
    await svc.ativar(user as never);
    expect(asaas.salvarWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ authToken: TOKEN }),
      'wh_9',
    );
  });

  it('sem API_PUBLIC_URL não cadastra aviso nenhum (o Asaas não teria pra onde avisar)', async () => {
    const { svc, asaas } = montar({ publica: '' });
    await expect(svc.ativar(user as never)).rejects.toBeInstanceOf(BusinessRuleException);
    expect(asaas.salvarWebhook).not.toHaveBeenCalled();
  });

  it('status: ativo só com flag E conta conectada; nada de segredo na resposta', async () => {
    const { svc } = montar({
      cred: { apiKey: '$aact_hmlg_x', webhookId: 'wh_1', webhookToken: TOKEN },
      config: { checkout: { ativo: true, ambiente: 'sandbox' } },
    });
    const s = await svc.status(user as never);
    expect(s).toMatchObject({
      conectado: true,
      ambiente: 'sandbox',
      ativo: true,
      avisoCadastrado: true,
    });
    expect(JSON.stringify(s)).not.toContain('$aact_');
    expect(JSON.stringify(s)).not.toContain(TOKEN);
  });
});

describe('CheckoutService — aviso de pagamento (webhook)', () => {
  const evento = { id: 'evt_1', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1', value: 100 } };

  it('código certo: grava o evento com a cobrança', async () => {
    const { svc, prisma } = montar({ cred: { apiKey: '$aact_hmlg_x', webhookToken: TOKEN } });
    await expect(svc.registrarAviso('emp-1', TOKEN, evento)).resolves.toEqual({ novo: true });
    expect(prisma.asaasEvento.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: 'evt_1',
        empresaId: 'emp-1',
        evento: 'PAYMENT_RECEIVED',
        pagamentoId: 'pay_1',
      }),
    });
  });

  it('código errado, ausente ou empresa sem conta: recusa e não grava', async () => {
    const com = montar({ cred: { apiKey: '$aact_hmlg_x', webhookToken: TOKEN } });
    await expect(com.svc.registrarAviso('emp-1', 'b'.repeat(64), evento)).rejects.toBeInstanceOf(
      IntegrationException,
    );
    await expect(com.svc.registrarAviso('emp-1', undefined, evento)).rejects.toBeInstanceOf(
      IntegrationException,
    );
    const sem = montar({ cred: null });
    await expect(sem.svc.registrarAviso('emp-1', TOKEN, evento)).rejects.toBeInstanceOf(
      IntegrationException,
    );
    expect(com.prisma.asaasEvento.create).not.toHaveBeenCalled();
    expect(sem.prisma.asaasEvento.create).not.toHaveBeenCalled();
  });

  it('aviso repetido (o Asaas entrega "pelo menos uma vez"): ACK sem duplicar', async () => {
    const { svc, prisma } = montar({ cred: { apiKey: '$aact_hmlg_x', webhookToken: TOKEN } });
    prisma.asaasEvento.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
    );
    await expect(svc.registrarAviso('emp-1', TOKEN, evento)).resolves.toEqual({ novo: false });
  });
});

describe('CheckoutService — saldo e extrato da conta Asaas (#01, 07/11)', () => {
  it('lê saldo e extrato com a chave do servidor e devolve sem a chave', async () => {
    const { svc, asaas } = montar({ cred: { apiKey: '$aact_prod_segredo' } });
    Object.assign(asaas, {
      ambiente: 'producao',
      saldo: vi.fn().mockResolvedValue({ balance: 12.5 }),
      extrato: vi.fn().mockResolvedValue({
        hasMore: false,
        totalCount: 1,
        limit: 100,
        offset: 0,
        data: [
          {
            id: 'ft1',
            value: 10,
            balance: 12.5,
            type: 'PAYMENT_RECEIVED',
            date: '2026-10-15',
            description: 'Pix',
            paymentId: 'pay_1',
          },
        ],
      }),
    });
    const r = await svc.contaAsaas(user as never, {
      inicio: '2026-10-01',
      fim: '2026-11-07',
      pagina: 2,
      porPagina: 50,
    });
    expect(
      (asaas as unknown as { extrato: ReturnType<typeof vi.fn> }).extrato,
    ).toHaveBeenCalledWith({
      inicio: '2026-10-01',
      fim: '2026-11-07',
      offset: 50,
      limite: 50,
    });
    expect(r).toMatchObject({ ambiente: 'producao', saldo: 12.5, total: 1, temMais: false });
    expect(r.lancamentos[0]).toEqual({
      data: '2026-10-15',
      valor: 10,
      saldoDepois: 12.5,
      tipo: 'PAYMENT_RECEIVED',
      descricao: 'Pix',
      cobranca: 'pay_1',
    });
    expect(JSON.stringify(r)).not.toContain('segredo');
  });

  it('sem conta conectada: recusa com o motivo', async () => {
    const { svc } = montar({ cred: null });
    await expect(
      svc.contaAsaas(user as never, {
        inicio: '2026-10-01',
        fim: '2026-10-02',
        pagina: 1,
        porPagina: 10,
      }),
    ).rejects.toThrow(/não conectada/);
  });
});
