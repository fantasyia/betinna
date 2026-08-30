import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TinyWebhookController } from './tiny-webhook.controller';

/**
 * O Tiny NÃO assina os webhooks — sem HMAC, sem header de autenticação. O
 * segredo mora no CAMINHO da URL, que é a única coisa que o painel deixa
 * configurar. Por isso a comparação do segredo é o gate inteiro, e é ela que
 * este spec protege.
 *
 * O endpoint existe desde já porque o painel valida a URL antes de salvar
 * ("Não foi possível acessar a URL"): sem 200 respondendo, nem dá pra cadastrar.
 */
const SEGREDO = 'cqPBvP6SQKnKuUnDhzpd5E2b8z6paxug';

function build(secretConfigurado = SEGREDO) {
  const redis = { lpushCapped: vi.fn().mockResolvedValue(undefined) };
  const env = { get: vi.fn().mockReturnValue(secretConfigurado) };
  const mapeamento = { responder: vi.fn().mockResolvedValue({ mapeamentos: [] }) };
  return {
    ctrl: new TinyWebhookController(env as never, redis as never, mapeamento as never),
    redis,
    mapeamento,
  };
}

/** A resposta é escrita à mão (`@Res()`) pra escapar do ResponseInterceptor —
 *  o ERP espera o corpo cru do contrato dele, não o envelope do app. */
function fakeRes() {
  const res = {
    status: vi.fn(() => res),
    json: vi.fn(() => res),
    corpo: () => (res.json.mock.calls[0]?.[0] ?? null) as unknown,
  };
  return res;
}

const req = (corpo: unknown) =>
  ({ rawBody: Buffer.from(JSON.stringify(corpo)), body: corpo }) as never;

describe('webhook do Tiny', () => {
  beforeEach(() => vi.clearAllMocks());

  it('GET responde 200 — é o que destrava o cadastro da URL no painel', () => {
    const { ctrl } = build();
    expect(ctrl.verificar(SEGREDO, 'pedido')).toEqual({ ok: true, evento: 'pedido' });
  });

  it('segredo errado na URL é recusado', async () => {
    const { ctrl, redis } = build();
    await expect(
      ctrl.receber('outro-segredo-qualquer', 'pedido', req({}), fakeRes() as never),
    ).rejects.toThrow();
    // E não deixa rastro na fila: evento não autenticado não vira trabalho.
    expect(redis.lpushCapped).not.toHaveBeenCalled();
  });

  it('segredo de tamanho diferente não estoura o timingSafeEqual', async () => {
    // timingSafeEqual joga exceção se os buffers têm tamanhos diferentes — o
    // guard de length existe pra isso virar 401, não 500.
    const { ctrl } = build();
    await expect(ctrl.receber('curto', 'pedido', req({}), fakeRes() as never)).rejects.toThrow(
      /segredo inválido/,
    );
  });

  it('evento desconhecido é 404 — erro de digitação no painel aparece na hora', async () => {
    const { ctrl } = build();
    await expect(ctrl.receber(SEGREDO, 'pedidos', req({}), fakeRes() as never)).rejects.toThrow(
      /evento desconhecido/,
    );
  });

  it('os toggles de aviso respondem um ack simples', async () => {
    const { ctrl, redis } = build();
    for (const ev of ['pedido', 'rastreio', 'estoque', 'nota']) {
      const res = fakeRes();
      await ctrl.receber(SEGREDO, ev, req({ id: 1 }), res as never);
      expect(res.corpo()).toEqual({ ok: true });
    }
    expect(redis.lpushCapped).toHaveBeenCalledTimes(4);
  });

  it('guarda o corpo CRU + hash na fila, pra o processamento reprocessar e deduplicar', async () => {
    const { ctrl, redis } = build();
    await ctrl.receber(
      SEGREDO,
      'rastreio',
      req({ id: 42, codigoRastreamento: 'BR1' }),
      fakeRes() as never,
    );

    const [chave, valor, cap] = redis.lpushCapped.mock.calls[0] as [string, string, number];
    expect(chave).toBe('tiny:webhook:pendentes');
    expect(cap).toBe(500);
    const item = JSON.parse(valor) as { tipo: string; hash: string; payload: string };
    expect(item.tipo).toBe('rastreio');
    expect(item.hash).toMatch(/^[0-9a-f]{64}$/);
    // Payload guardado como veio: quem processa reconsulta a API, mas o cru
    // serve de prova do que o Tiny mandou.
    expect(JSON.parse(item.payload)).toEqual({ id: 42, codigoRastreamento: 'BR1' });
  });

  it('Redis fora NÃO vira erro pro Tiny (senão ele retenta 10x e desiste)', async () => {
    const { ctrl, redis } = build();
    redis.lpushCapped.mockRejectedValue(new Error('redis fora'));
    const res = fakeRes();
    await ctrl.receber(SEGREDO, 'estoque', req({}), res as never);
    expect(res.corpo()).toEqual({ ok: true });
  });

  it('sem TINY_WEBHOOK_SECRET configurado, aceita com warning', async () => {
    // É o que permite cadastrar a URL no painel antes de a env existir. Assim
    // que ela existe, passa a valer sem mexer em nada.
    const { ctrl } = build('');
    const res = fakeRes();
    await ctrl.receber('qualquer-coisa', 'nota', req({}), res as never);
    expect(res.corpo()).toEqual({ ok: true });
  });

  // O cadastro de e-commerce ("Outra Integração") pede CINCO URLs, e duas
  // delas (produtos, preços) não existiam na lista. O painel testa a URL antes
  // de salvar, então evento faltando não vira bug sutil: trava o cadastro.
  describe('eventos do cadastro de e-commerce', () => {
    it.each(['pedido', 'rastreio', 'estoque', 'nota', 'produto', 'preco'])(
      'aceita a URL do evento "%s"',
      (evento) => {
        const { ctrl } = build();
        expect(ctrl.verificar(SEGREDO, evento)).toEqual({ ok: true, evento });
      },
    );

    it('evento inventado segue dando 404 (erro de digitação aparece na hora de salvar)', () => {
      const { ctrl } = build();
      expect(() => ctrl.verificar(SEGREDO, 'inventado')).toThrow();
    });
  });

  it('o evento `produto` responde o MAPEAMENTO cru, não o ack', async () => {
    // "Produto não mapeado pelo integrador" era exatamente isto: o ERP pergunta
    // como a loja chama o produto, e a gente respondia só "ok".
    const { ctrl, mapeamento } = build();
    mapeamento.responder.mockResolvedValue({
      mapeamentos: [{ mapeamento: { idMapeamento: 335240597, skuMapeamento: 'MB-01' } }],
    });
    const res = fakeRes();

    await ctrl.receber(SEGREDO, 'produto', req({ dados: { id: 335240597 } }), res as never);

    expect(res.corpo()).toEqual({
      mapeamentos: [{ mapeamento: { idMapeamento: 335240597, skuMapeamento: 'MB-01' } }],
    });
  });
});
