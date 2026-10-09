import { describe, expect, it, vi } from 'vitest';
import { MelhorEnvioClient } from '@integrations/melhorenvio/melhorenvio.client';
import { FreteIndisponivel, FreteService } from './frete.service';
import { montarVolumes, type ConfigFrete } from './frete';
import { freteConfigSchema } from './vitrine.dto';

const user = { id: 'u-1', role: 'DIRECTOR', empresaIdAtiva: 'emp-1', empresaIds: ['emp-1'] };

const cfg: ConfigFrete = {
  ativo: true,
  ambiente: 'sandbox',
  cepOrigem: '89200000',
  pesoMaxVolumeKg: 25,
  caixas: [
    {
      nome: 'Caixa',
      comprimentoCm: 50,
      larguraCm: 50,
      alturaCm: 38,
      pesoVazioG: 800,
      capacidadePecas: 80,
    },
  ],
};

function montar(opts: { cred?: unknown; config?: unknown } = {}) {
  const prisma = {
    empresa: {
      findUnique: vi.fn().mockResolvedValue({ config: opts.config ?? { frete: cfg } }),
    },
    $executeRaw: vi.fn().mockResolvedValue(1),
  };
  const integracoes = {
    obterCredenciaisInternas: vi.fn(() =>
      opts.cred === null
        ? Promise.reject(new Error('não conectado'))
        : Promise.resolve({ credenciais: opts.cred ?? { token: 'tk', email: 'ti@x.com' } }),
    ),
  };
  const cotar = vi.fn().mockResolvedValue([
    { id: 1, nome: 'PAC', transportadora: 'Correios', precoC: 2000, prazoDias: 6 },
    { id: 2, nome: 'SEDEX', transportadora: 'Correios', precoC: 4000, prazoDias: 2 },
  ]);
  class Teste extends FreteService {
    protected override cliente() {
      return { cotar } as unknown as MelhorEnvioClient;
    }
  }
  const svc = new Teste(prisma as never, integracoes as never);
  return { svc, prisma, cotar };
}

describe('FreteService.cotarPesos', () => {
  it('volumes iguais cotam UMA vez e o preço soma por volume', async () => {
    const { svc, cotar } = montar();
    // 160 peças de 100 g → 2 caixas iguais (80 peças, 8,8 kg cada).
    const r = await svc.cotarPesos(
      'emp-1',
      cfg,
      '88350-000',
      Array.from({ length: 160 }, () => 100),
      1600,
    );
    expect(cotar).toHaveBeenCalledTimes(1);
    expect(cotar.mock.calls[0][1]).toBe('88350000');
    expect(cotar.mock.calls[0][2]).toMatchObject({ pesoG: 8800, seguro: 800 });
    expect(r.volumes).toHaveLength(2);
    expect(r.opcoes[0]).toEqual({
      id: 1,
      nome: 'PAC',
      transportadora: 'Correios',
      preco: 40,
      prazoDias: 6,
    });
  });

  it('cota de novo em 10 min: vem do cache (a tela cota, o pedido cota de novo)', async () => {
    const { svc, cotar } = montar();
    await svc.cotarPesos('emp-1', cfg, '88350000', [300, 300], 90);
    await svc.cotarPesos('emp-1', cfg, '88350000', [300, 300], 90);
    expect(cotar).toHaveBeenCalledTimes(1);
  });

  it('sem declarar valor: seguro zero', async () => {
    const { svc, cotar } = montar();
    await svc.cotarPesos('emp-1', { ...cfg, declararValor: false }, '88350000', [300], 45);
    expect(cotar.mock.calls[0][2].seguro).toBe(0);
  });

  it('Melhor Envio fora, sem conexão, peça sem peso ou config incompleta → FreteIndisponivel', async () => {
    const fora = montar();
    fora.cotar.mockRejectedValue(new Error('timeout'));
    await expect(fora.svc.cotarPesos('emp-1', cfg, '88350000', [300], 45)).rejects.toBeInstanceOf(
      FreteIndisponivel,
    );
    const semConexao = montar({ cred: null });
    await expect(
      semConexao.svc.cotarPesos('emp-1', cfg, '88350000', [300], 45),
    ).rejects.toBeInstanceOf(FreteIndisponivel);
    const { svc } = montar();
    await expect(svc.cotarPesos('emp-1', cfg, '88350000', [300, 0], 45)).rejects.toThrow(
      /sem peso/,
    );
    await expect(
      svc.cotarPesos('emp-1', { ...cfg, cepOrigem: '' }, '88350000', [300], 45),
    ).rejects.toThrow(/CEP de origem/);
  });

  it('nenhuma transportadora e sem retirada → FreteIndisponivel', async () => {
    const { svc, cotar } = montar();
    cotar.mockResolvedValue([]);
    await expect(svc.cotarPesos('emp-1', cfg, '88350000', [300], 45)).rejects.toThrow(
      /Nenhuma transportadora/,
    );
  });
});

describe('FreteService.salvar', () => {
  const dto = {
    ...cfg,
    ativo: true,
    ambiente: 'sandbox' as const,
    cepOrigem: '89200000',
    pesoMaxVolumeKg: 25,
    declararValor: true,
    embalagemIndividual: null,
    caixas: cfg.caixas!,
    retirada: { ativo: false, minimoPecas: 1000, endereco: '', horario: '' },
  };

  it('ligar sem o Melhor Envio conectado: recusa', async () => {
    const { svc, prisma } = montar({ cred: null });
    await expect(svc.salvar(user as never, dto)).rejects.toThrow(/Conecte o Melhor Envio/);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('ligar com config incompleta: diz o que falta', async () => {
    const { svc } = montar();
    await expect(svc.salvar(user as never, { ...dto, caixas: [] })).rejects.toThrow(/caixa/);
  });

  it('desligado salva mesmo incompleto (pra preencher aos poucos)', async () => {
    const { svc, prisma } = montar({ cred: null });
    await svc.salvar(user as never, { ...dto, ativo: false, cepOrigem: '', caixas: [] });
    expect(prisma.$executeRaw).toHaveBeenCalled();
  });
});

describe('FreteService.buscarCep', () => {
  it('traduz o ViaCEP; "erro" e falha de rede viram null', async () => {
    const { svc } = montar();
    const ok = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        logradouro: 'Rua Azambuja',
        bairro: 'Centro',
        localidade: 'Brusque',
        uf: 'SC',
      }),
    });
    expect(await svc.buscarCep('88350-000', ok as never)).toEqual({
      cep: '88350000',
      endereco: 'Rua Azambuja',
      bairro: 'Centro',
      cidade: 'Brusque',
      uf: 'SC',
    });
    const naoAchou = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ erro: true }) });
    expect(await svc.buscarCep('00000000', naoAchou as never)).toBeNull();
    const caiu = vi.fn().mockRejectedValue(new Error('rede'));
    expect(await svc.buscarCep('88350000', caiu as never)).toBeNull();
  });
});

describe('MelhorEnvioClient.cotar', () => {
  const resposta = (status: number, corpo: unknown) =>
    vi
      .fn()
      .mockResolvedValue({ ok: status < 400, status, text: async () => JSON.stringify(corpo) });

  it('manda o volume em cm/kg, usa custom_price e ignora serviço com erro', async () => {
    const f = resposta(200, [
      {
        id: 1,
        name: 'PAC',
        price: '30.00',
        custom_price: '25.50',
        delivery_time: 7,
        custom_delivery_time: 6,
        company: { name: 'Correios' },
      },
      { id: 2, name: 'SEDEX', error: 'Dimensões excedidas', company: { name: 'Correios' } },
    ]);
    const me = new MelhorEnvioClient('tk', 'sandbox', 'ti@x.com', f as never);
    const r = await me.cotar('89200000', '88350000', {
      comprimentoCm: 50,
      larguraCm: 50,
      alturaCm: 38,
      pesoG: 8800,
      seguro: 800,
    });
    expect(r).toEqual([
      { id: 1, nome: 'PAC', transportadora: 'Correios', precoC: 2550, prazoDias: 6 },
    ]);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://sandbox.melhorenvio.com.br/api/v2/me/shipment/calculate');
    expect(init.headers.Authorization).toBe('Bearer tk');
    expect(init.headers['User-Agent']).toContain('ti@x.com');
    expect(JSON.parse(init.body).volumes[0]).toEqual({
      width: 50,
      height: 38,
      length: 50,
      weight: 8.8,
      insurance: 800,
    });
  });

  it('401 vira mensagem sem o token', async () => {
    const me = new MelhorEnvioClient('segredo-123', 'producao', '', resposta(401, {}) as never);
    const err = await me
      .cotar('89200000', '88350000', {
        comprimentoCm: 1,
        larguraCm: 1,
        alturaCm: 1,
        pesoG: 1,
        seguro: 0,
      })
      .catch((e: Error) => e);
    expect(String(err)).toMatch(/recusou o token/);
    expect(String(err)).not.toContain('segredo-123');
  });
});

describe('09/10: caixa pela metade não trava o "Salvar" do frete desligado', () => {
  const corpo = (ativo: boolean) => ({
    ativo,
    ambiente: 'sandbox',
    cepOrigem: '01310-100',
    pesoMaxVolumeKg: 25,
    declararValor: true,
    embalagemIndividual: null,
    caixas: [
      {
        nome: 'Caixa grande',
        comprimentoCm: 50,
        larguraCm: 50,
        alturaCm: 38,
        pesoVazioG: null,
        capacidadePecas: null,
      },
    ],
    retirada: { ativo: false, minimoPecas: 1000, endereco: '', horario: '' },
  });

  it('o schema aceita a caixa sem peso vazio e capacidade', () => {
    expect(freteConfigSchema.safeParse(corpo(false)).success).toBe(true);
  });

  it('desligado: salva; pra ligar: recusa até a caixa estar completa', async () => {
    const { svc, prisma } = montar();
    await svc.salvar(user as never, freteConfigSchema.parse(corpo(false)));
    expect(prisma.$executeRaw).toHaveBeenCalled();
    await expect(svc.salvar(user as never, freteConfigSchema.parse(corpo(true)))).rejects.toThrow(
      /caixa completa/,
    );
  });

  it('caixa incompleta salva não monta volume (nem quebra a cotação)', () => {
    expect(() => montarVolumes([300], { ...cfg, caixas: [{ ...corpo(false).caixas[0] }] })).toThrow(
      /sem caixa/,
    );
  });
});
