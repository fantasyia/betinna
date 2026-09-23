import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { podeArquivarQuadro } from './KanbanBoardPage';

/**
 * Quem vê o botão "Arquivar" do quadro.
 *
 * ⚠️ Isto é regra de PERMISSÃO, e o jeito de ela falhar não é dar erro — é
 * aparecer pra quem não devia. O backend exige `exigirDono` no `archive`, então
 * botão visível pra membro comum vira um 403 com cara de funcionalidade
 * quebrada.
 *
 * 🔴 E o caso que quase passa despercebido é o do quadro de SISTEMA: o dono do
 * quadro pessoal de um rep é o PRÓPRIO rep. A regra "só o dono" sozinha o
 * autorizaria a arquivar a caixa de tarefas dele — que os fluxos continuam
 * alimentando, e que ele não tem como recuperar. O backend NÃO barra isso.
 */
const quadro = (over: { criadoPorId?: string; tipoSistema?: string | null } = {}) => ({
  criadoPorId: 'leo',
  tipoSistema: null as string | null,
  ...over,
});

describe('podeArquivarQuadro', () => {
  it('o DONO de um quadro comum pode', () => {
    expect(podeArquivarQuadro(quadro(), 'leo')).toBe(true);
  });

  it('quem NÃO é dono não pode — o backend recusaria com 403', () => {
    expect(podeArquivarQuadro(quadro({ criadoPorId: 'outro' }), 'leo')).toBe(false);
  });

  it('🔴 o rep NÃO pode arquivar o próprio quadro de tarefas, mesmo sendo o dono', () => {
    // O `criadoPorId` é ele. Sem a guarda de `tipoSistema`, isto seria `true` —
    // e os fluxos seguiriam criando tarefa num quadro que ninguém mais abre.
    const meu = quadro({ criadoPorId: 'harada', tipoSistema: 'rep_tarefas' });
    expect(podeArquivarQuadro(meu, 'harada')).toBe(false);
  });

  it('🔴 nem o Diretor pode arquivar o quadro-espelho', () => {
    const espelho = quadro({ criadoPorId: 'leo', tipoSistema: 'diretor_tarefas' });
    expect(podeArquivarQuadro(espelho, 'leo')).toBe(false);
  });

  it('quadro ainda carregando não mostra o botão', () => {
    // Enquanto o board é null, `criadoPorId === meuId` seria comparação com
    // undefined — e um `!board` esquecido deixaria o botão piscar na tela.
    expect(podeArquivarQuadro(null, 'leo')).toBe(false);
    expect(podeArquivarQuadro(undefined, 'leo')).toBe(false);
  });

  it('sessão sem usuário não mostra o botão', () => {
    // `getSession()?.user.id` é `undefined` antes do bootstrap de auth. Sem a
    // guarda, `undefined === undefined` num quadro sem dono daria `true`.
    expect(podeArquivarQuadro(quadro(), undefined)).toBe(false);
    expect(
      podeArquivarQuadro({ criadoPorId: undefined as unknown as string }, undefined),
    ).toBe(false);
  });
});

/**
 * ⚠️ ESTRUTURAL — e sem isto os testes acima são decorativos.
 *
 * Medido por mutação: trocar `mostrarArquivar` por `true` na tela, ou trocar o
 * `api.delete` por `api.patch`, deixava os 6 testes de cima VERDES. A regra
 * estaria perfeita e o botão apareceria pra todo mundo, ou não arquivaria nada.
 * O que precisa ser travado não é só a função — é o fato de a tela consultá-la.
 */
describe('fiação do botão', () => {
  const fonte = readFileSync(join(__dirname, 'KanbanBoardPage.tsx'), 'utf8');

  it('a tela decide a visibilidade PELA função, não por conta própria', () => {
    expect(fonte).toMatch(
      /const mostrarArquivar = podeArquivarQuadro\(board, getSession\(\)\?\.user\.id\)/,
    );
  });

  it('o botão só renderiza atrás da regra', () => {
    expect(fonte).toContain('{mostrarArquivar && (');
    expect(fonte).toContain('data-testid="kanban-arquivar-quadro"');
  });

  it('arquivar usa DELETE — é o verbo que arquiva', () => {
    // `DELETE /kanban/boards/:id` é o soft delete (kanban-boards.service.ts,
    // `archive`). Um PATCH aqui responderia 200 sem arquivar nada.
    expect(fonte).toMatch(/await api\.delete\(`\/kanban\/boards\/\$\{boardId\}`\)/);
  });

  it('a confirmação avisa que NÃO dá pra desarquivar pelo app', () => {
    // Medido: `GET /kanban/boards/:id` devolve 404 depois de arquivado, e não
    // existe rota de restaurar. Omitir isso faz a pessoa clicar achando que
    // desfaz depois.
    expect(fonte).toContain('não dá pra desarquivar pelo app');
  });
});
