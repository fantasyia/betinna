import { describe, it, expect, vi } from 'vitest';
import { EvolutionService } from './evolution.service';

/**
 * Testa a normalização de número do Evolution (via enviarTexto), travando o fix:
 * JID de pessoa montado pelo fluxo SEM o código do país (55) precisa ganhar o 55
 * — senão o Evolution devolve 400 (exists:false) e a 1ª mensagem nunca é enviada.
 */
function makeSvc() {
  const http = { post: vi.fn().mockResolvedValue({ key: { id: 'X' } }) };
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
  const svc = new EvolutionService(http as never, env as never);
  return { svc, http };
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
