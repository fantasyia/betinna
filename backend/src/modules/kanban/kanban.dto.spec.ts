import { describe, expect, it } from 'vitest';
import { createBoardSchema, updateBoardSchema } from './kanban.dto';

describe('updateBoardSchema', () => {
  /** Léo, 29/09: "Renomear quadro" sem descrição não salvava. */
  it('aceita renomear com a descrição vazia (a tela manda null)', () => {
    const r = updateBoardSchema.safeParse({ nome: 'DEV', descricao: null });
    expect(r.success).toBe(true);
    expect(r.success && r.data).toMatchObject({ nome: 'DEV', descricao: null });
  });

  it('continua aceitando descrição em texto e sem o campo', () => {
    expect(updateBoardSchema.safeParse({ descricao: 'x' }).success).toBe(true);
    expect(updateBoardSchema.safeParse({ nome: 'DEV' }).success).toBe(true);
  });

  it('nome vazio segue recusado', () => {
    expect(updateBoardSchema.safeParse({ nome: '  ' }).success).toBe(false);
  });

  it('criar quadro não passa a aceitar null (lá o campo é só opcional)', () => {
    expect(createBoardSchema.safeParse({ nome: 'X', descricao: null }).success).toBe(false);
  });
});
