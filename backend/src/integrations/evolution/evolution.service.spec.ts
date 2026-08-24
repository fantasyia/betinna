import { describe, it, expect, vi } from 'vitest';
import { EvolutionService } from './evolution.service';

/**
 * Testa a normalização de número do Evolution (via enviarTexto), travando o fix:
 * JID de pessoa montado pelo fluxo SEM o código do país (55) precisa ganhar o 55
 * — senão o Evolution devolve 400 (exists:false) e a 1ª mensagem nunca é enviada.
 */
function makeSvc() {
  const http = {
    post: vi.fn().mockResolvedValue({ data: { key: { id: 'X' } } }),
    get: vi.fn().mockResolvedValue({ data: [] }),
    delete: vi.fn().mockResolvedValue({ data: {} }),
  };
  const env = {
    get: vi.fn(
      (k: string) =>
        ({
          EVOLUTION_API_URL: 'http://evo',
          EVOLUTION_API_KEY: 'k',
          WHATSAPP_PROVIDER: 'evolution',
        })[k] ?? '',
    ),
  };
  const redis = {
    setNxEx: vi.fn().mockResolvedValue(true),
    eval: vi.fn().mockResolvedValue(1),
    get: vi.fn().mockResolvedValue(null),
    setEx: vi.fn().mockResolvedValue(undefined),
    del: vi.fn().mockResolvedValue(1),
  };
  const svc = new EvolutionService(http as never, env as never, redis as never);
  return { svc, http, redis };
}

function numeroEnviado(http: { post: ReturnType<typeof vi.fn> }): string {
  return (http.post.mock.calls[0][1] as { body: { number: string } }).body.number;
}

describe('EvolutionService — normalização de número (via enviarTexto)', () => {
  it('JID de pessoa nacional sem 55 → ganha o 55 (o bug do fluxo)', async () => {
    const { svc, http } = makeSvc();
    await svc.enviarTexto('inst', '11970535832@s.whatsapp.net', 'oi');
    expect(numeroEnviado(http)).toBe('5511970535832');
  });

  it('número cru nacional → ganha o 55', async () => {
    const { svc, http } = makeSvc();
    await svc.enviarTexto('inst', '(11) 97053-5832', 'oi');
    expect(numeroEnviado(http)).toBe('5511970535832');
  });

  it('número já com 55 (JID) → não duplica', async () => {
    const { svc, http } = makeSvc();
    await svc.enviarTexto('inst', '5511970535832@s.whatsapp.net', 'oi');
    expect(numeroEnviado(http)).toBe('5511970535832');
  });

  it('grupo @g.us → passa intacto', async () => {
    const { svc, http } = makeSvc();
    await svc.enviarTexto('inst', '120363427094823514@g.us', 'oi');
    expect(numeroEnviado(http)).toBe('120363427094823514@g.us');
  });

  it('@lid (id interno) → passa intacto', async () => {
    const { svc, http } = makeSvc();
    await svc.enviarTexto('inst', '99887766@lid', 'oi');
    expect(numeroEnviado(http)).toBe('99887766@lid');
  });

  it('internacional E.164 (com +) → NÃO prefixa 55 (US de 11 dígitos)', async () => {
    const { svc, http } = makeSvc();
    await svc.enviarTexto('inst', '+14155552671@s.whatsapp.net', 'oi');
    expect(numeroEnviado(http)).toBe('14155552671');
  });

  it('E.164 BR (com +) → só os dígitos, sem duplicar 55', async () => {
    const { svc, http } = makeSvc();
    await svc.enviarTexto('inst', '+5511970535832@s.whatsapp.net', 'oi');
    expect(numeroEnviado(http)).toBe('5511970535832');
  });
});

describe('EvolutionService — gate de idempotência (dedup de envio)', () => {
  const KEY = 'fx:job-1';

  it('1ª chamada com chave: faz POST e memoriza o resultado', async () => {
    const { svc, http, redis } = makeSvc();
    redis.setNxEx.mockResolvedValueOnce(true);
    const r = await svc.enviarTexto('inst', '5511999@s.whatsapp.net', 'oi', 0, undefined, KEY);
    expect(http.post).toHaveBeenCalledTimes(1);
    expect(redis.setEx).toHaveBeenCalledWith(
      'idem:wa:fx:job-1',
      JSON.stringify({ key: { id: 'X' } }),
      86400,
    );
    expect(r.key?.id).toBe('X');
  });

  it('2ª chamada com a MESMA chave (já enviada): NÃO faz POST e devolve o id memorizado', async () => {
    const { svc, http, redis } = makeSvc();
    redis.setNxEx.mockResolvedValueOnce(false);
    redis.get.mockResolvedValueOnce(JSON.stringify({ key: { id: 'X' } }));
    const r = await svc.enviarTexto('inst', '5511999@s.whatsapp.net', 'oi', 0, undefined, KEY);
    expect(http.post).not.toHaveBeenCalled();
    expect(r.key?.id).toBe('X');
  });

  it('PENDING de tentativa em voo: no-op seguro (não re-POST)', async () => {
    const { svc, http, redis } = makeSvc();
    redis.setNxEx.mockResolvedValueOnce(false);
    redis.get.mockResolvedValueOnce('PENDING');
    const r = await svc.enviarTexto('inst', '5511999@s.whatsapp.net', 'oi', 0, undefined, KEY);
    expect(http.post).not.toHaveBeenCalled();
    expect(r.key?.id).toBeUndefined();
  });

  it('POST falha de verdade → libera a chave (del) pra retry legítimo', async () => {
    const { svc, http, redis } = makeSvc();
    redis.setNxEx.mockResolvedValueOnce(true);
    http.post.mockRejectedValueOnce(new Error('boom'));
    await expect(
      svc.enviarTexto('inst', '5511999@s.whatsapp.net', 'oi', 0, undefined, KEY),
    ).rejects.toThrow();
    expect(redis.del).toHaveBeenCalledWith('idem:wa:fx:job-1');
  });

  it('sem chave: comportamento antigo (não toca no gate)', async () => {
    const { svc, http, redis } = makeSvc();
    await svc.enviarTexto('inst', '5511999@s.whatsapp.net', 'oi');
    expect(http.post).toHaveBeenCalledTimes(1);
    expect(redis.setNxEx).not.toHaveBeenCalled();
  });
});

/**
 * Saúde da instância e o botão Conectar (card 📵 de 24/08).
 *
 * `disconnectionReasonCode` é o motivo da ÚLTIMA desconexão — campo HISTÓRICO,
 * que o Evolution não zera ao reconectar. Tratar qualquer motivo como "doente"
 * fazia uma instância que caiu UMA vez ser lida como morta pra sempre: a tela
 * pedia reconexão com o número funcionando, os fluxos paravam de enviar, e o
 * botão Conectar apagava a sessão.
 */
function comInstancia(
  http: { get: ReturnType<typeof vi.fn> },
  inst: Record<string, unknown> | null,
) {
  http.get.mockResolvedValue({ data: inst ? [{ name: 'inst', ...inst }] : [] });
}

describe('EvolutionService — saúde da instância', () => {
  it('open com motivo ANTIGO de queda transitória continua SAUDÁVEL', async () => {
    // 440 = sessão substituída. Se voltou a `open`, a sessão se recuperou —
    // o motivo é histórico, não diagnóstico do agora.
    const { svc, http } = makeSvc();
    comInstancia(http, {
      connectionStatus: 'open',
      ownerJid: '5511@s.whatsapp.net',
      disconnectionReasonCode: 440,
    });

    expect(await svc.estaSaudavel('inst')).toBe(true);
  });

  it('open com 401 (deslogado no aparelho) NÃO é saudável — é o zumbi', async () => {
    // O caso que motivou a regra original: status preso em `open` depois de
    // alguém desconectar o dispositivo no celular.
    const { svc, http } = makeSvc();
    comInstancia(http, {
      connectionStatus: 'open',
      ownerJid: '5511@s.whatsapp.net',
      disconnectionReasonCode: 401,
    });

    expect(await svc.estaSaudavel('inst')).toBe(false);
  });

  it('connecting não é saudável (não envia), mesmo sem motivo nenhum', async () => {
    const { svc, http } = makeSvc();
    comInstancia(http, { connectionStatus: 'connecting', ownerJid: '5511@s.whatsapp.net' });

    expect(await svc.estaSaudavel('inst')).toBe(false);
  });
});

describe('EvolutionService — o botão Conectar não pode destruir sessão viva', () => {
  it('CONNECTING: devolve CONNECTING e NÃO reseta — a recuperação segue', async () => {
    // Era aqui que doía: `resetarForte` (restart+logout+delete) em qualquer
    // estado != open. Cada clique em "Conectar" matava a reconexão em curso e
    // exigia QR novo — quanto mais se apertava, mais longe de voltar.
    const { svc, http } = makeSvc();
    comInstancia(http, { connectionStatus: 'connecting', ownerJid: '5511@s.whatsapp.net' });

    const r = await svc.conectarOuEstado('inst');

    expect(r.status).toBe('CONNECTING');
    expect(http.delete).not.toHaveBeenCalled();
    expect(http.post).not.toHaveBeenCalled();
  });

  it('CLOSE sem motivo de morte também espera — o Baileys volta sozinho', async () => {
    const { svc, http } = makeSvc();
    comInstancia(http, { connectionStatus: 'close', ownerJid: '5511@s.whatsapp.net' });

    const r = await svc.conectarOuEstado('inst');

    expect(r.status).toBe('CONNECTING');
    expect(http.delete).not.toHaveBeenCalled();
  });

  // `resetarForte` tem esperas reais (restart → 4s → logout → 1,5s → delete)
  // pro socket sair do 'open' travado. Este é o único teste que percorre o
  // caminho destrutivo inteiro, então ganha folga de tempo.
  it('DESLOGADA (401): aí sim reseta — só o QR resolve', { timeout: 15_000 }, async () => {
    const { svc, http } = makeSvc();
    comInstancia(http, {
      connectionStatus: 'close',
      ownerJid: '5511@s.whatsapp.net',
      disconnectionReasonCode: 401,
    });

    await svc.conectarOuEstado('inst');

    expect(http.delete).toHaveBeenCalled(); // logout/delete do reset forte
  });

  it('já conectada: devolve CONNECTED sem tocar em nada', async () => {
    const { svc, http } = makeSvc();
    comInstancia(http, { connectionStatus: 'open', ownerJid: '5511@s.whatsapp.net' });

    const r = await svc.conectarOuEstado('inst');

    expect(r.status).toBe('CONNECTED');
    expect(http.delete).not.toHaveBeenCalled();
  });
});
