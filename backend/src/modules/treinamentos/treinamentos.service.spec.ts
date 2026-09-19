import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TreinamentosService } from './treinamentos.service';
import { createTreinamentoSchema } from './treinamentos.dto';

/**
 * A linha do banco como o serviço a lê — as DUAS fontes no mesmo tipo.
 *
 * Existe porque o fixture era um literal: o `as const` fixava `fonte` em
 * "YOUTUBE" e o `youtubeId` em `string`, e o `build(itens = [ITEM])` herdava
 * isso como o tipo do parâmetro. Resultado: o fixture do ARQUIVO — que é
 * `fonte: 'ARQUIVO'` e `youtubeId: null` — não era atribuível, e o typecheck
 * completo acusava quatro erros num arquivo cujos testes passavam.
 *
 * 📌 Passou despercebido porque o gate do CI é o `tsconfig.build.json`, que
 * EXCLUI spec. Spec que não typecheca ainda roda — até o dia em que o tipo
 * errado esconde um contrato que mudou.
 */
type Linha = {
  id: string;
  fonte: 'YOUTUBE' | 'ARQUIVO';
  arquivoPath: string | null;
  arquivoTamanho: number | null;
  titulo: string;
  descricao: string | null;
  youtubeId: string | null;
  categoria: string;
  ordem: number;
  ativo: boolean;
  criadoEm: Date;
};

const ITEM: Linha = {
  id: 't1',
  fonte: 'YOUTUBE',
  arquivoPath: null,
  arquivoTamanho: null,
  titulo: 'Como apresentar o Master Block',
  descricao: null,
  youtubeId: 'dQw4w9WgXcQ',
  categoria: 'Comercial',
  ordem: 1,
  ativo: true,
  criadoEm: new Date('2026-09-18T00:00:00Z'),
};

function build(itens: Linha[] = [ITEM]) {
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
  const arquivos = {
    // `Promise<string | null>` explícito: o null é um caminho REAL (arquivo que
    // sumiu do Storage) e tem teste próprio. Sem a anotação, o tipo saía do
    // valor de sucesso e o `mockResolvedValue(null)` do teste não compilava.
    urlParaAssistir: vi.fn(
      async (caminho: string): Promise<string | null> =>
        `https://storage/assinada/${caminho}?exp=1`,
    ),
    permitirUpload: vi.fn(async () => ({
      caminho: 'emp-1/v.mp4',
      url: 'u',
      token: 't',
      expiraEm: 'x',
    })),
    remover: vi.fn(),
  };
  return { svc: new TreinamentosService(prisma as never, arquivos as never), prisma, arquivos };
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

/**
 * A SEGUNDA FONTE (Léo, 18/09): vídeo hospedado por nós, pra quando vazar custa.
 *
 * O YouTube é o padrão porque a banda é deles; o arquivo próprio é a exceção
 * porque a banda é nossa — mas é o único que exige login de verdade.
 */
describe('treinamento com arquivo próprio', () => {
  const DO_ARQUIVO = {
    ...ITEM,
    id: 't9',
    fonte: 'ARQUIVO' as const,
    youtubeId: null,
    arquivoPath: 'emp-1/123_aula.mp4',
    arquivoTamanho: 42_000_000,
  };

  it('devolve link ASSINADO, nunca um caminho fixo', async () => {
    const { svc, arquivos } = build([DO_ARQUIVO]);
    const r = await svc.list(user(), { incluirInativos: false });

    // 🔴 O link expira — é isso que faz esta fonte significar "exige login".
    // Guardar uma URL fixa recriaria o problema do YouTube não listado, só que
    // com a nossa banda pagando.
    expect(arquivos.urlParaAssistir).toHaveBeenCalledWith('emp-1/123_aula.mp4');
    expect(r[0].urlArquivo).toContain('assinada');
    expect(r[0].urlEmbed).toBeNull();
  });

  it('arquivo que sumiu não derruba a lista inteira', async () => {
    const { svc, arquivos } = build([DO_ARQUIVO]);
    arquivos.urlParaAssistir.mockResolvedValue(null);
    const r = await svc.list(user(), { incluirInativos: false });
    // O card aparece sem player: defeito visível é melhor que lista em branco.
    expect(r).toHaveLength(1);
    expect(r[0].urlArquivo).toBeNull();
  });

  it('as duas fontes convivem na mesma lista', async () => {
    const { svc } = build([ITEM, DO_ARQUIVO]);
    const r = await svc.list(user(), { incluirInativos: false });
    expect(r[0].urlEmbed).toContain('youtube-nocookie');
    expect(r[0].urlArquivo).toBeNull();
    expect(r[1].urlEmbed).toBeNull();
    expect(r[1].urlArquivo).toContain('assinada');
  });

  it('create marca a fonte conforme o que veio', async () => {
    const { svc, prisma } = build();
    await svc.create(user({ role: 'DIRECTOR' }), {
      titulo: 'Aula gravada',
      arquivoPath: 'emp-1/123_aula.mp4',
      arquivoTamanho: 42_000_000,
      arquivoTipo: 'video/mp4',
      ordem: 0,
    } as never);

    const data = prisma.treinamento.create.mock.calls[0][0].data;
    expect(data.fonte).toBe('ARQUIVO');
    expect(data.arquivoPath).toBe('emp-1/123_aula.mp4');
    expect(data.youtubeId).toBeNull();
  });

  it('apagar o treinamento apaga o arquivo do Storage', async () => {
    const { svc, prisma, arquivos } = build();
    prisma.treinamento.findFirst.mockResolvedValue({
      id: 't9',
      arquivoPath: 'emp-1/123_aula.mp4',
    });
    await svc.remove(user({ role: 'DIRECTOR' }), 't9');
    // Sem isto o bucket vira depósito de vídeo que ninguém mais alcança — e
    // continua contando espaço.
    expect(arquivos.remover).toHaveBeenCalledWith('emp-1/123_aula.mp4');
  });

  it('apagar treinamento do YouTube não chama o Storage', async () => {
    const { svc, arquivos } = build();
    await svc.remove(user({ role: 'DIRECTOR' }), 't1');
    expect(arquivos.remover).not.toHaveBeenCalled();
  });
});

describe('createTreinamentoSchema — uma fonte, nunca duas', () => {
  it('RECUSA sem fonte nenhuma', () => {
    const r = createTreinamentoSchema.safeParse({ titulo: 'Aula' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toContain('link do YouTube ou envie');
  });

  it('RECUSA as duas juntas', () => {
    // Com as duas, nada diz qual o funcionário deve assistir — e o banco
    // guardaria um estado que a tela teria que adivinhar.
    const r = createTreinamentoSchema.safeParse({
      titulo: 'Aula',
      video: 'https://youtu.be/dQw4w9WgXcQ',
      arquivoPath: 'emp-1/v.mp4',
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toContain('Escolha UMA fonte');
  });

  it('aceita só arquivo', () => {
    expect(
      createTreinamentoSchema.safeParse({ titulo: 'Aula', arquivoPath: 'emp-1/v.mp4' }).success,
    ).toBe(true);
  });
});
