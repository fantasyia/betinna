import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IntegrationException } from '@shared/errors/app-exception';
import { AmazonMessagingService } from './amazon-messaging.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const makeClient = (): { get: any; post: any; marketplaceId: string } => ({
  get: vi.fn(),
  post: vi.fn(),
  marketplaceId: 'A2Q3Y263D00KWC',
});

describe('AmazonMessagingService.listarAcoesPermitidas', () => {
  it('extrai action names do _links.actions', async () => {
    const client = makeClient();
    client.get.mockResolvedValueOnce({
      _links: {
        actions: [
          {
            href: '/messaging/v1/orders/X/messages/confirmDeliveryDetails',
            name: 'confirmDeliveryDetails',
          },
          { href: '/messaging/v1/orders/X/messages/unexpectedProblem', name: 'unexpectedProblem' },
        ],
      },
    });
    const svc = new AmazonMessagingService(client as never);
    const r = await svc.listarAcoesPermitidas('emp-1', 'AMZ-001');
    expect(r).toEqual(['confirmDeliveryDetails', 'unexpectedProblem']);
  });

  it('retorna [] quando _links.actions ausente', async () => {
    const client = makeClient();
    client.get.mockResolvedValueOnce({ _links: {} });
    const svc = new AmazonMessagingService(client as never);
    expect(await svc.listarAcoesPermitidas('emp-1', 'AMZ-001')).toEqual([]);
  });
});

describe('AmazonMessagingService.enviarTextoLivre — routing', () => {
  let client: ReturnType<typeof makeClient>;
  let svc: AmazonMessagingService;

  beforeEach(() => {
    client = makeClient();
    svc = new AmazonMessagingService(client as never);
  });

  it('usa confirmDeliveryDetails quando disponível (prioridade 1)', async () => {
    client.get.mockResolvedValueOnce({
      _links: {
        actions: [
          { href: '/x/confirmDeliveryDetails', name: 'confirmDeliveryDetails' },
          { href: '/x/unexpectedProblem', name: 'unexpectedProblem' },
        ],
      },
    });
    client.post.mockResolvedValueOnce({});
    const r = await svc.enviarTextoLivre('emp-1', 'AMZ-001', 'olá');
    expect(r.acaoUsada).toBe('confirmDeliveryDetails');
    const [, path] = client.post.mock.calls[0] as [string, string];
    expect(path).toContain('confirmDeliveryDetails');
  });

  it('cai pra confirmOrderDetails quando confirmDeliveryDetails indisponível', async () => {
    client.get.mockResolvedValueOnce({
      _links: {
        actions: [
          { href: '/x/confirmOrderDetails', name: 'confirmOrderDetails' },
          { href: '/x/unexpectedProblem', name: 'unexpectedProblem' },
        ],
      },
    });
    client.post.mockResolvedValueOnce({});
    const r = await svc.enviarTextoLivre('emp-1', 'AMZ-001', 'olá');
    expect(r.acaoUsada).toBe('confirmOrderDetails');
  });

  it('cai pra unexpectedProblem como último recurso', async () => {
    client.get.mockResolvedValueOnce({
      _links: { actions: [{ href: '/x/up', name: 'unexpectedProblem' }] },
    });
    client.post.mockResolvedValueOnce({});
    const r = await svc.enviarTextoLivre('emp-1', 'AMZ-001', 'problema serio');
    expect(r.acaoUsada).toBe('unexpectedProblem');
  });

  it('lança IntegrationException quando nenhuma das ações de texto está disponível', async () => {
    client.get.mockResolvedValueOnce({
      _links: { actions: [{ href: '/x/getCustomerInformation', name: 'getCustomerInformation' }] },
    });
    await expect(svc.enviarTextoLivre('emp-1', 'AMZ-001', 'oi')).rejects.toBeInstanceOf(
      IntegrationException,
    );
    expect(client.post).not.toHaveBeenCalled();
  });
});

describe('AmazonMessagingService.confirmarEntrega/confirmarPedido/reportarProblema', () => {
  let client: ReturnType<typeof makeClient>;
  let svc: AmazonMessagingService;

  beforeEach(() => {
    client = makeClient();
    client.post.mockResolvedValue({});
    svc = new AmazonMessagingService(client as never);
  });

  it('confirmarEntrega posta em confirmDeliveryDetails com text', async () => {
    await svc.confirmarEntrega('emp-1', 'AMZ-001', 'entregue ok?');
    const [, path, body] = client.post.mock.calls[0] as [string, string, { text: string }];
    expect(path).toContain('confirmDeliveryDetails');
    expect(body.text).toBe('entregue ok?');
  });

  it('reportarProblema posta em unexpectedProblem', async () => {
    await svc.reportarProblema('emp-1', 'AMZ-001', 'estoque esgotado');
    const [, path] = client.post.mock.calls[0] as [string, string];
    expect(path).toContain('unexpectedProblem');
  });
});
