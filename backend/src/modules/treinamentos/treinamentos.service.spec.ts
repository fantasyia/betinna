import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TreinamentosService } from './treinamentos.service';
import { createTreinamentoSchema } from './treinamentos.dto';

const ITEM = {
  id: 't1',
  titulo: 'Como apresentar o Master Block',
  descricao: null,
  youtubeId: 'dQw4w9WgXcQ',
  categoria: 'Comercial',
  ordem: 1,
  ativo: true,
  criadoEm: new Date('2026-09-18T00:00:00Z'),
};

function build(itens = [ITEM]) {
  const prisma = {
    treinamento: {
      findMany: vi.fn().mockResolvedValue(itens),
      findFirst: vi.fn().mockResolvedValue({ id: 't1' }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'novo',
        ...data,
      })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...ITEM, ...data })),
      delete: vi.fn().mockResolvedValue({}),
    },
  };
  return { svc: new TreinamentosService(prisma as never), prisma };
}

const user = (over: Record<string, unknown> = {}) =>
  ({ id: 'u1', role: 'REP', empresaIdAtiva: 'emp-1', ...over }) as never;

describe('TreinamentosService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('devolve a lista com as URLs prontas', async () => {
    const { svc } = build();
    const r = await svc.list(user(), { incluirInativos: false });

    // Montar a URL no serviço, e não na tela, é o que deixa trocar a hospedagem
    // sem mexer no front.
    expect(r[0].urlEmbed).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(r[0].urlMiniatura).toContain('i.ytimg.com');
  });

  /**
   * 🔴 Multi-tenant: sem o filtro de empresa, a lista de uma empresa apareceria
   * na tela de outra.
   */
  it('filtra SEMPRE por empresa', async () => {
    const { svc, prisma } = build();
    await svc.list(user(), { incluirInativos: false });
    expect(prisma.treinamento.findMany.mock.calls[0][0].where.empresaId).toBe('emp-1');
  });

  it('pro funcionário, treinamento desativado não existe', async () => {
    const { svc, prisma } = build();
    // Mesmo pedindo inativos, o REP não os vê: desativado é o vídeo substituído
    // ou fora de uso, e mostrá-lo confundiria quem está aprendendo.
    await svc.list(user({ role: 'REP' }), { incluirInativos: true });
    expect(prisma.treinamento.findMany.mock.calls[0][0].where.ativo).toBe(true);
  });

  it('a gestão consegue ver os desativados', async () => {
    const { svc, prisma } = build();
    await svc.list(user({ role: 'DIRECTOR' }), { incluirInativos: true });
    expect(prisma.treinamento.findMany.mock.calls[0][0].where.ativo).toBeUndefined();
  });

  it('recusa quando não há empresa ativa', async () => {
    const { svc } = build();
    await expect(
      svc.list(user({ empresaIdAtiva: null }), { incluirInativos: false }),
    ).rejects.toThrow(/Empresa não definida/);
  });

  it('grava o ID do vídeo, não a URL colada', async () => {
    const { svc, prisma } = build();
    // O DTO é quem normaliza — aqui confirmo que o serviço usa o valor já pronto.
    const dto = createTreinamentoSchema.parse({
      titulo: 'Instalação em campo',
      video: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30',
    });
    await svc.create(user({ role: 'DIRECTOR' }), dto);

    const data = prisma.treinamento.create.mock.calls[0][0].data;
    expect(data.youtubeId).toBe('dQw4w9WgXcQ');
    expect(data.empresaId).toBe('emp-1');
    expect(data.criadoPorId).toBe('u1');
  });

  it('404 em treinamento de outra empresa', async () => {
    const { svc, prisma } = build();
    prisma.treinamento.findFirst.mockResolvedValue(null);
    await expect(svc.update(user({ role: 'DIRECTOR' }), 'outro', { titulo: 'x' })).rejects.toThrow(
      /não encontrado/,
    );
    expect(prisma.treinamento.update).not.toHaveBeenCalled();
  });

  it('update parcial não apaga o que não foi enviado', async () => {
    const { svc, prisma } = build();
    await svc.update(user({ role: 'DIRECTOR' }), 't1', { titulo: 'Novo título' });

    const data = prisma.treinamento.update.mock.calls[0][0].data;
    expect(data).toEqual({ titulo: 'Novo título' });
    // O vídeo não vai junto — mandar `youtubeId: undefined` seria inofensivo no
    // Prisma, mas o teste existe pra travar a forma: um dia alguém troca por
    // `null` e apaga o vídeo de um treinamento ao renomear.
    expect('youtubeId' in data).toBe(false);
  });

  it('desativar é diferente de apagar', async () => {
    const { svc, prisma } = build();
    await svc.update(user({ role: 'DIRECTOR' }), 't1', { ativo: false });
    expect(prisma.treinamento.update.mock.calls[0][0].data).toEqual({ ativo: false });
    expect(prisma.treinamento.delete).not.toHaveBeenCalled();
  });
});

describe('createTreinamentoSchema', () => {
  it('aceita o link em qualquer forma e guarda o ID', () => {
    for (const link of [
      'https://youtu.be/dQw4w9WgXcQ',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>',
    ]) {
      expect(createTreinamentoSchema.parse({ titulo: 'Aula', video: link }).video).toBe(
        'dQw4w9WgXcQ',
      );
    }
  });

  /** ⛔ Guardar o texto cru produziria um embed quebrado que ninguém veria até o funcionário abrir. */
  it('RECUSA link que não é vídeo do YouTube', () => {
    const r = createTreinamentoSchema.safeParse({ titulo: 'Aula', video: 'https://vimeo.com/123' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toContain('YouTube');
  });

  it('RECUSA link de playlist — não é um vídeo', () => {
    expect(
      createTreinamentoSchema.safeParse({
        titulo: 'Aula',
        video: 'https://www.youtube.com/playlist?list=PL1',
      }).success,
    ).toBe(false);
  });
});
