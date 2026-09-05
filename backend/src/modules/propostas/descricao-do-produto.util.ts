import type { PrismaService } from '@database/prisma.service';

/**
 * Anexa a descrição ATUAL do produto (vinda do ERP pelo sync) aos itens de uma
 * proposta, pelo `produtoId`.
 *
 * Por que não gravar no PropostaItem: o item guarda `produtoNome` como snapshot
 * pra não quebrar se o produto for desativado — mas a descrição é o "o que é /
 * pra que serve", e o cliente deve ler a versão vigente do ERP, não a de quando
 * a proposta foi digitada. Uma consulta só, por proposta.
 */
export async function anexarDescricaoDoProduto<T extends { produtoId: string }>(
  prisma: Pick<PrismaService, 'produto'>,
  itens: T[],
): Promise<Array<Omit<T, 'produtoId'> & { descricao: string | null }>> {
  const ids = [...new Set(itens.map((i) => i.produtoId))];
  const produtos = ids.length
    ? await prisma.produto.findMany({
        where: { id: { in: ids } },
        select: { id: true, descricao: true },
      })
    : [];
  const por = new Map(produtos.map((p) => [p.id, p.descricao ?? null]));
  return itens.map(({ produtoId, ...resto }) => ({
    ...resto,
    descricao: por.get(produtoId) ?? null,
  }));
}
