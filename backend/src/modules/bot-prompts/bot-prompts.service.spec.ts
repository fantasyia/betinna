import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { BusinessRuleException, NotFoundException } from '@shared/errors/app-exception';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { BotPromptsService } from './bot-prompts.service';

const makePrisma = () => {
  const botPrompt = {
    findFirst: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ id: 'p1' }),
    update: vi.fn().mockResolvedValue({ id: 'p1' }),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'p1' }),
  };
  return {
    botPrompt,
    // findById devolve `usadoEm` (quais fluxos referenciam o promptId). A busca
    // é best-effort no service, mas o mock precisa existir pra não mascarar
    // outra falha dentro do catch.
    fluxoNo: { findMany: vi.fn().mockResolvedValue([]) },
    // $transaction invoca o callback com o próprio mock (tx === prisma).
    $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb({ botPrompt })),
  };
};

const fakeUser = (overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  id: 'u1',
  email: 'dir@x.com',
  nome: 'Diretor',
  role: 'DIRECTOR' as never,
  empresaIds: ['emp-1'],
  empresaIdAtiva: 'emp-1',
  ...overrides,
});

describe('BotPromptsService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: BotPromptsService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new BotPromptsService(prisma as never);
  });

  it('list filtra pela empresa ativa', async () => {
    await service.list(fakeUser(), {});
    const where = prisma.botPrompt.findMany.mock.calls[0][0].where;
    expect(where.empresaId).toBe('emp-1');
  });

  it('findById lança NotFound quando não existe', async () => {
    prisma.botPrompt.findFirst.mockResolvedValue(null);
    await expect(service.findById(fakeUser(), 'x')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('create com isPadrao desmarca os outros padrões da empresa', async () => {
    await service.create(fakeUser(), { nome: 'P1', texto: 'oi', isPadrao: true });
    expect(prisma.botPrompt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { empresaId: 'emp-1', isPadrao: true },
        data: { isPadrao: false },
      }),
    );
    expect(prisma.botPrompt.create).toHaveBeenCalled();
  });

  it('create sem isPadrao não mexe nos demais', async () => {
    await service.create(fakeUser(), { nome: 'P1', texto: 'oi' });
    expect(prisma.botPrompt.updateMany).not.toHaveBeenCalled();
  });

  it('create traduz unique (P2002) em BusinessRuleException', async () => {
    prisma.botPrompt.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: '6.19.3',
      }),
    );
    await expect(service.create(fakeUser(), { nome: 'P1', texto: 'oi' })).rejects.toBeInstanceOf(
      BusinessRuleException,
    );
  });

  it('definirPadrao desmarca os demais e marca este', async () => {
    prisma.botPrompt.findFirst.mockResolvedValue({ id: 'p1', empresaId: 'emp-1' });
    await service.definirPadrao(fakeUser(), 'p1');
    expect(prisma.botPrompt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { empresaId: 'emp-1', isPadrao: true, id: { not: 'p1' } },
      }),
    );
    expect(prisma.botPrompt.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { isPadrao: true },
    });
  });

  it('remove apaga com escopo de empresa', async () => {
    prisma.botPrompt.findFirst.mockResolvedValue({ id: 'p1', empresaId: 'emp-1' });
    await service.remove(fakeUser(), 'p1');
    expect(prisma.botPrompt.deleteMany).toHaveBeenCalledWith({
      where: { id: 'p1', empresaId: 'emp-1' },
    });
  });

  it('obterTextoPadrao retorna o texto (trim) do padrão ativo', async () => {
    prisma.botPrompt.findFirst.mockResolvedValue({ texto: '  Prompt padrão  ' });
    expect(await service.obterTextoPadrao('emp-1')).toBe('Prompt padrão');
    const where = prisma.botPrompt.findFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({ empresaId: 'emp-1', isPadrao: true, ativo: true });
  });

  it('obterTextoPadrao retorna null quando não há padrão', async () => {
    prisma.botPrompt.findFirst.mockResolvedValue(null);
    expect(await service.obterTextoPadrao('emp-1')).toBeNull();
  });

  it('obterTextoPorId filtra por id + empresa + ativo', async () => {
    prisma.botPrompt.findFirst.mockResolvedValue({ texto: 'X' });
    await service.obterTextoPorId('emp-1', 'p9');
    const where = prisma.botPrompt.findFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({ id: 'p9', empresaId: 'emp-1', ativo: true });
  });
});

/**
 * `usadoEm` no detalhe do prompt.
 *
 * Prompt compartilhado por dois fluxos muda o comportamento dos DOIS quando
 * alguém edita o texto. Sem essa lista, a única forma de descobrir onde ele é
 * usado era abrir fluxo por fluxo procurando o promptId.
 */
describe('BotPromptsService.findById — usadoEm', () => {
  it('devolve os fluxos/nós que referenciam o promptId', async () => {
    const prisma = makePrisma();
    prisma.botPrompt.findFirst.mockResolvedValue({ id: 'p1', empresaId: 'emp-1', nome: 'X' });
    prisma.fluxoNo.findMany.mockResolvedValue([
      { titulo: 'IA — triagem', fluxo: { id: 'f1', nome: 'T1', status: 'PAUSADO' } },
      { titulo: 'IA — consultivo', fluxo: { id: 'f2', nome: 'C1', status: 'ATIVO' } },
    ]);

    const r = await new BotPromptsService(prisma as never).findById(fakeUser(), 'p1');

    expect(r.usadoEm).toEqual([
      { fluxoId: 'f1', fluxoNome: 'T1', fluxoStatus: 'PAUSADO', noTitulo: 'IA — triagem' },
      { fluxoId: 'f2', fluxoNome: 'C1', fluxoStatus: 'ATIVO', noTitulo: 'IA — consultivo' },
    ]);
  });

  it('busca só nós da MESMA empresa do prompt (multi-tenant)', async () => {
    const prisma = makePrisma();
    prisma.botPrompt.findFirst.mockResolvedValue({ id: 'p1', empresaId: 'emp-1' });

    await new BotPromptsService(prisma as never).findById(fakeUser(), 'p1');

    const where = prisma.fluxoNo.findMany.mock.calls[0][0].where as {
      config: unknown;
      fluxo: { empresaId: string };
    };
    expect(where.fluxo.empresaId).toBe('emp-1');
    expect(where.config).toEqual({ path: ['promptId'], equals: 'p1' });
  });

  it('falha ao buscar os usos NÃO derruba o detalhe do prompt', async () => {
    const prisma = makePrisma();
    prisma.botPrompt.findFirst.mockResolvedValue({ id: 'p1', empresaId: 'emp-1' });
    prisma.fluxoNo.findMany.mockRejectedValue(new Error('banco fora'));

    const r = await new BotPromptsService(prisma as never).findById(fakeUser(), 'p1');

    expect(r.usadoEm).toEqual([]);
  });
});

/**
 * Edição por trecho no service: o que interessa aqui é que a validação acontece
 * ANTES de qualquer escrita, e que a versão nova é gravada com o texto já
 * substituído (senão o histórico guardaria uma versão que nunca existiu).
 */
describe('BotPromptsService.update — substituir', () => {
  const user = { id: 'u1', role: 'DIRECTOR', empresaIdAtiva: 'emp-1' } as never;
  const TEXTO = 'linha 1\nBoa noite! 😊 tudo bem?\nlinha 3';

  const montar = () => {
    const atualizado = { id: 'p1', texto: '', versao: 2 };
    const tx = {
      botPrompt: {
        updateMany: vi.fn().mockResolvedValue({}),
        update: vi.fn().mockImplementation(({ data }: { data: { texto?: string } }) => {
          atualizado.texto = data.texto ?? '';
          return Promise.resolve({});
        }),
        findUniqueOrThrow: vi.fn().mockImplementation(() => Promise.resolve({ ...atualizado })),
      },
      botPromptVersao: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      // findById também resolve `usadoEm` (nós de fluxo que citam o promptId).
      fluxoNo: { findMany: vi.fn().mockResolvedValue([]) },
      botPrompt: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'p1',
          empresaId: 'emp-1',
          nome: 'R1',
          texto: TEXTO,
          modelo: null,
          temperatura: null,
          versao: 1,
        }),
      },
      $transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx)),
    };
    return { svc: new BotPromptsService(prisma as never), prisma, tx };
  };

  it('grava o texto com o trecho trocado e devolve tamanho antes/depois', async () => {
    const { svc, tx } = montar();

    const r = await svc.update(user, 'p1', {
      substituir: [{ de: 'Boa noite! 😊 tudo bem?', para: 'Olá, tudo bem?' }],
    } as never);

    const gravado = (tx.botPrompt.update.mock.calls[0][0] as { data: { texto: string } }).data
      .texto;
    expect(gravado).toBe('linha 1\nOlá, tudo bem?\nlinha 3');
    expect(r.tamanhoAntes).toBe(TEXTO.length);
    expect(r.tamanhoDepois).toBe(gravado.length);
  });

  it('versiona: guarda snapshot do texto ANTIGO e sobe a versão', async () => {
    const { svc, tx } = montar();

    await svc.update(user, 'p1', {
      substituir: [{ de: 'Boa noite! 😊 tudo bem?', para: 'Olá, tudo bem?' }],
    } as never);

    expect(
      (tx.botPromptVersao.create.mock.calls[0][0] as { data: { texto: string } }).data.texto,
    ).toBe(TEXTO);
    expect((tx.botPrompt.update.mock.calls[0][0] as { data: { versao: number } }).data.versao).toBe(
      2,
    );
  });

  it('trecho ambíguo/inexistente: NÃO abre transação nenhuma', async () => {
    const { svc, prisma } = montar();

    await expect(
      svc.update(user, 'p1', { substituir: [{ de: 'não existe', para: 'x' }] } as never),
    ).rejects.toThrow(/não encontrado/i);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('texto + substituir juntos: recusa (a intenção é ambígua)', async () => {
    const { svc, prisma } = montar();

    await expect(
      svc.update(user, 'p1', {
        texto: 'outro',
        substituir: [{ de: 'linha 1', para: 'x' }],
      } as never),
    ).rejects.toThrow(/não os dois/i);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
