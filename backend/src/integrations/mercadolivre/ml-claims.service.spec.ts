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
    // Sem detalhe (endpoints extras vazios) → mesmo comportamento de antes.
    client.get.mockImplementation(async (_e: string, path: string) =>
      path.endsWith('/messages') ? [] : {},
    );
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
    // O v1 devolve ARRAY na raiz (conferido em prod, 29/09).
    const msgs = [
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
    ];
    client.get.mockImplementation(async (_e: string, path: string) =>
      path.endsWith('/messages') ? msgs : {},
    );
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

/**
 * Léo, 29/09: a mediação 5583814163 aparecia só com o id — sem prazo, valor,
 * produto nem motivo. Payloads reais (resumidos) da conta LGHB.
 */
describe('MLClaimsService — detalhe da reclamação', () => {
  const claimReal: MLClaim = {
    id: 5583814163,
    type: 'mediations',
    stage: 'dispute',
    status: 'opened',
    reason_id: 'PDD9939',
    resource: 'order',
    resource_id: 2000018317585658,
    date_created: '2026-09-26T14:01:02.000-04:00',
    last_updated: '2026-09-26T14:02:39.000-04:00',
    players: [
      { role: 'complainant', type: 'buyer', user_id: 1, available_actions: [] },
      { role: 'respondent', type: 'seller', user_id: 2, available_actions: [] },
    ],
  };
  const respostas: Record<string, unknown> = {
    '/post-purchase/v1/claims/5583814163/detail': {
      due_date: '2026-10-02T22:35:00.000-04:00',
      action_responsible: 'complainant',
      title: 'Devolução em preparação sem custo de envio',
      description: 'Ao recebermos o produto, confirmaremos as condições dele.',
      problem: 'O comprador disse que se arrependeu da compra',
    },
    '/post-purchase/v1/claims/reasons/PDD9939': {
      detail: 'A minha compra chegou em boas condições, mas eu não a quero mais',
    },
    '/post-purchase/v1/claims/5583814163/affects-reputation': {
      affects_reputation: 'not_affected',
    },
    '/orders/2000018317585658': {
      id: 2000018317585658,
      total_amount: 38.27,
      order_items: [
        {
          item: {
            id: 'MLB2211315214',
            title: 'Blusão De Frio Moletom',
            seller_sku: 'BLUSAOBRANCO-P',
            variation_attributes: [
              { name: 'Cor', value_name: 'Branco' },
              { name: 'Tamanho', value_name: 'P' },
            ],
          },
          quantity: 1,
        },
      ],
    },
    '/post-purchase/v1/claims/5583814163/messages': [],
  };

  let client: ReturnType<typeof makeClient>;
  let incidents: ReturnType<typeof makeIncidents>;
  let svc: MLClaimsService;
  beforeEach(() => {
    client = makeClient();
    incidents = makeIncidents();
    svc = new MLClaimsService(client as never, makeInbox() as never, incidents as never);
    client.get.mockImplementation(async (_e: string, path: string) => {
      if (path in respostas) return respostas[path];
      throw new Error('404 ' + path);
    });
  });

  it('vez do comprador: status AGUARDANDO_COMPRADOR e prazo dele NÃO vira prazo do vendedor', async () => {
    await svc.processarClaim('emp-1', claimReal);
    const inc = incidents.registrarIncidente.mock.calls[0][0];
    expect(inc.status).toBe('AGUARDANDO_COMPRADOR');
    expect(inc.prazoResposta).toBeUndefined();
    expect(inc.valor).toBe(38.27);
    expect(inc.motivo).toBe('A minha compra chegou em boas condições, mas eu não a quero mais');
    expect(inc.metadata.ml_detalhe).toMatchObject({
      titulo: 'Devolução em preparação sem custo de envio',
      responsavel: 'complainant',
      prazo: '2026-10-02T22:35:00.000-04:00',
      afetaReputacao: 'not_affected',
      acoesVendedor: [],
      pedido: {
        id: '2000018317585658',
        titulo: 'Blusão De Frio Moletom',
        variacao: 'Cor: Branco · Tamanho: P',
        sku: 'BLUSAOBRANCO-P',
        quantidade: 1,
      },
    });
  });

  it('vez do vendedor: status AGUARDANDO_VENDEDOR e prazo vira prazoResposta', async () => {
    respostas['/post-purchase/v1/claims/5583814163/detail'] = {
      action_responsible: 'respondent',
      due_date: '2026-10-01T10:00:00.000-04:00',
    };
    await svc.processarClaim('emp-1', claimReal);
    const inc = incidents.registrarIncidente.mock.calls[0][0];
    expect(inc.status).toBe('AGUARDANDO_VENDEDOR');
    expect(inc.prazoResposta).toEqual(new Date('2026-10-01T10:00:00.000-04:00'));
  });

  it('endpoint extra fora do ar não impede o incidente de entrar', async () => {
    client.get.mockImplementation(async (_e: string, path: string) => {
      if (path.endsWith('/messages')) return [];
      throw new Error('503');
    });
    await svc.processarClaim('emp-1', claimReal);
    const inc = incidents.registrarIncidente.mock.calls[0][0];
    expect(inc.status).toBe('AGUARDANDO_VENDEDOR');
    expect(inc.metadata.ml_detalhe.pedido).toBeNull();
  });

  it('mensagem vai pra actions/send-message com o destinatário liberado', async () => {
    client.get.mockResolvedValueOnce({
      ...claimReal,
      players: [
        {
          role: 'respondent',
          type: 'seller',
          user_id: 2,
          available_actions: [{ action: 'send_message_to_mediator' }],
        },
      ],
    });
    client.post.mockResolvedValueOnce({ id: 77 });
    const r = await svc.enviarMensagem('emp-1', 5583814163, 'Recebi o produto');
    expect(client.post).toHaveBeenCalledWith(
      'emp-1',
      '/post-purchase/v1/claims/5583814163/actions/send-message',
      { receiver_role: 'mediator', message: 'Recebi o produto', attachments: [] },
    );
    expect(r.externalId).toBe('77');
  });

  it('sem ação de mensagem liberada: explica e NÃO chama o ML', async () => {
    client.get.mockResolvedValueOnce(claimReal);
    await expect(svc.enviarMensagem('emp-1', 5583814163, 'oi')).rejects.toThrow(
      'não está esperando mensagem sua',
    );
    expect(client.post).not.toHaveBeenCalled();
  });
});
