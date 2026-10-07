import { describe, expect, it, vi } from 'vitest';
import { BusinessRuleException } from '@shared/errors/app-exception';
import { EncaixeService, agenteSumiu } from './encaixe.service';

const user = { id: 'u-1', role: 'DIRECTOR', empresaIdAtiva: 'emp-1', empresaIds: ['emp-1'] };

/** Regras do 100 (bermuda moletinho, tubular 1,03 m). */
const regras100 = {
  codigoMolde: '100',
  tecido: 'TUBULAR',
  larguraUtilMm: 1030,
  espelhar: true,
  giroCorpo: 'GIRA_180',
  giroForro: 'LIVRE',
  encavalamentoMm: 0,
  espacamentoMm: 0,
  observacoes: 'só do modelista',
};

function montar(
  opts: {
    regras?: unknown;
    status?: string;
    aberto?: boolean;
    jobs?: Array<{
      id: string;
      status: string;
      tempoMin?: number;
      pegoEm?: Date | null;
      atualizadoEm?: Date;
    }>;
  } = {},
) {
  const jobs = opts.jobs ?? [];
  const prisma = {
    ordemProducao: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'op-1',
        numero: 'OP-0001',
        status: opts.status ?? 'RASCUNHO',
        modelo: {
          id: 'm-1',
          nome: 'Bermuda Moletom Summer',
          regrasEncaixe: opts.regras === undefined ? regras100 : opts.regras,
        },
      }),
    },
    catalogoModeloLinha: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'ml-inf',
        linha: { nome: 'Infantil' },
        tamanhos: ['2', '4', '6', '8'].map((nome, ordem) => ({ tamanho: { nome, ordem } })),
      }),
    },
    encaixeJob: {
      findFirst: vi.fn(async ({ where }: { where: { id?: string; opId?: string } }) => {
        if (where.opId) return opts.aberto ? { id: 'j-aberto' } : null;
        const j = jobs.find((x) => x.id === where.id) ?? { id: where.id, status: 'RODANDO' };
        return {
          ...j,
          progresso: null,
          tempoMin: 30,
          entrada: { linha: { nome: 'Infantil' }, composicao: [], modelo: { codigoMolde: '100' } },
          arquivos: [],
        };
      }),
      findMany: vi.fn(async ({ where }: { where: { status: string } }) =>
        jobs
          .filter((j) => j.status === where.status)
          .map((j) => ({ tempoMin: 30, pegoEm: null, atualizadoEm: new Date(), ...j })),
      ),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        tempoMin: 30,
        entrada: { modelo: { codigoMolde: '100' } },
      })),
      count: vi.fn(
        async ({ where }: { where: { status: string } }) =>
          jobs.filter((j) => j.status === where.status).length,
      ),
      create: vi.fn().mockResolvedValue({ id: 'j-novo' }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    encaixeArquivo: { upsert: vi.fn().mockResolvedValue({}), findFirst: vi.fn() },
  };
  const erp = { empresaLigada: vi.fn().mockResolvedValue('emp-1') };
  return { svc: new EncaixeService(prisma as never, erp as never), prisma };
}

const pedido = {
  modeloLinhaId: 'ml-inf',
  composicao: [
    { tamanho: '8', quantidade: 1 },
    { tamanho: '2', quantidade: 1 },
    { tamanho: '4', quantidade: 2 },
  ],
  tempoMin: 30,
};

describe('EncaixeService — pedir o risco pela OP', () => {
  it('monta a entrada do agente: molde, composição NA ORDEM da grade, regras e plotter de 185 cm', async () => {
    const { svc, prisma } = montar();
    await svc.criar(user as never, 'op-1', pedido);
    const data = prisma.encaixeJob.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      empresaId: 'emp-1',
      opId: 'op-1',
      modeloLinhaId: 'ml-inf',
      tempoMin: 30,
    });
    expect(data.entrada).toMatchObject({
      modelo: { codigoMolde: '100' },
      linha: { nome: 'Infantil' },
      composicao: [
        { tamanho: '2', quantidade: 1 },
        { tamanho: '4', quantidade: 2 },
        { tamanho: '8', quantidade: 1 },
      ],
      regras: { tecido: 'TUBULAR', larguraUtilMm: 1030 },
      plotter: { formato: 'HPGL', escala: 1, larguraPapelMm: 1850 },
    });
    // observação do modelista não vai pro agente
    expect(data.entrada.regras.observacoes).toBeUndefined();
  });

  it('recusa sem regras, sem código do molde, ou tecido mais largo que o papel do plotter', async () => {
    await expect(montar({ regras: null }).svc.criar(user as never, 'op-1', pedido)).rejects.toThrow(
      /regras de encaixe/,
    );
    await expect(
      montar({ regras: { ...regras100, codigoMolde: null } }).svc.criar(
        user as never,
        'op-1',
        pedido,
      ),
    ).rejects.toThrow(/código do molde/);
    await expect(
      montar({ regras: { ...regras100, larguraUtilMm: 1900 } }).svc.criar(
        user as never,
        'op-1',
        pedido,
      ),
    ).rejects.toThrow(/papel do plotter/);
  });

  it('recusa tamanho fora da grade, OP cancelada e segundo risco na fila da mesma OP', async () => {
    await expect(
      montar().svc.criar(user as never, 'op-1', {
        ...pedido,
        composicao: [{ tamanho: 'GG', quantidade: 1 }],
      }),
    ).rejects.toThrow(/fora da grade/);
    await expect(
      montar({ status: 'CANCELADA' }).svc.criar(user as never, 'op-1', pedido),
    ).rejects.toBeInstanceOf(BusinessRuleException);
    const { svc, prisma } = montar({ aberto: true });
    await expect(svc.criar(user as never, 'op-1', pedido)).rejects.toThrow(/já tem um risco/);
    expect(prisma.encaixeJob.create).not.toHaveBeenCalled();
  });
});

describe('EncaixeService — agente da GPU', () => {
  it('UM por vez: com outro RODANDO, não entrega trabalho', async () => {
    const { svc, prisma } = montar({
      jobs: [
        { id: 'j-1', status: 'RODANDO', pegoEm: new Date(), atualizadoEm: new Date() },
        { id: 'j-2', status: 'PENDENTE' },
      ],
    });
    const r = await svc.proximo(user as never, 'PC Léo');
    expect(r.trabalho).toBeNull();
    expect(prisma.encaixeJob.updateMany).not.toHaveBeenCalled();
  });

  it('pega o mais antigo PENDENTE por CAS e marca quem pegou', async () => {
    const { svc, prisma } = montar({ jobs: [{ id: 'j-2', status: 'PENDENTE' }] });
    const r = await svc.proximo(user as never, 'PC Léo');
    expect(r.trabalho?.id).toBe('j-2');
    expect(prisma.encaixeJob.updateMany).toHaveBeenCalledWith({
      where: { id: 'j-2', status: 'PENDENTE' },
      data: expect.objectContaining({ status: 'RODANDO', agente: 'PC Léo' }),
    });
  });

  it('outro agente pegou antes (CAS perdeu): não entrega o mesmo trabalho', async () => {
    const { svc, prisma } = montar({ jobs: [{ id: 'j-2', status: 'PENDENTE' }] });
    prisma.encaixeJob.updateMany.mockResolvedValue({ count: 0 });
    expect((await svc.proximo(user as never, 'PC Léo')).trabalho).toBeNull();
  });

  it('agente sumido (passou do tempo + folga, ou mudo há 10 min) → FALHOU', () => {
    const agora = new Date('2026-10-08T12:00:00Z');
    const min = (n: number) => new Date(agora.getTime() - n * 60_000);
    expect(agenteSumiu({ tempoMin: 30, pegoEm: min(20), atualizadoEm: min(1) }, agora)).toBe(false);
    expect(agenteSumiu({ tempoMin: 30, pegoEm: min(50), atualizadoEm: min(1) }, agora)).toBe(true);
    expect(agenteSumiu({ tempoMin: 30, pegoEm: min(20), atualizadoEm: min(11) }, agora)).toBe(true);
  });

  it('progresso guarda a imagem do melhor até agora; cancelado responde CANCELADO sem gravar', async () => {
    const a = montar({ jobs: [{ id: 'j-1', status: 'RODANDO' }] });
    const r = await a.svc.progresso(user as never, 'j-1', {
      comprimentoM: 1.984,
      aproveitamento: 85.7,
      imagemPng: Buffer.from('png').toString('base64'),
    });
    expect(r.status).toBe('RODANDO');
    expect(a.prisma.encaixeArquivo.upsert.mock.calls[0][0].where).toEqual({
      jobId_tipo: { jobId: 'j-1', tipo: 'PREVIEW' },
    });
    const b = montar({ jobs: [{ id: 'j-1', status: 'CANCELADO' }] });
    expect((await b.svc.progresso(user as never, 'j-1', { comprimentoM: 1 })).status).toBe(
      'CANCELADO',
    );
    expect(b.prisma.encaixeJob.updateMany).not.toHaveBeenCalled();
  });

  it('resultado: exige HPGL em texto; guarda .plt e imagem; vira CONCLUIDO', async () => {
    const { svc, prisma } = montar({ jobs: [{ id: 'j-1', status: 'RODANDO' }] });
    await expect(
      svc.concluir(user as never, 'j-1', {
        comprimentoM: 1.98,
        aproveitamento: 85,
        plt: 'isto não é hpgl nenhum',
      }),
    ).rejects.toThrow(/HPGL/);
    const plt = 'NE7495,1072; IN; VS32,1..8; WU0; PW0.350,1..8; PU; SP1; PU0,0; PD400,0;';
    await svc.concluir(user as never, 'j-1', {
      comprimentoM: 1.98,
      aproveitamento: 85.7,
      plt,
      imagemPng: Buffer.from('png').toString('base64'),
    });
    const tipos = prisma.encaixeArquivo.upsert.mock.calls.map((c) => c[0].where.jobId_tipo.tipo);
    expect(tipos).toEqual(['PLT', 'PNG']);
    expect(
      Buffer.from(prisma.encaixeArquivo.upsert.mock.calls[0][0].create.conteudo).toString('utf8'),
    ).toBe(plt);
    expect(prisma.encaixeJob.updateMany).toHaveBeenCalledWith({
      where: { id: 'j-1', status: 'RODANDO' },
      data: expect.objectContaining({ status: 'CONCLUIDO' }),
    });
  });

  it('resultado de trabalho cancelado: recusa (não vira concluído)', async () => {
    const { svc, prisma } = montar({ jobs: [{ id: 'j-1', status: 'CANCELADO' }] });
    await expect(
      svc.concluir(user as never, 'j-1', { comprimentoM: 1, aproveitamento: 80, plt: 'IN;PU0,0;' }),
    ).rejects.toThrow(/CANCELADO/);
    expect(prisma.encaixeArquivo.upsert).not.toHaveBeenCalled();
  });
});
