import { afterEach, describe, expect, it, vi } from 'vitest';
import { DafitiAnunciosController } from './dafiti-anuncios.controller';
import { DafitiClientService, ESPERA_429 } from './dafiti.client';

const user = { empresaIdAtiva: 'e1' } as never;

describe('anúncios da Dafiti (07/11)', () => {
  const montar = (lidos: unknown[]) => {
    const get = vi.fn();
    for (const l of lidos) get.mockResolvedValueOnce(l);
    const enviar = vi.fn().mockResolvedValue({});
    return { get, enviar, ctrl: new DafitiAnunciosController({ get, enviar } as never) };
  };

  it('nome: PUT só com o nome e confere pela releitura', async () => {
    const { enviar, ctrl } = montar([{ name: 'velho' }, { name: 'novo' }]);
    const r = await ctrl.nome(user, 7, { nome: 'novo' });
    expect(enviar).toHaveBeenCalledWith('e1', 'PUT', '/v2/product-set/7', { name: 'novo' });
    expect(r).toEqual({ antes: 'velho', depois: 'novo', conferido: true });
  });

  it('atributos: manda só os pedidos e compara só eles', async () => {
    const { enviar, ctrl } = montar([
      { attributes: { '10': 'algodão', '20': 5 } },
      { attributes: { '10': 'poliéster', '20': 5 } },
    ]);
    const r = await ctrl.atributos(user, 7, { atributos: { '10': 'poliéster' } });
    expect(enviar.mock.calls[0][3]).toEqual({ attributes: { '10': 'poliéster' } });
    expect(r).toEqual({
      antes: { '10': 'algodão' },
      depois: { '10': 'poliéster' },
      conferido: true,
    });
  });

  it('atributos: id de opção mandado como número confere com o texto que a Dafiti devolve', async () => {
    const { ctrl } = montar([
      { attributes: { '19': '10', '101': ['1'] } },
      { attributes: { '19': '11', '101': ['3513', '3514'] } },
    ]);
    const r = await ctrl.atributos(user, 7, { atributos: { '19': 11, '101': [3513, 3514] } });
    expect(r.conferido).toBe(true);
  });

  it('atributos: conferido falso se a Dafiti descartou a troca', async () => {
    const { ctrl } = montar([{ attributes: { '10': 'a' } }, { attributes: { '10': 'a' } }]);
    const r = await ctrl.atributos(user, 7, { atributos: { '10': 'b' } });
    expect(r.conferido).toBe(false);
  });

  it('foto: adiciona por link na posição pedida', async () => {
    const { enviar, ctrl } = montar([[], [{ id: 1, position: 1 }]]);
    const r = await ctrl.adicionarFoto(user, 7, { url: 'https://x/a.jpg', posicao: 1 });
    expect(enviar).toHaveBeenCalledWith('e1', 'POST', '/v2/product-set/7/images', {
      displayUrl: 'https://x/a.jpg',
      position: 1,
    });
    expect(r.depois).toEqual([{ id: 1, position: 1 }]);
  });
});

describe('DafitiClientService: limite de taxa (07/11)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    ESPERA_429.ms = 1000;
  });

  const montar = () => {
    const svc = new DafitiClientService({
      obterCredenciaisInternas: vi
        .fn()
        .mockResolvedValue({ credenciais: { clientId: 'a', clientSecret: 'b' } }),
    } as never);
    ESPERA_429.ms = 0;
    return svc;
  };
  const token = () => new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }));

  it('429 espera e tenta de novo; o corpo vai em JSON', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 7 })));
    vi.stubGlobal('fetch', f);
    await expect(montar().enviar('e1', 'PUT', '/v2/product-set/7', { name: 'x' })).resolves.toEqual(
      { id: 7 },
    );
    expect(f).toHaveBeenCalledTimes(3);
    expect(f.mock.calls[2][1]).toMatchObject({ method: 'PUT', body: '{"name":"x"}' });
  });

  it('429 que não passa vira erro depois das tentativas', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(token())
      .mockResolvedValue(new Response('', { status: 429 }));
    vi.stubGlobal('fetch', f);
    await expect(montar().get('e1', '/v2/product-sets')).rejects.toThrow(/429/);
    expect(f).toHaveBeenCalledTimes(4);
  });
});
