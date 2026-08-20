import { describe, expect, it, vi } from 'vitest';
import { FluxoTriggersJob } from './fluxo-triggers.job';

/**
 * Ação de SLA `tag`: carimbar a etiqueta tem que DISPARAR `LEAD_RECEBEU_TAG`.
 *
 * O job gravava o `LeadTag` direto pelo prisma e parava ali. Quem dispara o
 * evento é o `LeadsService.vincularTag`, e o job não passa por lá — então quem
 * configurava "quando estourar o SLA, marca a etiqueta X" esperando um fluxo
 * reagir recebia SILÊNCIO: a etiqueta aparecia no kanban e nada acontecia.
 *
 * É o que faz cada etapa virar seu próprio gatilho de "lead parado": SLA da
 * etapa + `tagNome` da família (`parado:proposta`) + um fluxo com gatilho
 * LEAD_RECEBEU_TAG filtrando por PREFIXO `parado:` cobre o funil inteiro, cada
 * etapa no prazo dela.
 */
const TAG = { id: 'tag-1', nome: 'parado:proposta' };

function build(criou = true) {
  const prisma = {
    tag: { upsert: vi.fn().mockResolvedValue(TAG) },
    leadTag: { createMany: vi.fn().mockResolvedValue({ count: criou ? 1 : 0 }) },
    lead: { findUnique: vi.fn().mockResolvedValue(null), update: vi.fn() },
    funilEtapa: { findFirst: vi.fn() },
  };
  const bus = { disparar: vi.fn().mockResolvedValue(undefined) };
  const notificacoes = {
    criarParaUsuario: vi.fn().mockResolvedValue(null),
    criarParaRole: vi.fn().mockResolvedValue(null),
  };
  const job = new FluxoTriggersJob(
    prisma as never,
    {} as never,
    bus as never,
    { get: () => 'test' } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    notificacoes as never,
  );
  return { job, prisma, bus };
}

/** `aplicarAcaoSla` é privado — é o contrato que interessa. */
const aplicar = (job: FluxoTriggersJob, acao: Record<string, unknown>) =>
  (
    job as unknown as {
      aplicarAcaoSla: (
        e: string,
        l: string,
        o: string,
        a: Record<string, unknown>,
      ) => Promise<void>;
    }
  ).aplicarAcaoSla('emp-1', 'lead-9', 'etapa-origem', acao);

describe('SLA da etapa — ação `tag` dispara LEAD_RECEBEU_TAG', () => {
  it('carimba a etiqueta E dispara o evento, com o nome no payload', async () => {
    const { job, bus } = build();

    await aplicar(job, { tipo: 'tag', tagNome: 'parado:proposta' });

    // `tagNome` é obrigatório no payload: é por ele que o gatilho filtra QUAL
    // etiqueta dispara o fluxo (match exato ou por prefixo).
    expect(bus.disparar).toHaveBeenCalledWith('emp-1', 'LEAD_RECEBEU_TAG', {
      leadId: 'lead-9',
      tagId: 'tag-1',
      tagNome: 'parado:proposta',
    });
  });

  it('etiqueta que o lead JÁ tinha não redispara (createMany count=0)', async () => {
    // Duas defesas contra repetição e as duas importam: a busca do job já exclui
    // quem tem a etiqueta, e esta confere no momento da ESCRITA — o filtro
    // sozinho é uma corrida entre duas rodadas concorrentes do job.
    const { job, bus } = build(false);

    await aplicar(job, { tipo: 'tag', tagNome: 'parado:proposta' });

    expect(bus.disparar).not.toHaveBeenCalled();
  });

  it('ação `notificar` também dispara — o rótulo dela é etiqueta como qualquer outra', async () => {
    const { job, bus, prisma } = build();

    await aplicar(job, { tipo: 'notificar' });

    expect(prisma.tag.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { empresaId_nome: { empresaId: 'emp-1', nome: '⚠ SLA vencido' } },
      }),
    );
    expect(bus.disparar).toHaveBeenCalledWith(
      'emp-1',
      'LEAD_RECEBEU_TAG',
      expect.objectContaining({ tagNome: '⚠ SLA vencido' }),
    );
  });

  it('ação `mover` sai antes — dispara LEAD_ETAPA_MUDOU, não carimba etiqueta', async () => {
    const { job, bus, prisma } = build();
    prisma.funilEtapa.findFirst.mockResolvedValue({
      id: 'etapa-destino',
      funilId: 'f1',
      tipo: 'ATIVA',
    });

    await aplicar(job, { tipo: 'mover', etapaDestinoId: 'etapa-destino' });

    expect(prisma.tag.upsert).not.toHaveBeenCalled();
    expect(bus.disparar).toHaveBeenCalledWith(
      'emp-1',
      'LEAD_ETAPA_MUDOU',
      expect.objectContaining({ leadId: 'lead-9' }),
    );
  });
});
