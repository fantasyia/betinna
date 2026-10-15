import { describe, expect, it, vi } from 'vitest';
import { CarrinhoRecuperadorService } from './carrinho-recuperador.service';
import { refDoLead } from './carrinho-recuperador';

/** Recuperador de carrinho (Léo, 14/10): quando avisa e quando NÃO avisa. */

const AGORA = new Date('2026-10-14T20:00:00Z');
const CONFIG_ONLINE = {
  checkout: { ativo: true, taxas: { pix: 0 } },
  branding: { dominio: 'atacado.ribelt.com.br' },
};

function pedido(extra: Record<string, unknown> = {}) {
  return {
    id: 'ped-1',
    numero: 'PED-0009',
    status: 'CANCELADO',
    pagoEm: null,
    total: 1234.5,
    criadoEm: new Date('2026-10-14T19:30:00Z'),
    entrega: {},
    contatoNome: 'Maria Clara Souza',
    contatoTelefone: '5511999990000',
    clienteId: 'cli-1',
    cliente: { nome: 'Maria Clara Souza' },
    empresa: { config: CONFIG_ONLINE },
    itens: [
      { quantidade: 30, precoUnitario: 20 },
      { quantidade: 20, precoUnitario: 25 },
    ],
    ...extra,
  };
}

function montar(o: { pedido?: unknown; refez?: number; cas?: number; doRef?: unknown[] } = {}) {
  const prisma = {
    carrinhoSalvo: {
      findMany: vi.fn(async ({ where }: { where: { origem: string } }) =>
        where.origem === 'PEDIDO'
          ? [
              {
                id: 'c-1',
                token: 'tok-ped',
                pedidoId: 'ped-1',
                empresaId: 'emp-1',
                vitrineId: 'v-1',
              },
            ]
          : (o.doRef ?? []),
      ),
      updateMany: vi.fn().mockResolvedValue({ count: o.cas ?? 1 }),
    },
    pedido: {
      findUnique: vi.fn().mockResolvedValue(o.pedido === undefined ? pedido() : o.pedido),
      count: vi.fn().mockResolvedValue(o.refez ?? 0),
    },
    vitrine: {
      findUnique: vi
        .fn()
        .mockResolvedValue({ slug: 'atacado-ribelt', empresa: { config: CONFIG_ONLINE } }),
    },
  };
  const bus = { disparar: vi.fn().mockResolvedValue(undefined) };
  const env = { get: (k: string) => (k === 'ENCRYPTION_KEY' ? 'chave' : 'https://app.x') };
  const svc = new CarrinhoRecuperadorService(prisma as never, env as never, bus as never);
  return { svc, prisma, bus };
}

describe('CarrinhoRecuperadorService.verificar', () => {
  it('pedido não pago 20 min depois: PEDIDO_NAO_PAGO com link, primeiro nome, R$ e peças', async () => {
    const { svc, bus } = montar();
    expect(await svc.verificar(AGORA)).toBe(1);
    const [empresa, gatilho, ctx] = bus.disparar.mock.calls[0];
    expect(empresa).toBe('emp-1');
    expect(gatilho).toBe('PEDIDO_NAO_PAGO');
    expect(ctx.link).toBe('https://atacado.ribelt.com.br/?c=tok-ped');
    expect(ctx.cliente.primeiroNome).toBe('Maria');
    expect(ctx.pedido.totalPecas).toBe(50);
    expect(ctx.pedido.totalFormatado.replace(/\s/g, ' ')).toBe('R$ 1.234,50');
    expect(ctx.telefone).toBe('5511999990000');
  });

  it('NUNCA depois de pago: fecha o carrinho e não avisa', async () => {
    const { svc, bus, prisma } = montar({ pedido: pedido({ status: 'PAGO', pagoEm: new Date() }) });
    await svc.verificar(AGORA);
    expect(bus.disparar).not.toHaveBeenCalled();
    expect(prisma.carrinhoSalvo.updateMany.mock.calls[0][0].data).toHaveProperty('convertidoEm');
  });

  it('sem pagamento online, ou frete/preço a confirmar: quem fecha é a equipe — não avisa', async () => {
    for (const p of [
      pedido({ empresa: { config: {} } }),
      pedido({ entrega: { freteAConfirmar: true } }),
      pedido({ itens: [{ quantidade: 50, precoUnitario: 0 }] }),
    ]) {
      const { svc, bus } = montar({ pedido: p });
      await svc.verificar(AGORA);
      expect(bus.disparar).not.toHaveBeenCalled();
    }
  });

  it('refez o pedido depois (mesmo WhatsApp): não lembra do antigo', async () => {
    const { svc, bus } = montar({ refez: 1 });
    await svc.verificar(AGORA);
    expect(bus.disparar).not.toHaveBeenCalled();
  });

  it('UMA vez: se outro processo já marcou (CAS perdeu), não dispara', async () => {
    const { svc, bus } = montar({ cas: 0 });
    await svc.verificar(AGORA);
    expect(bus.disparar).not.toHaveBeenCalled();
  });

  it('carrinho do link do WhatsApp parado: CARRINHO_ABANDONADO com o lead, peças e link', async () => {
    const { svc, bus } = montar({
      pedido: pedido({ status: 'PAGO', pagoEm: new Date() }),
      doRef: [
        {
          id: 'c-2',
          token: 'tok-ref',
          leadId: 'lead-1',
          empresaId: 'emp-1',
          vitrineId: 'v-1',
          itens: [
            { corId: 'c', tamanhoId: 't', quantidade: 12 },
            { corId: 'c', tamanhoId: 'u', quantidade: 8 },
          ],
        },
      ],
    });
    await svc.verificar(AGORA);
    const ab = bus.disparar.mock.calls.find((c) => c[1] === 'CARRINHO_ABANDONADO')!;
    expect(ab[2]).toMatchObject({
      leadId: 'lead-1',
      carrinho: { pecas: 20 },
      link: 'https://atacado.ribelt.com.br/?c=tok-ref',
    });
  });
});

describe('CarrinhoRecuperadorService.salvarDoRef', () => {
  it('ref forjado não salva nada', async () => {
    const prisma = {
      vitrine: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'v-1',
          empresaId: 'emp-1',
          ativa: true,
          empresa: { ativo: true },
        }),
      },
      lead: { findFirst: vi.fn() },
      carrinhoSalvo: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    };
    const env = { get: () => 'chave' };
    const svc = new CarrinhoRecuperadorService(prisma as never, env as never, {} as never);
    const r = await svc.salvarDoRef(
      'atacado-ribelt',
      refDoLead('cmvleadlegitimo00', 'OUTRA-chave'),
      [{ corId: 'c', tamanhoId: 't', quantidade: 1 }],
    );
    expect(r).toEqual({ salvo: false });
    expect(prisma.carrinhoSalvo.create).not.toHaveBeenCalled();
  });
});
