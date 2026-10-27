import { describe, expect, it, vi } from 'vitest';
import { PendenciasService } from './pendencias.service';

/** Rodada: o que sumiu da lista do marketplace fecha — menos o caso que a IA passou pra equipe. */
function montar(equipeEscreveu: boolean) {
  const fechadas: string[] = [];
  const prisma = {
    pendenciaMarketplace: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
      // 1ª chamada: abertas do canal; depois (avisar): nada a avisar.
      findMany: vi
        .fn()
        .mockResolvedValueOnce([
          { id: 'humano', tipo: 'MENSAGEM', chave: 'conv:1', estado: 'AGUARDANDO_HUMANO' },
          { id: 'comum', tipo: 'MENSAGEM', chave: 'conv:2', estado: null },
        ])
        .mockResolvedValue([]),
      updateMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => {
        fechadas.push(...where.id.in);
        return { count: where.id.in.length };
      }),
      count: vi.fn(async () => 0),
    },
    pendenciaRespostaIa: {
      findFirst: vi.fn(async () => ({ conversationId: 'c1', criadoEm: new Date('2026-10-26') })),
    },
    message: { count: vi.fn(async () => (equipeEscreveu ? 1 : 0)) },
    usuario: { findMany: vi.fn(async () => []) },
  };
  const verificadores = {
    levantar: vi.fn(async () => new Map([['MARKETPLACE_SHOPEE', []]])),
  };
  const svc = new PendenciasService(
    prisma as never,
    verificadores as never,
    {} as never,
    { enviar: vi.fn(async () => 0) } as never,
  );
  return { svc, fechadas };
}

describe('rodada das pendências — caso passado pra equipe (26/10)', () => {
  it('a mensagem de espera da IA NÃO fecha o caso: fica aberto até a equipe responder', async () => {
    const t = montar(false);
    await t.svc.rodada('e1');
    expect(t.fechadas).toEqual(['comum']);
  });

  it('alguém da equipe respondeu na conversa: aí fecha', async () => {
    const t = montar(true);
    await t.svc.rodada('e1');
    expect(t.fechadas.sort()).toEqual(['comum', 'humano']);
  });
});
