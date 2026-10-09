import { describe, expect, it, vi } from 'vitest';
import { eventoCompra, sha256, telefoneMeta } from '@integrations/meta/meta-conversoes';
import { dispararPedidoPago, ouvirPedidoPago } from '@modules/pedidos/pedido-pago.evento';
import { MetaPixelService, pixelLigado } from './meta-pixel.service';
import { atribuicaoDoPedido } from './vitrine-pedido.service';
import { politicaDePrivacidade } from './privacidade';

/** Pixel do Meta + API de Conversões (card da #04, 09/10). */

const compra = {
  pedidoId: 'ped-1',
  numero: 'PED-0009',
  total: 664.65,
  pagoEm: new Date('2026-10-09T15:00:00Z'),
  telefone: '5547999991234',
  email: ' Maria@Loja.com ',
  nome: 'Maria Lojista',
  cidade: 'São Paulo',
  uf: 'SP',
  cep: '01310-100',
  clienteId: 'cli-1',
  itens: [{ produtoId: 'prod-p', quantidade: 2, preco: 45 }],
  url: 'https://atacado.ribelt.com.br/v/atacado-ribelt?utm_source=fb',
  ip: '200.1.2.3',
  userAgent: 'Mozilla/5.0',
  fbc: 'fb.1.1791500000000.AbC',
  fbp: 'fb.1.1791500000000.123',
};

describe('eventoCompra (CAPI)', () => {
  it('Purchase com event_id do pedido (o navegador manda o mesmo), BRL e itens', () => {
    const e = eventoCompra(compra);
    expect(e).toMatchObject({
      event_name: 'Purchase',
      event_id: 'pedido-ped-1',
      action_source: 'website',
      event_source_url: compra.url,
      event_time: 1791558000,
      custom_data: { currency: 'BRL', value: 664.65, order_id: 'PED-0009', num_items: 2 },
    });
  });

  it('dados do cliente cifrados e normalizados como o Meta pede; IP, navegador e cookies crus', () => {
    const u = eventoCompra(compra).user_data;
    expect(u.ph).toBe(sha256('5547999991234'));
    expect(u.em).toBe(sha256('maria@loja.com'));
    expect(u.fn).toBe(sha256('maria'));
    expect(u.ct).toBe(sha256('saopaulo'));
    expect(u.st).toBe(sha256('sp'));
    expect(u.zp).toBe(sha256('01310100'));
    expect(u.country).toBe(sha256('br'));
    expect(u).toMatchObject({
      client_ip_address: '200.1.2.3',
      client_user_agent: 'Mozilla/5.0',
      fbc: compra.fbc,
      fbp: compra.fbp,
    });
    // Nada em claro.
    expect(JSON.stringify(u)).not.toMatch(/maria|5547999991234|01310/i);
  });

  it('telefone ganha o 55; campo vazio não vai', () => {
    expect(telefoneMeta('(47) 99999-1234')).toBe('5547999991234');
    const u = eventoCompra({ ...compra, email: null, fbc: null }).user_data;
    expect(u).not.toHaveProperty('em');
    expect(u).not.toHaveProperty('fbc');
  });
});

describe('atribuicaoDoPedido', () => {
  it('campanha limpa, cookie do Meta só no formato oficial, IP só com navegador', () => {
    const a = atribuicaoDoPedido(
      {
        ultimo: { utmSource: 'Facebook ', fbclid: 'AbC', landingPage: 'https://x/v/a' },
        fbc: 'fb.1.1791500000000.AbC',
        fbp: '<script>',
      },
      { ip: '::ffff:200.1.2.3', userAgent: 'Mozilla/5.0' },
    );
    expect(a).toEqual({
      ultimo: { utmSource: 'facebook', fbclid: 'AbC', landingPage: 'https://x/v/a' },
      meta: { fbc: 'fb.1.1791500000000.AbC', userAgent: 'Mozilla/5.0', ip: '200.1.2.3' },
    });
    expect(atribuicaoDoPedido(undefined, { ip: '1.2.3.4' })).toBeUndefined();
  });
});

describe('ouvinte de PEDIDO_PAGO', () => {
  it('é chamado mesmo sem o motor de fluxos (a compra pro Meta não depende dele)', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const sair = ouvirPedidoPago(fn);
    await dispararPedidoPago({} as never, undefined, 'ped-1', {
      forma: 'PIX',
      parcelas: 1,
      online: true,
    });
    sair();
    expect(fn).toHaveBeenCalledWith('ped-1', { forma: 'PIX', parcelas: 1, online: true });
  });
});

describe('MetaPixelService.enviarCompra', () => {
  const pedido = (extra: Record<string, unknown> = {}) => ({
    id: 'ped-1',
    empresaId: 'emp-1',
    origem: 'VITRINE',
    numero: 'PED-0009',
    total: 664.65,
    pagoEm: new Date(),
    contatoTelefone: '5547999991234',
    contatoEmail: null,
    contatoNome: 'Maria',
    clienteId: 'cli-1',
    entrega: null,
    atribuicao: {
      ultimo: { landingPage: 'https://x/v/a' },
      meta: { userAgent: 'UA', ip: '1.2.3.4' },
    },
    cliente: { cidade: 'Brusque', uf: 'SC', cep: null },
    itens: [{ produtoId: 'p', quantidade: 1, precoUnitario: 45 }],
    empresa: { config: { pixel: { ativo: true, pixelId: '1234567890', testEventCode: 'TEST1' } } },
    ...extra,
  });

  function montar(p: unknown, trava = 1, ok = true) {
    const prisma = {
      pedido: { findUnique: vi.fn().mockResolvedValue(p) },
      $executeRaw: vi.fn().mockResolvedValueOnce(trava).mockResolvedValue(1),
    };
    const integracoes = {
      obterCredenciaisInternas: vi
        .fn()
        .mockResolvedValue({ credenciais: { accessToken: 'TOKEN-X' } }),
    };
    const http = vi.fn().mockResolvedValue({
      ok,
      status: ok ? 200 : 400,
      json: async () => ({ error: { message: 'Invalid parameter' } }),
    });
    class T extends MetaPixelService {
      protected override http(url: string, init: RequestInit) {
        return http(url, init);
      }
    }
    const svc = new T(prisma as never, integracoes as never, { get: () => 'v21.0' } as never);
    return { svc, prisma, http };
  }

  it('manda o Purchase uma vez, com o código de teste, e grava o resultado', async () => {
    const { svc, prisma, http } = montar(pedido());
    await svc.enviarCompra('ped-1');
    expect(http).toHaveBeenCalledTimes(1);
    const [url, init] = http.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v21.0/1234567890/events?access_token=TOKEN-X');
    const corpo = JSON.parse(init.body);
    expect(corpo.test_event_code).toBe('TEST1');
    expect(corpo.data[0]).toMatchObject({ event_name: 'Purchase', event_id: 'pedido-ped-1' });
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(2); // trava + resultado
  });

  it('pagamento repetido (trava já tomada): não manda de novo', async () => {
    const { svc, http } = montar(pedido(), 0);
    await svc.enviarCompra('ped-1');
    expect(http).not.toHaveBeenCalled();
  });

  it('não é da vitrine, pixel desligado ou pedido sem navegador: não manda', async () => {
    for (const p of [
      pedido({ origem: 'REP_APP' }),
      pedido({ empresa: { config: { pixel: { ativo: false, pixelId: '1234567890' } } } }),
      pedido({ atribuicao: { meta: { ip: '1.2.3.4' } } }),
    ]) {
      const { svc, http } = montar(p);
      await svc.enviarCompra('ped-1');
      expect(http).not.toHaveBeenCalled();
    }
  });

  it('Meta recusou ou rede caiu: nunca lança (o pagamento já está gravado)', async () => {
    const { svc } = montar(pedido(), 1, false);
    await expect(svc.enviarCompra('ped-1')).resolves.toBeUndefined();
    const caiu = montar(pedido());
    caiu.http.mockRejectedValue(new Error('timeout'));
    await expect(caiu.svc.enviarCompra('ped-1')).resolves.toBeUndefined();
  });

  it('pixelLigado: precisa de ativo E do ID', () => {
    expect(pixelLigado({ pixel: { ativo: true, pixelId: '123' } })).toBe('123');
    expect(pixelLigado({ pixel: { ativo: true } })).toBeNull();
    expect(pixelLigado({ pixel: { ativo: false, pixelId: '123' } })).toBeNull();
  });
});

describe('política com o pixel', () => {
  const base = {
    controlador: 'X Ltda',
    marca: 'X',
    cnpj: null,
    cidade: null,
    uf: null,
    email: 'p@x.com',
    atualizadaEm: '2026-10-09',
  };
  const texto = (pixel: boolean) =>
    politicaDePrivacidade({
      ...base,
      usa: { pagamentoOnline: false, frete: false, assistenteIa: false, pixel },
    })
      .secoes.flatMap((s) => [...s.paragrafos, ...(s.itens ?? [])])
      .join('\n');

  it('pixel ligado: explica navegação, anúncios e o hash; desligado: não cita', () => {
    expect(texto(true)).toMatch(/Pixel da Meta/);
    expect(texto(true)).toMatch(/formato cifrado \(hash\)/);
    expect(texto(false)).not.toMatch(/Pixel/);
  });
});
