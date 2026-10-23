import type { Prisma } from '@prisma/client';
import type { PrismaService } from '@database/prisma.service';

/**
 * Filtro "fora do pipeline" (23/10): leads de funil marcado `foraDoPipeline`
 * (carteira de clientes, ex.: "Clientes · Recompra") não contam como venda em
 * andamento. Devolve um item pra pôr no `AND` do where (o `OR` não colide com
 * outros `OR` da consulta). Sem funil marcado: nada.
 */
export async function filtroForaDoPipeline(
  prisma: Pick<PrismaService, 'funil'>,
  empresaId: string,
): Promise<Prisma.LeadWhereInput[]> {
  const ids = (
    await prisma.funil.findMany({
      where: { empresaId, foraDoPipeline: true },
      select: { id: true },
    })
  ).map((f) => f.id);
  return ids.length ? [{ OR: [{ funilId: null }, { funilId: { notIn: ids } }] }] : [];
}
