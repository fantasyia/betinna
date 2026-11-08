import { describe, expect, it, vi } from 'vitest';
import { VitrineAdminService } from './vitrine-admin.service';

/** Ficha do produto entra na fila de indexação na hora (Léo, 07/11). */
function montar(modelo: unknown) {
  const prisma = {
    catalogoModelo: { findFirst: vi.fn().mockResolvedValue(modelo) },
    vitrine: { findUnique: vi.fn().mockResolvedValue(null) },
    empresa: { findUnique: vi.fn().mockResolvedValue({ config: {} }) },
    knowledgeChunk: {
      upsert: vi.fn().mockResolvedValue({ id: 'chunk-1' }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const indexacao = { enfileirarChunk: vi.fn().mockResolvedValue(undefined) };
  const svc = new VitrineAdminService(prisma as never, {} as never, indexacao as never);
  return { svc, prisma, indexacao };
}

const modelo = {
  nome: 'Bermuda de Moletom',
  slug: 'bermuda',
  descricao: null,
  composicao: null,
  ativo: true,
  cores: [{ cor: { nome: 'Preto' } }],
  linhas: [
    {
      linha: { nome: 'Regular' },
      precoEntrada: 22.99,
      precoVolume: null,
      precoAtacadao: null,
      precoSugerido: 49.99,
      tabelaMedidas: null,
      tamanhos: [{ tamanho: { nome: 'M', ordem: 2 } }],
    },
  ],
};

describe('ficha do produto pro robô: indexa na hora (07/11)', () => {
  it('grava a ficha e já enfileira a indexação dela', async () => {
    const { svc, prisma, indexacao } = montar(modelo);
    await svc.sincronizarConhecimento('emp-1', 'mod-1');
    expect(prisma.knowledgeChunk.upsert).toHaveBeenCalled();
    expect(indexacao.enfileirarChunk).toHaveBeenCalledWith('chunk-1', 'emp-1');
  });

  it('modelo inativo: só desliga a ficha, não enfileira nada', async () => {
    const { svc, prisma, indexacao } = montar({ ...modelo, ativo: false });
    await svc.sincronizarConhecimento('emp-1', 'mod-1');
    expect(prisma.knowledgeChunk.updateMany).toHaveBeenCalled();
    expect(indexacao.enfileirarChunk).not.toHaveBeenCalled();
  });
});
