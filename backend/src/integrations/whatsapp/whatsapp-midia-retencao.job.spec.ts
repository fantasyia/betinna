import { describe, expect, it, vi } from 'vitest';
import {
  WhatsappMidiaRetencaoJob,
  caminhoApagavel,
  retencaoDias,
} from './whatsapp-midia-retencao.job';

/** Retenção das mídias do WhatsApp (Léo, 19/10: 45 dias). */

describe('regras', () => {
  it('só apaga mídia de CONVERSA da própria empresa; fluxo e base de conhecimento ficam', () => {
    expect(caminhoApagavel('emp-1/5511999990000/msg1.jpg', 'emp-1')).toBe(true);
    expect(caminhoApagavel('emp-1/fluxo/out_1.jpg', 'emp-1')).toBe(false);
    expect(caminhoApagavel('emp-1/conhecimento/catalogo.pdf', 'emp-1')).toBe(false);
    expect(caminhoApagavel('emp-2/5511999990000/msg1.jpg', 'emp-1')).toBe(false); // outra empresa
    expect(caminhoApagavel('emp-1/arquivo.jpg', 'emp-1')).toBe(false); // fora do padrão
  });

  it('retenção só vale ligada e com pelo menos 15 dias', () => {
    expect(retencaoDias({ whatsappMidia: { retencaoDias: 45 } })).toBe(45);
    expect(retencaoDias({})).toBeNull();
    expect(retencaoDias({ whatsappMidia: { retencaoDias: null } })).toBeNull();
    expect(retencaoDias({ whatsappMidia: { retencaoDias: 3 } })).toBeNull();
  });
});

function montar(o: { antigos: string[]; emUso?: string[] }) {
  const prisma = {
    $queryRaw: vi.fn().mockResolvedValue((o.emUso ?? []).map((p) => ({ p }))),
    $executeRaw: vi.fn().mockResolvedValue(1),
  };
  const media = {
    listarAntigos: vi.fn().mockResolvedValue(o.antigos),
    removerVarios: vi.fn(async (ps: string[]) => ps),
  };
  const job = new WhatsappMidiaRetencaoJob(
    prisma as never,
    media as never,
    {} as never,
    { get: () => 'production' } as never,
  );
  return { job, prisma, media };
}

describe('limparEmpresa', () => {
  it('apaga do Storage o arquivo velho (inclusive órfão) e limpa o mediaUrl; protege o que está em uso', async () => {
    const { job, media, prisma } = montar({
      antigos: ['emp-1/5511/a.jpg', 'emp-1/5511/b.ogg', 'emp-1/fluxo/c.jpg'],
      emUso: ['emp-1/5511/b.ogg'], // mensagem nova ainda usa
    });
    const n = await job.limparEmpresa('emp-1', 45, new Date('2026-10-19T12:00:00Z'));
    const corte = media.listarAntigos.mock.calls[0][1] as Date;
    expect(corte.toISOString().slice(0, 10)).toBe('2026-09-04');
    expect(media.listarAntigos.mock.calls[0][2]).toEqual(['fluxo', 'conhecimento']);
    expect(media.removerVarios).toHaveBeenCalledWith(['emp-1/5511/a.jpg']);
    expect(n).toBe(1);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('nada velho: não apaga nada', async () => {
    const { job, media } = montar({ antigos: [] });
    expect(await job.limparEmpresa('emp-1', 45)).toBe(0);
    expect(media.removerVarios).not.toHaveBeenCalled();
  });
});
