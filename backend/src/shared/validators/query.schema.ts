import { z } from 'zod';

/**
 * Booleano vindo de QUERY STRING.
 *
 * AUDITORIA (#9): os DTOs usavam `z.coerce.boolean()`, que por baixo é
 * `Boolean(valor)` — e `Boolean('false') === true`. Ou seja: `?ativo=false`,
 * `?arquivado=false`, `?somenteAtivos=false` chegavam no service como TRUE e a
 * lista voltava exatamente o oposto do que a tela pediu. Como a UI quase sempre
 * manda só o caso positivo, o bug passava despercebido até alguém montar a URL
 * na mão ou salvar um filtro.
 *
 * Aqui a string é interpretada de verdade: 'false', '0', 'no', 'não' e vazio são
 * falsos; qualquer outra coisa é verdadeira. Número segue a regra de sempre
 * (0 = false) e booleano de body JSON passa direto.
 */
export const boolQuery = z.preprocess((v) => {
  if (typeof v === 'string') {
    return !['false', '0', 'no', 'nao', 'não', ''].includes(v.trim().toLowerCase());
  }
  if (typeof v === 'number') return v !== 0;
  return v;
}, z.boolean());
