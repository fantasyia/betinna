import { describe, expect, it, vi } from 'vitest';
import { SheinPosVendaService } from './shein-pos-venda.service';
import type { SheinPosVenda } from './shein-pos-venda';

/** Pós-venda da Shein → conversa só leitura no Inbox (card SAC, 14/11). */
const caso = (sub: number): SheinPosVenda => ({
  aftersalesOrderNo: 'AC9',
  orderNo: 'GSO9',
  aftersalesOrderSubStatus: sub,
  aftersalesResolutionPlan: 1,
});

function montar(entrada: { conversationId: string; duplicada: boolean }) {
  const inbox = {
    processarMensagemEntrante: vi.fn().mockResolvedValue({ ...entrada, messageId: 'm1' }),
  };
  const incidents = { registrarIncidente: vi.fn().mockResolvedValue({ incidentId: 'i1' }) };
  const prisma = {
    conversation: { update: vi.fn().mockResolvedValue({}) },
    marketplaceIncident: { findMany: vi.fn().mockResolvedValue([]) },
  };
  const svc = new SheinPosVendaService(
    {} as never,
    incidents as never,
    inbox as never,
    prisma as never,
  );
  return { svc, inbox, incidents, prisma };
}

describe('SheinPosVendaService → Inbox', () => {
  it('caso esperando a loja: conversa SYSTEM pelo nº do caso, incidente ligado, fica PENDENTE', async () => {
    const m = montar({ conversationId: 'c1', duplicada: false });
    await m.svc.registrar('emp1', caso(1));
    expect(m.inbox.processarMensagemEntrante).toHaveBeenCalledWith(
      expect.objectContaining({
        empresaId: 'emp1',
        canal: 'MARKETPLACE_SHEIN',
        peerId: 'posvenda:AC9',
        peerNome: 'Pós-venda Shein #AC9',
        tipo: 'SYSTEM',
        meta: expect.objectContaining({ categoria: 'DEVOLUCAO' }),
      }),
    );
    expect(m.incidents.registrarIncidente).toHaveBeenCalledWith(
      expect.objectContaining({
        canal: 'MARKETPLACE_SHEIN',
        externalId: 'AC9',
        status: 'AGUARDANDO_VENDEDOR',
        conversationId: 'c1',
      }),
    );
    // A entrada já marca PENDENTE: nada a corrigir.
    expect(m.prisma.conversation.update).not.toHaveBeenCalled();
  });

  it('caso concluído com mensagem nova: conversa vai pra RESOLVIDA', async () => {
    const m = montar({ conversationId: 'c1', duplicada: false });
    await m.svc.registrar('emp1', caso(11));
    expect(m.prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { status: 'RESOLVIDA', naoLidas: 0 },
    });
  });

  it('mesmo estado reprocessado (duplicada): não mexe no status da conversa', async () => {
    const m = montar({ conversationId: 'c1', duplicada: true });
    await m.svc.registrar('emp1', caso(4));
    expect(m.prisma.conversation.update).not.toHaveBeenCalled();
    expect(m.incidents.registrarIncidente).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'c1' }),
    );
  });

  it('marca de limpeza barrou (sem conversa): incidente grava sem vínculo', async () => {
    const m = montar({ conversationId: '', duplicada: true });
    await m.svc.registrar('emp1', caso(1));
    expect(m.incidents.registrarIncidente).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: undefined }),
    );
  });

  it('backfill: incidente sem conversa ganha a dele pelo detalhe guardado, sem regravar o incidente', async () => {
    const m = montar({ conversationId: 'c7', duplicada: false });
    m.prisma.marketplaceIncident.findMany.mockResolvedValue([
      { id: 'inc1', metadata: { shein_pos_venda: caso(5) } },
      { id: 'inc2', metadata: null },
    ]);
    const n = await m.svc.garantirConversas('emp1');
    expect(n).toBe(1);
    expect(m.prisma.marketplaceIncident.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { empresaId: 'emp1', canal: 'MARKETPLACE_SHEIN', conversations: { none: {} } },
      }),
    );
    expect(m.incidents.registrarIncidente).not.toHaveBeenCalled();
    // sub 5 (devolução a caminho) = esperando o comprador: ABERTA, e liga ao incidente
    expect(m.prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'c7' },
      data: { status: 'ABERTA' },
    });
    expect(m.prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'c7' },
      data: { incidentId: 'inc1' },
    });
  });
});
