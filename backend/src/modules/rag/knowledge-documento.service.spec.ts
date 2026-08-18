import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KnowledgeDocumentoService } from './knowledge-documento.service';

/**
 * Duas permissões DIFERENTES sobre o mesmo documento:
 *  - `podeEnviar`  → o bot ANEXA o arquivo na conversa do cliente;
 *  - "usar como fonte" → o CONTEÚDO alimenta a resposta.
 *
 * O card veio de uma dúvida real do Léo: "bot pode enviar" manda o arquivo ou
 * só usa o conteúdo? Manda o arquivo. E um playbook de vendas interno pode
 * legitimamente não merecer NENHUMA das duas — mas até aqui só a primeira era
 * controlável por documento (a segunda era trecho a trecho, 23 cliques num PDF
 * de 23 páginas, então na prática ninguém desligava).
 */
const makePrisma = () => ({
  knowledgeDocumento: {
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
    findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'doc-1' }),
  },
  knowledgeChunk: {
    groupBy: vi.fn().mockResolvedValue([]),
    updateMany: vi.fn().mockResolvedValue({ count: 23 }),
    findMany: vi.fn().mockResolvedValue([]),
    update: vi.fn(),
  },
});

const user = { id: 'u1', email: 'leo@betinna.ai', empresaIdAtiva: 'emp-1' } as never;

describe('KnowledgeDocumentoService — fonte de resposta vs anexar arquivo', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let svc: KnowledgeDocumentoService;

  beforeEach(() => {
    prisma = makePrisma();
    svc = new KnowledgeDocumentoService(prisma as never, {} as never);
    prisma.knowledgeDocumento.findFirst.mockResolvedValue({ id: 'doc-1', titulo: 'Playbook' });
  });

  it('desligar "usar como fonte" desativa TODOS os trechos de uma vez', async () => {
    await svc.atualizar(user, 'doc-1', { usarComoFonte: false } as never);

    expect(prisma.knowledgeChunk.updateMany).toHaveBeenCalledWith({
      where: { documentoId: 'doc-1' },
      data: { ativo: false },
    });
  });

  it('religar volta os trechos', async () => {
    await svc.atualizar(user, 'doc-1', { usarComoFonte: true } as never);

    expect(prisma.knowledgeChunk.updateMany).toHaveBeenCalledWith({
      where: { documentoId: 'doc-1' },
      data: { ativo: true },
    });
  });

  it('mexer SÓ no anexo não toca nos trechos (são permissões independentes)', async () => {
    await svc.atualizar(user, 'doc-1', { podeEnviar: true } as never);

    expect(prisma.knowledgeDocumento.update).toHaveBeenCalledWith({
      where: { id: 'doc-1' },
      data: { titulo: undefined, podeEnviar: true },
    });
    expect(prisma.knowledgeChunk.updateMany).not.toHaveBeenCalled();
  });

  it('a listagem informa quantos trechos estão ATIVOS (é o que revela a 2ª permissão)', async () => {
    prisma.knowledgeDocumento.findMany.mockResolvedValue([
      { id: 'doc-1', titulo: 'Playbook', totalChunks: 23 },
      { id: 'doc-2', titulo: 'Catálogo', totalChunks: 5 },
    ]);
    prisma.knowledgeChunk.groupBy.mockResolvedValue([
      { documentoId: 'doc-2', _count: { _all: 5 } },
    ]);

    const r = await svc.listar(user);

    // O playbook está indexado mas FORA das respostas; o catálogo está dentro.
    expect(r[0].chunksAtivos).toBe(0);
    expect(r[1].chunksAtivos).toBe(5);
  });

  it('documento de outra empresa não é atualizável', async () => {
    prisma.knowledgeDocumento.findFirst.mockResolvedValue(null);

    await expect(
      svc.atualizar(user, 'de-outro', { usarComoFonte: false } as never),
    ).rejects.toThrow();
    expect(prisma.knowledgeChunk.updateMany).not.toHaveBeenCalled();
  });
});
