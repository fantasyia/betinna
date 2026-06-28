import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Subject } from 'rxjs';
import { InboxController } from './inbox.controller';
import { InboxEventsService, type InboxEvento } from './inbox-events.service';

const ev = (over: Partial<InboxEvento>): InboxEvento => ({
  empresaId: 'emp-1',
  conversationId: 'c1',
  tipo: 'mensagem',
  proprietarioId: null,
  atribuidoId: null,
  canal: 'WHATSAPP',
  ...over,
});

// ─── Filtro de escopo do SSE (segurança) ───────────────────────────────────────
describe('InboxController.stream — filtro de escopo', () => {
  let subject: Subject<InboxEvento>;
  let ctrl: InboxController;

  beforeEach(() => {
    subject = new Subject<InboxEvento>();
    const bus = { stream$: subject.asObservable(), publicar: vi.fn() };
    const u = undefined as never;
    ctrl = new InboxController(u, u, u, u, u, u, u, bus as never);
  });

  it('REP recebe só eventos do próprio WhatsApp (proprietarioId === user.id) e da própria empresa', () => {
    const out: InboxEvento[] = [];
    const sub = ctrl
      .stream({ id: 'rep-1', role: 'REP', empresaIdAtiva: 'emp-1' } as never)
      .subscribe((m) => out.push(m.data as InboxEvento));
    subject.next(ev({ conversationId: 'propria', proprietarioId: 'rep-1' })); // ✅ própria
    subject.next(ev({ conversationId: 'de-outro', proprietarioId: 'rep-2' })); // ❌ outro rep
    subject.next(
      ev({ conversationId: 'outra-empresa', proprietarioId: 'rep-1', empresaId: 'emp-2' }),
    ); // ❌ outra empresa
    sub.unsubscribe();
    expect(out.map((e) => e.conversationId)).toEqual(['propria']);
  });

  it('SAC recebe todas as conversas da empresa, mas nada de outra empresa', () => {
    const out: InboxEvento[] = [];
    const sub = ctrl
      .stream({ id: 'sac-1', role: 'SAC', empresaIdAtiva: 'emp-1' } as never)
      .subscribe((m) => out.push(m.data as InboxEvento));
    subject.next(ev({ conversationId: 'wpp', proprietarioId: 'rep-9', canal: 'WHATSAPP' }));
    subject.next(ev({ conversationId: 'ml', proprietarioId: null, canal: 'MARKETPLACE_ML' }));
    subject.next(ev({ conversationId: 'fora', empresaId: 'emp-2' })); // ❌ outra empresa
    sub.unsubscribe();
    expect(out.map((e) => e.conversationId)).toEqual(['wpp', 'ml']);
  });
});

// ─── Bus Redis pub/sub ──────────────────────────────────────────────────────────
describe('InboxEventsService — pub/sub', () => {
  it('publicar serializa o evento no canal Redis (best-effort)', async () => {
    const publish = vi.fn().mockResolvedValue(1);
    const redis = { client: { publish, duplicate: vi.fn() } };
    const svc = new InboxEventsService(redis as never);
    const evento = ev({ conversationId: 'c9' });
    await svc.publicar(evento);
    expect(publish).toHaveBeenCalledWith('inbox:events', JSON.stringify(evento));
  });

  it('publicar NÃO lança se o Redis falhar (não pode derrubar o fluxo de mensagem)', async () => {
    const redis = { client: { publish: vi.fn().mockRejectedValue(new Error('redis down')) } };
    const svc = new InboxEventsService(redis as never);
    await expect(svc.publicar(ev({}))).resolves.toBeUndefined();
  });

  it('mensagem no subscriber Redis vira evento no stream$', async () => {
    let onMessage: ((canal: string, payload: string) => void) | undefined;
    const subscriber = {
      on: vi.fn((nome: string, cb: (canal: string, payload: string) => void) => {
        if (nome === 'message') onMessage = cb;
      }),
      subscribe: vi.fn().mockResolvedValue(1),
      quit: vi.fn().mockResolvedValue('OK'),
    };
    const redis = { client: { duplicate: () => subscriber } };
    const svc = new InboxEventsService(redis as never);
    await svc.onModuleInit();

    const recebidos: InboxEvento[] = [];
    const sub = svc.stream$.subscribe((e) => recebidos.push(e));
    const evento = ev({ conversationId: 'do-redis' });
    onMessage?.('inbox:events', JSON.stringify(evento));
    onMessage?.('inbox:events', 'payload-malformado{'); // ignorado sem quebrar
    sub.unsubscribe();

    expect(recebidos).toEqual([evento]);
    expect(subscriber.subscribe).toHaveBeenCalledWith('inbox:events');
  });
});
