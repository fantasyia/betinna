import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KnowledgeSearchService } from './knowledge-search.service';

// CAÇADA-BUG #33: a busca semântica precisa de um PISO de similaridade — sem ele, os top-K chunks
// entravam no prompt por mais irrelevantes que fossem.

const chunk = (id: string, score: number) => ({
  id,
  titulo: `t-${id}`,
  conteudo: `c-${id}`,
  categoria: null,
  fonte: 'MANUAL' as const,
  score,
});

const makePrisma = () => ({
  $queryRaw: vi.fn(),
  knowledgeChunk: { findMany: vi.fn().mockResolvedValue([]) }, // fallback keyword
});

const makeEmbedding = () => ({
  gerar: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]), // vetor válido → tenta semântico
});

describe('KnowledgeSearchService — piso de similaridade semântica (#33)', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let embedding: ReturnType<typeof makeEmbedding>;
  let svc: KnowledgeSearchService;

  beforeEach(() => {
    prisma = makePrisma();
    embedding = makeEmbedding();
    svc = new KnowledgeSearchService(prisma as never, embedding as never);
  });

  it('mantém só os chunks acima do piso (0.3) e descarta os irrelevantes', async () => {
    // 1ª chamada = busca semântica. Mistura relevante (0.55) e lixo (0.12).
    prisma.$queryRaw.mockResolvedValueOnce([chunk('a', 0.55), chunk('b', 0.12)]);

    const r = await svc.buscar('emp-1', 'qual a política de devolução?');

    expect(r.map((c) => c.id)).toEqual(['a']); // 'b' (0.12) descartado
  });

  it('quando NENHUM chunk passa o piso, cai no keyword (não injeta lixo)', async () => {
    // Busca semântica ($queryRaw) só devolve lixo → null → cai no keyword (knowledgeChunk.findMany).
    prisma.$queryRaw.mockResolvedValueOnce([chunk('x', 0.15), chunk('y', 0.08)]);
    prisma.knowledgeChunk.findMany.mockResolvedValue([
      { id: 'kw', titulo: 't', conteudo: 'c', categoria: null, fonte: 'MANUAL' },
    ]);

    const r = await svc.buscar('emp-1', 'oi tudo bem');

    // Não retornou os chunks semânticos irrelevantes; caiu no keyword.
    expect(r.map((c) => c.id)).toEqual(['kw']);
    // fallback rodou (a outra consulta é a das fichas citadas, sem OR)
    const doKeyword = prisma.knowledgeChunk.findMany.mock.calls.filter(
      (c) => (c[0] as { where: { OR?: unknown } }).where.OR,
    );
    expect(doKeyword).toHaveLength(1);
  });

  it('score exatamente no piso (0.3) é mantido', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([chunk('z', 0.3)]);
    const r = await svc.buscar('emp-1', 'x');
    expect(r.map((c) => c.id)).toEqual(['z']);
  });

  it('stoplist: keyword ignora stopwords pt-BR (só casa palavras de conteúdo)', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([]); // semântico vazio → keyword fallback
    prisma.knowledgeChunk.findMany.mockResolvedValue([]);

    await svc.buscar('emp-1', 'qual o prazo para entrega da devolução?');

    const where = prisma.knowledgeChunk.findMany.mock.calls
      .map((c) => (c[0] as { where: { OR?: unknown } }).where)
      .find((w) => w.OR)!;
    const termos = [
      ...new Set(
        (where.OR as Array<{ titulo?: { contains: string }; conteudo?: { contains: string } }>)
          .map((o) => o.titulo?.contains ?? o.conteudo?.contains)
          .filter(Boolean),
      ),
    ];
    expect(termos).toEqual(expect.arrayContaining(['prazo', 'entrega', 'devolução']));
    expect(termos).not.toContain('qual');
    expect(termos).not.toContain('para');
  });

  it('stoplist: consulta SÓ de stopwords → retorna [] sem consultar o banco', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([]); // semântico vazio → cai no keyword

    const r = await svc.buscar('emp-1', 'que para com dos');

    expect(r).toEqual([]);
    expect(
      prisma.knowledgeChunk.findMany.mock.calls.some(
        (c) => (c[0] as { where: { OR?: unknown } }).where.OR,
      ),
    ).toBe(false);
  });
});

describe('KnowledgeSearchService — ficha do produto citado entra sempre (07/11)', () => {
  const ficha = (id: string, titulo: string) => ({
    id,
    titulo,
    conteudo: `${titulo}: preço R$ 24,99`,
    categoria: 'produtos',
    fonte: 'CONFIG',
  });
  const montar = () => {
    const prisma = makePrisma();
    const svc = new KnowledgeSearchService(prisma as never, makeEmbedding() as never);
    return { prisma, svc };
  };

  it('pergunta com o nome do produto põe a ficha na frente dos trechos parecidos', async () => {
    const { prisma, svc } = montar();
    prisma.knowledgeChunk.findMany.mockResolvedValueOnce([
      ficha('f1', 'Produto · Bermuda de Moletom'),
      ficha('f2', 'Produto · Calça de Moletom'),
    ]);
    prisma.$queryRaw.mockResolvedValueOnce([
      chunk('m1', 0.6),
      chunk('m2', 0.55),
      chunk('m3', 0.5),
      chunk('m4', 0.45),
    ]);
    const r = await svc.buscar('emp-1', 'qual o preço da bermuda de moletom no plus size?');
    expect(r.map((c) => c.id)).toEqual(['f1', 'm1', 'm2', 'm3']);
  });

  it('nome incompleto na pergunta não força ficha (fica com a busca normal)', async () => {
    const { prisma, svc } = montar();
    prisma.knowledgeChunk.findMany.mockResolvedValueOnce([
      ficha('f1', 'Produto · Bermuda de Moletom'),
    ]);
    prisma.$queryRaw.mockResolvedValueOnce([chunk('m1', 0.6)]);
    const r = await svc.buscar('emp-1', 'tem bermuda plus?');
    expect(r.map((c) => c.id)).toEqual(['m1']);
  });

  it('acento e caixa não atrapalham, e a ficha não aparece duas vezes', async () => {
    const { prisma, svc } = montar();
    prisma.knowledgeChunk.findMany.mockResolvedValueOnce([
      ficha('f1', 'Produto · Calça Tactel com Zíper'),
    ]);
    prisma.$queryRaw.mockResolvedValueOnce([{ ...chunk('f1', 0.7) }, chunk('m1', 0.5)]);
    const r = await svc.buscar('emp-1', 'Quanto custa a CALCA TACTEL com ziper?');
    expect(r.map((c) => c.id)).toEqual(['f1', 'm1']);
  });
});
