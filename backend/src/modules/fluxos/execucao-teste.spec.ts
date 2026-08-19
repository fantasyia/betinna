import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FluxosService } from './fluxos.service';
import { BusinessRuleException } from '@shared/errors/app-exception';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';

/**
 * Execução de TESTE não é resultado do fluxo.
 *
 * O caso real: o painel do T1 mostrava "0% de sucesso" com erro de nó, e o
 * fluxo estava PAUSADO — nunca tinha visto mensagem. As duas execuções eram do
 * botão de testar. O número mandou alguém investigar um bug que não existia.
 */
const user = { id: 'u1', role: 'DIRECTOR', empresaIdAtiva: 'emp1' } as AuthenticatedUser;

const noWa = (acaoTipo: string, titulo = acaoTipo) => ({
  id: `no-${acaoTipo}`,
  tipo: 'ACAO',
  acaoTipo,
  titulo,
});

function makeService(nos: Array<Record<string, unknown>> = []) {
  const fluxo = {
    id: 'f1',
    empresaId: 'emp1',
    nome: 'T1',
    status: 'PAUSADO',
    nos: [{ id: 'trg', tipo: 'TRIGGER', acaoTipo: null, titulo: 'Chegou mensagem' }, ...nos],
  };
  const prisma = {
    fluxo: {
      findFirst: vi.fn().mockResolvedValue(fluxo),
      findUniqueOrThrow: vi.fn().mockResolvedValue(fluxo),
    },
    fluxoExecucao: {
      create: vi.fn().mockResolvedValue({ id: 'exec-1' }),
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
    },
    conversation: { findFirst: vi.fn().mockResolvedValue(null) },
    lead: { findMany: vi.fn().mockResolvedValue([]) },
  };
  const bus = { dispararDireto: vi.fn().mockResolvedValue(undefined) };
  const svc = new FluxosService(
    prisma as never,
    bus as never,
    { del: vi.fn() } as never,
    { uploadOutbound: vi.fn() } as never,
  );
  return { svc, prisma, bus };
}

describe('métricas do painel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('contam SÓ produção — teste fica de fora de todos os números', async () => {
    const { svc, prisma } = makeService();

    await svc.metricas(user, 'f1');

    // Toda contagem de resultado leva teste:false; só a de testes leva true.
    const wheres = prisma.fluxoExecucao.count.mock.calls.map(
      (c) => (c[0] as { where: Record<string, unknown> }).where,
    );
    expect(wheres.filter((w) => w.teste === false)).toHaveLength(4);
    expect(wheres.filter((w) => w.teste === true)).toHaveLength(1);
  });

  it('devolve a contagem de testes à parte (pra tela poder explicar o zero)', async () => {
    const { svc, prisma } = makeService();
    prisma.fluxoExecucao.count.mockResolvedValue(0).mockResolvedValueOnce(0);

    const m = await svc.metricas(user, 'f1');

    expect(m).toHaveProperty('testes');
    // Fluxo que nunca rodou em produção: 0% não é "falhando", é "não rodou".
    expect(m.taxaSucesso).toBe(0);
    expect(m.total).toBe(0);
  });
});

describe('histórico de execuções', () => {
  beforeEach(() => vi.clearAllMocks());

  it('default é PRODUÇÃO', async () => {
    const { svc, prisma } = makeService();

    await svc.listExecucoes(user, 'f1', { page: 1, limit: 20, origem: 'producao' });

    const where = (prisma.fluxoExecucao.findMany.mock.calls[0][0] as { where: { teste?: boolean } })
      .where;
    expect(where.teste).toBe(false);
  });

  it('aba de testes traz só teste; "todas" não filtra', async () => {
    const { svc, prisma } = makeService();

    await svc.listExecucoes(user, 'f1', { page: 1, limit: 20, origem: 'teste' });
    expect(
      (prisma.fluxoExecucao.findMany.mock.calls[0][0] as { where: { teste?: boolean } }).where
        .teste,
    ).toBe(true);

    await svc.listExecucoes(user, 'f1', { page: 1, limit: 20, origem: 'todas' });
    expect(
      (prisma.fluxoExecucao.findMany.mock.calls[1][0] as { where: { teste?: boolean } }).where
        .teste,
    ).toBeUndefined();
  });
});

describe('testar fluxo', () => {
  beforeEach(() => vi.clearAllMocks());

  it('marca a execução como teste na COLUNA, não só no contexto', async () => {
    const { svc, prisma } = makeService();

    await svc.testar(user, { fluxoId: 'f1', contexto: {} });

    const data = (prisma.fluxoExecucao.create.mock.calls[0][0] as { data: { teste: boolean } })
      .data;
    expect(data.teste).toBe(true);
  });

  it('RECUSA antes de criar execução quando o fluxo precisa de conversa', async () => {
    // É o T1: CRIAR_LEAD sem conversa morre sempre no primeiro nó, e a execução
    // falha ainda ia sujar o painel. Melhor recusar com a instrução certa.
    const { svc, prisma } = makeService([noWa('CRIAR_LEAD', 'Criar/amarrar lead na Triagem')]);

    await expect(svc.testar(user, { fluxoId: 'f1', contexto: {} })).rejects.toBeInstanceOf(
      BusinessRuleException,
    );
    expect(prisma.fluxoExecucao.create).not.toHaveBeenCalled();
  });

  it('a recusa NOMEIA o nó e diz o que fazer', async () => {
    const { svc } = makeService([noWa('CRIAR_LEAD', 'Criar/amarrar lead na Triagem')]);

    const err = await svc.testar(user, { fluxoId: 'f1', contexto: {} }).catch((e: Error) => e);

    expect(err.message).toContain('Criar/amarrar lead na Triagem');
    expect(err.message).toMatch(/conversa/i);
    expect(err.message).toMatch(/Nenhuma execução foi criada/);
  });

  it('com CONVERSA informada: semeia o contexto no formato do evento real', async () => {
    const { svc, prisma } = makeService([noWa('CRIAR_LEAD')]);
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'conv-1',
      canal: 'WHATSAPP',
      leadId: 'lead-9',
      proprietarioId: null,
      mensagens: [{ conteudo: 'oi, quero orçamento' }],
    });

    await svc.testar(user, { fluxoId: 'f1', contexto: {}, conversationId: 'conv-1' });

    const ctx = (prisma.fluxoExecucao.create.mock.calls[0][0] as { data: { contexto: unknown } })
      .data.contexto as Record<string, unknown>;
    expect(ctx.conversationId).toBe('conv-1');
    expect(ctx.canal).toBe('WHATSAPP');
    expect(ctx.leadId).toBe('lead-9');
    expect(ctx.texto).toBe('oi, quero orçamento');
    expect(ctx._teste).toBe(true);
  });

  it('conversa de outra empresa: recusa (não vaza conversa entre tenants)', async () => {
    const { svc, prisma } = makeService([noWa('CRIAR_LEAD')]);
    prisma.conversation.findFirst.mockResolvedValue(null);

    await expect(
      svc.testar(user, { fluxoId: 'f1', contexto: {}, conversationId: 'de-outro-tenant' }),
    ).rejects.toBeInstanceOf(BusinessRuleException);
    expect(prisma.fluxoExecucao.create).not.toHaveBeenCalled();
  });

  it('fluxo que NÃO depende de conversa segue testável sem informar nada', async () => {
    const { svc, prisma } = makeService([noWa('ENVIAR_EMAIL')]);

    await svc.testar(user, { fluxoId: 'f1', contexto: {} });

    expect(prisma.fluxoExecucao.create).toHaveBeenCalled();
  });
});

describe('modo seco: teste NÃO manda mensagem pra pessoa', () => {
  beforeEach(() => vi.clearAllMocks());

  it('default é NÃO enviar — a marca vai no contexto', async () => {
    const { svc, prisma } = makeService();

    await svc.testar(user, { fluxoId: 'f1', contexto: {}, enviarDeVerdade: false });

    const ctx = (prisma.fluxoExecucao.create.mock.calls[0][0] as { data: { contexto: unknown } })
      .data.contexto as Record<string, unknown>;
    expect(ctx._teste).toBe(true);
    expect(ctx._testeEnviaDeVerdade).toBe(false);
  });

  it('só envia de verdade com opt-in explícito', async () => {
    const { svc, prisma } = makeService();

    await svc.testar(user, { fluxoId: 'f1', contexto: {}, enviarDeVerdade: true });

    const ctx = (prisma.fluxoExecucao.create.mock.calls[0][0] as { data: { contexto: unknown } })
      .data.contexto as Record<string, unknown>;
    expect(ctx._testeEnviaDeVerdade).toBe(true);
  });
});
