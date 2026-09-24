import { describe, expect, it, vi } from 'vitest';
import { InboxController, MAX_MIDIAS_POR_LOTE } from './inbox.controller';
import { InboxService } from './inbox.service';

/**
 * Mídia em LOTE (card 429 — Sentry BETINNA-FRONT-B, 24/09).
 *
 * Abrir uma conversa com 50 mídias mandava 50 GETs no mesmo segundo contra um
 * balde de 10/s que é da EMPRESA: da 11ª em diante, 429 e "mídia indisponível".
 * Agora é uma requisição por conversa.
 */

const user = { id: 'u1', role: 'SAC', empresaIdAtiva: 'emp-1' } as never;

describe('InboxService.getMessagesMediaPaths — visibilidade por conversa', () => {
  const montar = (visiveis: string[]) => {
    const prisma = {
      message: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'm1',
            mediaUrl: 'a/1.jpg',
            mediaMime: 'image/jpeg',
            conversation: { id: 'c1', canal: 'WHATSAPP' },
          },
          {
            id: 'm2',
            mediaUrl: 'a/2.ogg',
            mediaMime: 'audio/ogg',
            conversation: { id: 'c1', canal: 'WHATSAPP' },
          },
          {
            id: 'm3',
            mediaUrl: 'b/3.jpg',
            mediaMime: 'image/jpeg',
            conversation: { id: 'c2', canal: 'WHATSAPP' },
          },
        ]),
      },
      conversation: {
        findMany: vi.fn().mockResolvedValue(visiveis.map((id) => ({ id }))),
      },
    };
    const svc = Object.create(InboxService.prototype) as InboxService;
    Object.assign(svc, { prisma, baseWhere: () => ({ empresaId: 'emp-1' }) });
    return { svc, prisma };
  };

  it('🔒 mensagem de conversa que o usuário NÃO enxerga não volta', async () => {
    const { svc } = montar(['c1']); // c2 é de outro rep / outra empresa
    const r = await svc.getMessagesMediaPaths(user, ['m1', 'm2', 'm3']);
    expect([...r.keys()].sort()).toEqual(['m1', 'm2']);
  });

  it('🔒 a visibilidade usa a MESMA regra do endpoint unitário (baseWhere do usuário)', async () => {
    const { svc, prisma } = montar(['c1', 'c2']);
    await svc.getMessagesMediaPaths(user, ['m1', 'm3']);
    expect(prisma.conversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['c1', 'c2'] }, empresaId: 'emp-1' } }),
    );
  });

  it('uma consulta de visibilidade pro lote todo — não uma por mensagem', async () => {
    const { svc, prisma } = montar(['c1', 'c2']);
    await svc.getMessagesMediaPaths(user, ['m1', 'm2', 'm3']);
    expect(prisma.conversation.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.message.findMany).toHaveBeenCalledTimes(1);
  });

  it('lista vazia não consulta nada', async () => {
    const { svc, prisma } = montar([]);
    expect((await svc.getMessagesMediaPaths(user, [])).size).toBe(0);
    expect(prisma.message.findMany).not.toHaveBeenCalled();
  });
});

describe('GET /inbox/messages/media — o lote', () => {
  const montar = (
    infos: Record<string, { canal: string; storagePath: string; mime: string | null }>,
  ) => {
    const svc = {
      getMessagesMediaPaths: vi.fn(async (_u: unknown, ids: string[]) => {
        const m = new Map<string, (typeof infos)[string]>();
        for (const id of ids) if (infos[id]) m.set(id, infos[id]);
        return m;
      }),
    };
    const whatsappMedia = {
      signedUrl: vi.fn(async (p: string) =>
        p.includes('quebrado') ? null : `https://assinada/${p}`,
      ),
    };
    const u = undefined as never;
    const ctrl = new InboxController(svc as never, u, u, u, whatsappMedia as never, u, u, u);
    return { ctrl, svc, whatsappMedia };
  };

  it('devolve a URL de cada mídia numa resposta só', async () => {
    const { ctrl } = montar({
      m1: { canal: 'WHATSAPP', storagePath: 'a/1.jpg', mime: 'image/jpeg' },
      m2: { canal: 'WHATSAPP', storagePath: 'https://cdn/x.ogg', mime: 'audio/ogg' },
    });
    const r = await ctrl.getMessagesMedia(user, 'm1,m2');
    expect(r.itens).toEqual({
      m1: { url: 'https://assinada/a/1.jpg', mime: 'image/jpeg' },
      m2: { url: 'https://cdn/x.ogg', mime: 'audio/ogg' },
    });
  });

  it('uma mídia que falha vira null — o lote não cai por causa dela', async () => {
    const { ctrl } = montar({
      m1: { canal: 'WHATSAPP', storagePath: 'a/1.jpg', mime: 'image/jpeg' },
      m2: { canal: 'WHATSAPP', storagePath: 'quebrado.jpg', mime: 'image/jpeg' },
      m3: { canal: 'EMAIL', storagePath: 'x.pdf', mime: 'application/pdf' }, // canal sem download
    });
    const r = await ctrl.getMessagesMedia(user, 'm1,m2,m3,sumiu');
    expect(r.itens.m1).not.toBeNull();
    expect(r.itens.m2).toBeNull();
    expect(r.itens.m3).toBeNull();
    expect(r.itens.sumiu).toBeNull();
  });

  it('ids repetidos e espaços são normalizados', async () => {
    const { ctrl, svc } = montar({});
    await ctrl.getMessagesMedia(user, ' m1 ,m1,, m2');
    expect(svc.getMessagesMediaPaths).toHaveBeenCalledWith(user, ['m1', 'm2']);
  });

  it(`recusa mais de ${MAX_MIDIAS_POR_LOTE} ids`, async () => {
    const { ctrl } = montar({});
    const ids = Array.from({ length: MAX_MIDIAS_POR_LOTE + 1 }, (_, i) => `m${i}`).join(',');
    await expect(ctrl.getMessagesMedia(user, ids)).rejects.toThrow(/No máximo/);
  });

  it('o endpoint unitário continua devolvendo a mesma coisa', async () => {
    const svc = {
      getMessageMediaPath: vi.fn().mockResolvedValue({
        canal: 'WHATSAPP',
        storagePath: 'a/1.jpg',
        mime: 'image/jpeg',
      }),
    };
    const u = undefined as never;
    const ctrl = new InboxController(
      svc as never,
      u,
      u,
      u,
      { signedUrl: vi.fn(async (p: string) => `https://assinada/${p}`) } as never,
      u,
      u,
      u,
    );
    expect(await ctrl.getMessageMedia(user, 'm1')).toEqual({
      url: 'https://assinada/a/1.jpg',
      mime: 'image/jpeg',
    });
  });
});
