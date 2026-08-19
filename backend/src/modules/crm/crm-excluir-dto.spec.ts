import { describe, expect, it } from 'vitest';
import { contatoExcluirSchema } from './crm.dto';

/**
 * A trava de contagem (`confirmoExclusaoDe`) mora no DTO — mesma ideia do
 * `confirmoEnvioAoCliente`: obrigar quem chama a repetir o número force a
 * conferir a lista, em vez de mandar um array montado por engano.
 */
describe('contatoExcluirSchema', () => {
  it('aceita quando a contagem confirmada bate com os ids distintos', () => {
    const r = contatoExcluirSchema.safeParse({
      leadIds: ['a', 'b', 'c'],
      confirmoExclusaoDe: 3,
    });
    expect(r.success).toBe(true);
  });

  it('recusa quando a contagem não bate', () => {
    const r = contatoExcluirSchema.safeParse({ leadIds: ['a', 'b'], confirmoExclusaoDe: 3 });
    expect(r.success).toBe(false);
  });

  it('conta ids DISTINTOS — repetir o mesmo id não infla a contagem', () => {
    expect(
      contatoExcluirSchema.safeParse({ leadIds: ['a', 'a', 'b'], confirmoExclusaoDe: 3 }).success,
    ).toBe(false);
    expect(
      contatoExcluirSchema.safeParse({ leadIds: ['a', 'a', 'b'], confirmoExclusaoDe: 2 }).success,
    ).toBe(true);
  });

  it('não existe exclusão sem lista, nem em lote gigante', () => {
    expect(contatoExcluirSchema.safeParse({ leadIds: [], confirmoExclusaoDe: 0 }).success).toBe(
      false,
    );
    const muitos = Array.from({ length: 51 }, (_, i) => `id${i}`);
    expect(
      contatoExcluirSchema.safeParse({ leadIds: muitos, confirmoExclusaoDe: 51 }).success,
    ).toBe(false);
  });
});
