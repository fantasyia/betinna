import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { boolQuery } from './query.schema';

/**
 * O bug que isto trava (#9): `z.coerce.boolean()` é `Boolean(v)`, e
 * `Boolean('false') === true`. Toda tela que mandava `?ativo=false` recebia a
 * lista de ATIVOS — o oposto do pedido.
 */
describe('boolQuery', () => {
  const schema = z.object({ ativo: boolQuery.optional() });

  it('"false" é FALSO (o achado)', () => {
    expect(schema.parse({ ativo: 'false' }).ativo).toBe(false);
  });

  it('"0", "no", "não" e vazio também são falsos', () => {
    for (const v of ['0', 'no', 'não', 'nao', '', '  FALSE  ']) {
      expect(schema.parse({ ativo: v }).ativo).toBe(false);
    }
  });

  it('"true"/"1"/qualquer outra string é verdadeiro', () => {
    for (const v of ['true', '1', 'sim', 'TRUE']) {
      expect(schema.parse({ ativo: v }).ativo).toBe(true);
    }
  });

  it('booleano de body JSON passa direto', () => {
    expect(schema.parse({ ativo: true }).ativo).toBe(true);
    expect(schema.parse({ ativo: false }).ativo).toBe(false);
  });

  it('número segue a regra de sempre (0 = false)', () => {
    expect(schema.parse({ ativo: 0 }).ativo).toBe(false);
    expect(schema.parse({ ativo: 1 }).ativo).toBe(true);
  });

  it('ausente continua undefined (não vira false)', () => {
    expect(schema.parse({}).ativo).toBeUndefined();
  });
});
