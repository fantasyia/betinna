import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MLClaimsService } from './ml-claims.service';
import type { MLClaim } from './ml.types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const makeClient = (): { get: any; post: any } => ({
  get: vi.fn(),
  post: vi.fn(),
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const makeInbox = (): { processarMensagemEntrante: any } => ({
  processarMensagemEntrante: vi.fn(async () => ({
    conversationId: 'conv-x',
    messageId: 'msg-x',
    duplicada: false,
  })),
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const makeIncidents = (): { registrarIncidente: any } => ({
  registrarIncidente: vi.fn(async () => ({ incidentId: 'inc-1', duplicada: false })),
});

const baseClaim: MLClaim = {
  id: 12345,
  type: 'mediations',
  stage: 'claim',
  status: 'opened',
  reason_id: 'PNR',
  status_detail: 'Buyer waiting for response',
  resource: 'order',
  resource_id: 999,
  date_created: '2026-01-01T10:00:00.000-03:00',
  last_updated: '2026-01-02T10:00:00.000-03:00',
  expiration_date: '2026-01-05T10:00:00.000-03:00',
};

describe('MLClaimsService.processarClaim — mapping', () => {
  let client: ReturnType<typeof makeClient>;
  let inbox: ReturnType<typeof makeInbox>;
  let incidents: ReturnType<typeof makeIncidents>;
  let svc: MLClaimsService;

  beforeEach(() => {
    client = makeClient();
    inbox = makeInbox();
    incidents = makeIncidents();
    svc = new MLClaimsService(client as never, inbox as never, incidents as never);
    client.get.mockResolvedValue({ messages: [] }); // listarMensagens
  });

  it('claim type=return → DEVOLUCAO + categoria DEVOLUCAO', async () => {
    await svc.processarClaim('emp-1', { ...baseClaim, type: 'return', stage: 'claim' });
    const [params] = inbox.processarMensagemEntrante.mock.calls[0] as [
      { meta: { categoria: string } },
    ];
    expect(params.meta.categoria).toBe('DEVOLUCAO');
    const inc = incidents.registrarIncidente.mock.calls[0][0] as { tipo: string };
    expect(inc.tipo).toBe('DEVOLUCAO');
  });

  it('claim stage=dispute → MEDIACAO + categoria MEDIACAO', async () => {
    await svc.processarClaim('emp-1', { ...baseClaim, type: 'mediations', stage: 'dispute' });
    const inc = incidents.registrarIncidente.mock.calls[0][0] as { tipo: string };
    expect(inc.tipo).toBe('MEDIACAO');
  });

  it('claim type=cancel_purchase → CANCELAMENTO', async () => {
    await svc.processarClaim('emp-1', { ...baseClaim, type: 'cancel_purchase', stage: 'claim' });
    const inc = incidents.registrarIncidente.mock.calls[0][0] as { tipo: string };
    expect(inc.tipo).toBe('CANCELAMENTO');
  });

  it('status opened → AGUARDANDO_VENDEDOR', async () => {
    await svc.processarClaim('emp-1', { ...baseClaim, status: 'opened' });
    const inc = incidents.registrarIncidente.mock.calls[0][0] as { status: string };
    expect(inc.status).toBe('AGUARDANDO_VENDEDOR');
  });

  it('status closed_with_refund → RESOLVIDO', async () => {
    await svc.processarClaim('emp-1', { ...baseClaim, status: 'closed_with_refund' });
    const inc = incidents.registrarIncidente.mock.calls[0][0] as { status: string };
    expect(inc.status).toBe('RESOLVIDO');
  });

  it('status expired → EXPIRADO', async () => {
    await svc.processarClaim('emp-1', { ...baseClaim, status: 'expired' });
    const inc = incidents.registrarIncidente.mock.calls[0][0] as { status: string };
    expect(inc.status).toBe('EXPIRADO');
  });

  it('status cancelled → CANCELADO', async () => {
    await svc.processarClaim('emp-1', { ...baseClaim, status: 'cancelled' });
    const inc = incidents.registrarIncidente.mock.calls[0][0] as { status: string };
    expect(inc.status).toBe('CANCELADO');
  });

  it('passa prazoResposta como Date quando claim tem expiration_date', async () => {
    await svc.processarClaim('emp-1', baseClaim);
    const inc = incidents.registrarIncidente.mock.calls[0][0] as { prazoResposta: Date };
    expect(inc.prazoResposta).toBeInstanceOf(Date);
    expect(inc.prazoResposta.getUTCFullYear()).toBe(2026);
  });

  it('vincula incident à conversation criada pelo InboxService', async () => {
    await svc.processarClaim('emp-1', baseClaim);
    const inc = incidents.registrarIncidente.mock.calls[0][0] as { conversationId: string };
    expect(inc.conversationId).toBe('conv-x');
  });

  it('importa mensagens da claim ignorando as nossas (sender_role=respondent)', async () => {
    client.get.mockReset();
    // primeira call obter() já não é feita aqui — só listarMensagens
    client.get.mockResolvedValueOnce({
      messages: [
        {
          date_created: '2026-01-02T10:00:00.000-03:00',
          message: 'comprador msg 1',
          sender_role: 'complainant',
        },
        {
          date_created: '2026-01-02T11:00:00.000-03:00',
          message: 'minha msg',
          sender_role: 'respondent',
        },
        {
          date_created: '2026-01-02T12:00:00.000-03:00',
          message: 'mediator msg',
          sender_role: 'mediator',
        },
      ],
    });
    inbox.processarMensagemEntrante.mockClear();
    await svc.processarClaim('emp-1', baseClaim);
    // 1 evento sistêmico + 2 mensagens (complainant + mediator); respondent ignorado
    expect(inbox.processarMensagemEntrante).toHaveBeenCalledTimes(3);
    const conteudos = inbox.processarMensagemEntrante.mock.calls.map(
      (c: unknown[]) => (c[0] as { conteudo: string }).conteudo,
    );
    expect(conteudos).toContain('comprador msg 1');
    expect(conteudos).toContain('mediator msg');
    expect(conteudos).not.toContain('minha msg');
  });

  it('preserva resumo curto com status_detail', async () => {
    await svc.processarClaim('emp-1', baseClaim);
    const inc = incidents.registrarIncidente.mock.calls[0][0] as { resumo: string };
    expect(inc.resumo).toContain('Reclamação 12345');
    expect(inc.resumo).toContain('Buyer waiting for response');
    expect(inc.resumo.length).toBeLessThanOrEqual(280);
  });
});
