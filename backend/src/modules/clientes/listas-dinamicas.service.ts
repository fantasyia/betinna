import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

/**
 * Listas dinâmicas pré-definidas (espelham as do protótipo).
 *
 * Cada lista retorna um `where` parcial Prisma que pode ser combinado
 * com outros filtros. As listas são puras (não tocam banco) — quem
 * executa a query é o ClientesService.
 *
 * Algumas listas exigem dados que ainda não existem (ex: pedidos pra
 * calcular ticket). Por isso retornamos `whereOrIds` que pode ser:
 * - `where`: parcial Prisma direto
 * - `idsResolver`: função que retorna IDs dos clientes a incluir
 */
export type ListaDinamicaKey =
  | 'vip'
  | 'risco'
  | 'criticos'
  | 'novos'
  | 'horeca'
  | 'inadimplentes'
  | 'top10';

export interface ListaDinamicaDefinicao {
  key: ListaDinamicaKey;
  nome: string;
  descricao: string;
  cor: string;
  where: Prisma.ClienteWhereInput;
}

@Injectable()
export class ListasDinamicasService {
  /**
   * Retorna o `where` adicional a aplicar para uma lista dinâmica.
   * Combinar com `AND` no service principal.
   */
  whereFor(key: ListaDinamicaKey): Prisma.ClienteWhereInput {
    const def = this.definicoes.find((d) => d.key === key);
    return def?.where ?? {};
  }

  /**
   * Definições completas (pra expor via endpoint GET /clientes/listas).
   * Mantém alinhado com o frontend do protótipo.
   */
  definicoes: ListaDinamicaDefinicao[] = [
    {
      key: 'vip',
      nome: '🔥 VIP — alta receita',
      descricao: 'Score >= 80 e status ativo',
      cor: 'var(--purple)',
      where: { score: { gte: 80 }, status: 'ATIVO' },
    },
    {
      key: 'risco',
      nome: '⚠️ Em risco',
      descricao: 'Score entre 30 e 60 ou status em risco',
      cor: '#d97706',
      where: {
        OR: [{ status: 'RISCO' }, { AND: [{ score: { gte: 30 } }, { score: { lt: 60 } }] }],
      },
    },
    {
      key: 'criticos',
      nome: '🔴 Críticos',
      descricao: 'Score < 30 ou status crítico',
      cor: 'var(--rd)',
      where: { OR: [{ status: 'CRITICO' }, { score: { lt: 30 } }] },
    },
    {
      key: 'novos',
      nome: '🆕 Novos cadastros',
      descricao: 'Status NOVO',
      cor: 'var(--cyan)',
      where: { status: 'NOVO' },
    },
    {
      key: 'horeca',
      nome: '🍽️ HoReCa',
      descricao: 'Restaurantes, Buffets e Hotéis',
      cor: 'var(--blue)',
      where: { segmento: { in: ['Restaurante', 'Buffet', 'Hotel'] } },
    },
    {
      key: 'inadimplentes',
      nome: '💸 Inadimplentes',
      descricao: 'Bloqueados no OMIE',
      cor: 'var(--rd)',
      where: { omieStatus: 'BLOQUEADO' },
    },
    {
      key: 'top10',
      nome: '⭐ Top 10 ticket',
      descricao: '10 maiores tickets — calculado quando houver pedidos',
      cor: 'var(--gn)',
      where: {}, // substituído por orderBy + take=10 no service
    },
  ];
}
