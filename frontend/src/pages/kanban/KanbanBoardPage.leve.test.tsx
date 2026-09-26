import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { filtrarListas } from './KanbanBoardPage';
import type { KCardResumo, KLista } from './kanban-types';

/**
 * BETINNA-FRONT-A: a listagem do quadro deixou de trazer a DESCRIÇÃO dos cards
 * (76% do peso do quadro DEV). O risco do conserto é a busca da tela: ela
 * procurava também na descrição. Se o filtro só olhasse o título, um card que
 * bate pela descrição SUMIRIA do quadro filtrado — sem erro, sem aviso.
 */

function card(id: string, titulo: string): KCardResumo {
  return {
    id,
    listaId: 'l1',
    titulo,
    posicao: 1,
    dataInicio: null,
    dataEntrega: null,
    concluido: false,
    corCapa: null,
    arquivado: false,
    etiquetas: [],
    membros: [],
    checklists: [],
    _count: { comentarios: 0, anexos: 0 },
  };
}

const listas: KLista[] = [
  {
    id: 'l1',
    boardId: 'b1',
    nome: 'Concluído',
    posicao: 1,
    arquivada: false,
    cards: [
      card('c1', 'Sincronizar ERP estoura timeout'),
      card('c2', 'Webhook do Asaas'),
      card('c3', 'Quadro pesado'),
    ],
  },
];

const filtro = (texto: string) => ({ texto, etiqueta: '', membro: '', vencimento: '' });
const ids = (l: KLista[]) => l[0].cards.map((c) => c.id);

describe('busca do quadro sem a descrição na listagem', () => {
  it('título bate na hora, sem esperar o servidor', () => {
    expect(ids(filtrarListas(listas, filtro('asaas'), new Set(), 0))).toEqual(['c2']);
  });

  it('card que bate SÓ pela descrição continua aparecendo — vem da busca do servidor', () => {
    // "sentry" não está em nenhum título; o servidor achou na descrição do c3.
    expect(ids(filtrarListas(listas, filtro('sentry'), new Set(['c3']), 0))).toEqual(['c3']);
  });

  it('título OU servidor: os dois somam', () => {
    expect(ids(filtrarListas(listas, filtro('asaas'), new Set(['c1']), 0))).toEqual(['c1', 'c2']);
  });

  it('não bate em nada: esconde', () => {
    expect(ids(filtrarListas(listas, filtro('inexistente'), new Set(), 0))).toEqual([]);
  });
});

/** Estrutural: a regra acima só vale se a tela estiver ligada nela. */
describe('fiação da tela', () => {
  const fonte = readFileSync(join(__dirname, 'KanbanBoardPage.tsx'), 'utf8');

  it('o quadro é carregado pela carga leve (assinatura + desde)', () => {
    expect(fonte).toMatch(/queryFn: \(\) => carregarBoard\(boardId as string, boardAtualRef\.current\)/);
  });

  it('a busca de texto pergunta ao servidor, que ainda enxerga a descrição', () => {
    expect(fonte).toContain('/busca?q=${encodeURIComponent(textoDebounced)}');
  });

  it('o filtro da tela é o `filtrarListas`, com os ids da busca', () => {
    expect(fonte).toMatch(/filtrarListas\(\s*listas,[\s\S]*?idsDaBusca,/);
  });
});
