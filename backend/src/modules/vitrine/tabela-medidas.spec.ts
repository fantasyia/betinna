import { describe, expect, it } from 'vitest';
import { tabelaMedidasSchema } from './vitrine.dto';

const tabela = (colunas: string[], nota?: string) =>
  tabelaMedidasSchema.safeParse({
    colunas,
    linhas: [{ tamanho: 'M', valores: colunas.map(() => '40') }],
    ...(nota !== undefined ? { nota } : {}),
  });

describe('tabela de medidas (28/10)', () => {
  it('aceita observação e nome de coluna de até 50 caracteres', () => {
    const r = tabela(['C'.repeat(50)], '  Medidas da peça deitada, em cm.  ');
    expect(r.success).toBe(true);
    expect(r.success && r.data.nota).toBe('Medidas da peça deitada, em cm.');
  });

  it('recusa nome de coluna com 51 caracteres', () => {
    expect(tabela(['C'.repeat(51)]).success).toBe(false);
  });

  it('observação vazia vira ausente; acima de 300 é recusada', () => {
    const r = tabela(['Cintura'], '   ');
    expect(r.success).toBe(true);
    expect(r.success && 'nota' in r.data && r.data.nota !== undefined).toBe(false);
    expect(tabela(['Cintura'], 'x'.repeat(301)).success).toBe(false);
  });
});
