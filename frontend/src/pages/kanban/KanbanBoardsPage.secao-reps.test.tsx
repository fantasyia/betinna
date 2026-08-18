import { describe, expect, it } from 'vitest';
import { separarQuadros } from './KanbanBoardsPage';
import type { KBoardResumo } from './kanban-types';

/**
 * Regra de separação dos quadros na listagem.
 *
 * O incômodo é do ADMIN/DIRECTOR, que enxerga o quadro de TODO MUNDO: com 10
 * reps a lista dele vira 10 quadros que não são dele. Mas o REP não pode perder
 * o quadro DELE da lista principal — senão abre a tela, vê tudo vazio, e o
 * próprio quadro fica escondido numa seção chamada "dos representantes".
 */
const board = (over: Partial<KBoardResumo>): KBoardResumo =>
  ({
    id: 'b',
    nome: 'Quadro',
    descricao: null,
    corFundo: '#000',
    imagemFundo: null,
    criadoPorId: 'x',
    criadoPor: { id: 'x', nome: 'X' },
    membros: [],
    atualizadoEm: '',
    ...over,
  }) as KBoardResumo;

describe('separação dos quadros na listagem', () => {
  const dev = board({ id: 'dev', nome: 'DEV', tipoSistema: null, criadoPorId: 'leo' });
  const diretor = board({ id: 'dir', tipoSistema: 'diretor_tarefas', criadoPorId: 'leo' });
  const doHarada = board({ id: 'h', tipoSistema: 'rep_tarefas', criadoPorId: 'harada' });
  const doOutro = board({ id: 'o', tipoSistema: 'rep_tarefas', criadoPorId: 'outro' });

  it('Diretor: quadros de rep saem da lista principal', () => {
    const r = separarQuadros([dev, diretor, doHarada, doOutro], 'leo');
    expect(r.principais.map((b) => b.id)).toEqual(['dev', 'dir']);
    expect(r.deReps.map((b) => b.id)).toEqual(['h', 'o']);
  });

  it('REP continua vendo o PRÓPRIO quadro na lista principal', () => {
    const r = separarQuadros([doHarada], 'harada');
    expect(r.principais.map((b) => b.id)).toEqual(['h']);
    expect(r.deReps).toEqual([]); // nada escondido pra ele
  });

  it('o quadro-espelho do Diretor NÃO é tratado como quadro de rep', () => {
    const r = separarQuadros([diretor], 'leo');
    expect(r.principais.map((b) => b.id)).toEqual(['dir']);
  });

  it('quadro de trabalho criado por um rep continua na lista principal', () => {
    // Só `tipoSistema: rep_tarefas` sai — não "tudo que um rep criou".
    const projeto = board({ id: 'p', tipoSistema: null, criadoPorId: 'harada' });
    const r = separarQuadros([projeto], 'leo');
    expect(r.principais.map((b) => b.id)).toEqual(['p']);
  });
});
