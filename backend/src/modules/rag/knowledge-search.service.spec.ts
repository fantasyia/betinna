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
    expect(prisma.knowledgeChunk.findMany).toHaveBeenCalledTimes(1); // fallback rodou
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

    const where = prisma.knowledgeChunk.findMany.mock.calls[0][0].where;
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
    expect(prisma.knowledgeChunk.findMany).not.toHaveBeenCalled();
  });
});
