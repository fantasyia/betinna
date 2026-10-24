import { describe, expect, it, vi } from 'vitest';
import { precisaLembrete, resumoDoAviso } from './pendencias';
import { PendenciasService } from './pendencias.service';

const agora = new Date('2026-10-24T12:00:00Z');
const h = (n: number) => new Date(agora.getTime() + n * 3600_000);

describe('resumoDoAviso / precisaLembrete (24/10)', () => {
  it('agrupa por marketplace e tipo, com o prazo mais curto', () => {
    const r = resumoDoAviso(
      [
        { canal: 'MARKETPLACE_SHOPEE', tipo: 'MENSAGEM' },
        { canal: 'MARKETPLACE_SHOPEE', tipo: 'MENSAGEM' },
        { canal: 'MARKETPLACE_SHOPEE', tipo: 'DEVOLUCAO' },
        { canal: 'MARKETPLACE_ML', tipo: 'RECLAMACAO', prazo: h(18) },
      ],
      agora,
    );
    expect(r.titulo).toBe('4 pendências nos marketplaces');
    expect(r.corpo).toBe(
      '3 na Shopee (2 mensagens, 1 devolução), 1 no Mercado Livre (1 reclamação) · prazo mais curto: 18 h',
    );
  });

  it('lembrete só com prazo < 24 h, já avisado e sem lembrete', () => {
    expect(precisaLembrete({ prazo: h(10), avisadaEm: h(-5), lembreteEm: null }, agora)).toBe(true);
    expect(precisaLembrete({ prazo: h(30), avisadaEm: h(-5), lembreteEm: null }, agora)).toBe(
      false,
    );
    expect(precisaLembrete({ prazo: h(10), avisadaEm: null, lembreteEm: null }, agora)).toBe(false);
    expect(precisaLembrete({ prazo: h(10), avisadaEm: h(-5), lembreteEm: h(-1) }, agora)).toBe(
      false,
    );
    expect(precisaLembrete({ prazo: h(-1), avisadaEm: h(-5), lembreteEm: null }, agora)).toBe(
      false,
    );
  });
});

/** Banco em memória mínimo da PendenciaMarketplace. */
function montar(achados: Map<string, unknown[] | null>) {
  const linhas: Array<Record<string, unknown>> = [];
  let seq = 0;
  const casa = (r: Record<string, unknown>, w: Record<string, unknown>) =>
    Object.entries(w).every(([k, v]) => {
      if (k === 'id' && v && typeof v === 'object' && 'in' in v)
        return (v as { in: string[] }).in.includes(r.id as string);
      if (v === null) return r[k] === null || r[k] === undefined;
      return r[k] === v;
    });
  const prisma = {
    pendenciaMarketplace: {
      findUnique: vi.fn(async ({ where }) => {
        const k = where.empresaId_canal_tipo_chave;
        return (
          linhas.find(
            (r) =>
              r.empresaId === k.empresaId &&
              r.canal === k.canal &&
              r.tipo === k.tipo &&
              r.chave === k.chave,
          ) ?? null
        );
      }),
      create: vi.fn(async ({ data }) => {
        const r = {
          id: `p${++seq}`,
          avisadaEm: null,
          lembreteEm: null,
          resolvidaEm: null,
          ...data,
        };
        linhas.push(r);
        return r;
      }),
      update: vi.fn(async ({ where, data }) =>
        Object.assign(linhas.find((r) => r.id === where.id)!, data),
      ),
      findMany: vi.fn(async ({ where }) => linhas.filter((r) => casa(r, where))),
      updateMany: vi.fn(async ({ where, data }) => {
        const alvo = linhas.filter((r) => casa(r, where));
        alvo.forEach((r) => Object.assign(r, data));
        return { count: alvo.length };
      }),
      count: vi.fn(async ({ where }) => linhas.filter((r) => casa(r, where)).length),
    },
    usuario: { findMany: vi.fn().mockResolvedValue([{ id: 'u1' }]) },
  };
  const verificadores = { levantar: vi.fn(async () => achados) };
  const notificacoes = { criarParaRole: vi.fn().mockResolvedValue(1) };
  const push = { enviar: vi.fn().mockResolvedValue(1) };
  const svc = new PendenciasService(
    prisma as never,
    verificadores as never,
    notificacoes as never,
    push as never,
  );
  return { svc, linhas, push, verificadores };
}

const msg = (chave: string) => ({
  canal: 'MARKETPLACE_SHOPEE',
  tipo: 'MENSAGEM',
  chave,
  titulo: 'Mensagem sem resposta',
});

describe('PendenciasService.rodada', () => {
  it('avisa UMA vez por item novo (a rodada seguinte não repete)', async () => {
    const { svc, push } = montar(new Map([['MARKETPLACE_SHOPEE', [msg('conv:1')]]]));
    expect((await svc.rodada('e1', agora)).avisadas).toBe(1);
    expect((await svc.rodada('e1', agora)).avisadas).toBe(0);
    expect(push.enviar).toHaveBeenCalledTimes(1);
  });

  it('o que sumiu da conferência vira resolvido; voltou = avisa de novo', async () => {
    const achados = new Map<string, unknown[] | null>([['MARKETPLACE_SHOPEE', [msg('conv:1')]]]);
    const { svc, linhas, push } = montar(achados);
    await svc.rodada('e1', agora);
    achados.set('MARKETPLACE_SHOPEE', []);
    expect((await svc.rodada('e1', agora)).abertas).toBe(0);
    expect(linhas[0].resolvidaEm).toEqual(agora);
    achados.set('MARKETPLACE_SHOPEE', [msg('conv:1')]);
    expect((await svc.rodada('e1', agora)).avisadas).toBe(1);
    expect(push.enviar).toHaveBeenCalledTimes(2);
  });

  it('conferência que FALHOU não resolve nada daquele canal', async () => {
    const achados = new Map<string, unknown[] | null>([['MARKETPLACE_SHOPEE', [msg('conv:1')]]]);
    const { svc, linhas } = montar(achados);
    await svc.rodada('e1', agora);
    achados.set('MARKETPLACE_SHOPEE', null);
    expect((await svc.rodada('e1', agora)).abertas).toBe(1);
    expect(linhas[0].resolvidaEm).toBeNull();
  });
});
