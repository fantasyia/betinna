import { describe, expect, it, vi } from 'vitest';
import { gravarEmailDoComprador, leadDoPedidoSemMover } from './email-do-comprador';

const montar = (outroLeadComEmail = 0) => ({
  pedido: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  cliente: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  lead: {
    count: vi.fn().mockResolvedValue(outroLeadComEmail),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  },
});
const logger = { warn: vi.fn() };

describe('e-mail do comprador (réguas de e-mail, 23/10)', () => {
  it('vai pro pedido, cliente e lead — só onde estava vazio', async () => {
    const p = montar();
    await gravarEmailDoComprador(p as never, logger, {
      empresaId: 'e1',
      email: ' Ana@Loja.com.br ',
      pedidoId: 'p1',
      clienteId: 'c1',
      leadId: 'l1',
    });
    expect(p.pedido.updateMany).toHaveBeenCalledWith({
      where: { id: 'p1', empresaId: 'e1', contatoEmail: null },
      data: { contatoEmail: 'ana@loja.com.br' },
    });
    expect(p.cliente.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'c1', OR: [{ email: null }, { email: '' }] }),
        data: { email: 'ana@loja.com.br' },
      }),
    );
    expect(p.lead.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { contatoEmail: 'ana@loja.com.br' } }),
    );
  });

  it('outro lead já tem o e-mail: este lead fica sem (índice único)', async () => {
    const p = montar(1);
    await gravarEmailDoComprador(p as never, logger, {
      empresaId: 'e1',
      email: 'a@b.co',
      leadId: 'l1',
    });
    expect(p.lead.updateMany).not.toHaveBeenCalled();
  });

  it('sem e-mail não toca em nada; erro de banco não derruba', async () => {
    const p = montar();
    await gravarEmailDoComprador(p as never, logger, {
      empresaId: 'e1',
      email: '',
      pedidoId: 'p1',
    });
    expect(p.pedido.updateMany).not.toHaveBeenCalled();

    p.cliente.updateMany.mockRejectedValue(new Error('db'));
    await expect(
      gravarEmailDoComprador(p as never, logger, {
        empresaId: 'e1',
        email: 'a@b.co',
        clienteId: 'c1',
      }),
    ).resolves.toBeUndefined();
  });

  it('lead do pedido: pelo cliente, senão pelos 8 últimos dígitos do telefone', async () => {
    const pelo = {
      lead: { findFirst: vi.fn().mockResolvedValue({ id: 'l-cli' }) },
      $queryRaw: vi.fn(),
    };
    expect(await leadDoPedidoSemMover(pelo as never, 'e1', 'c1', '5547999990000')).toBe('l-cli');
    expect(pelo.$queryRaw).not.toHaveBeenCalled();

    const fone = {
      lead: { findFirst: vi.fn().mockResolvedValue(null) },
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'l-fone' }]),
    };
    expect(await leadDoPedidoSemMover(fone as never, 'e1', 'c1', '5547999990000')).toBe('l-fone');
    expect(await leadDoPedidoSemMover(fone as never, 'e1', null, '123')).toBeNull();
  });
});
