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
  | 'risco'
  | 'criticos'
  | 'novos'
  | 'horeca'
  | 'inadimplentes';

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
      key: 'risco',
      nome: '⚠️ Em risco',
      descricao: 'Clientes com status "Em risco"',
      cor: '#d97706',
      where: { status: 'RISCO' },
    },
    {
      key: 'criticos',
      nome: '🔴 Críticos',
      descricao: 'Clientes com status "Crítico"',
      cor: 'var(--rd)',
      where: { status: 'CRITICO' },
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
  ];
}
