import { describe, it, expect, vi } from 'vitest';
import { EvolutionService } from './evolution.service';

/**
 * Testa a normalização de número do Evolution (via enviarTexto), travando o fix:
 * JID de pessoa montado pelo fluxo SEM o código do país (55) precisa ganhar o 55
 * — senão o Evolution devolve 400 (exists:false) e a 1ª mensagem nunca é enviada.
 */
function makeSvc() {
  const http = { post: vi.fn().mockResolvedValue({ data: { key: { id: 'X' } } }) };
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
