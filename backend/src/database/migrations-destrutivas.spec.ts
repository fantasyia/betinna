import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Migration que APAGA ou RENOMEIA coluna/tabela não pode subir no mesmo deploy
 * do código que para de usar o nome antigo.
 *
 * Por quê (06/10, BETINNA-API-D): o deploy do `aae292b` rodou
 * `ALTER TABLE "CatalogoModelo" DROP COLUMN "categoria"` na subida; o container
 * ANTERIOR seguiu atendendo por ~14s e pediu a coluna que não existia mais →
 * 500 na tela da vitrine pra um usuário real. A regra "drop = dois deploys"
 * já estava escrita no CLAUDE.md e não segurou: dependia de alguém lembrar.
 *
 * Como passar: no MESMO migration.sql, um comentário dizendo por que é seguro
 * — em geral, que o código já parou de usar o nome num deploy ANTERIOR:
 *
 *   -- drop-seguro: código parou de ler "categoria" no deploy do <sha>
 *
 * Por que aqui e não no script de deploy: lá, a recusa faria a api não subir —
 * trocar 14s de erro por api fora do ar. Aqui o erro aparece no commit/CI.
 */

const PASTA = join(__dirname, '..', '..', 'prisma', 'migrations');

/**
 * Já aplicadas antes desta regra existir. Lista FECHADA: migration aplicada não
 * pode ser editada (o Prisma confere o checksum e o deploy seguinte quebra), então
 * o comentário não dá pra pôr nelas. Migration NOVA nunca entra aqui — ela leva
 * o comentário `-- drop-seguro:`.
 */
const HISTORICAS = new Set([
  '20260617120100_drop_bot_tokens_out',
  '20260617120300_drop_repcatalogo_markup',
  '20260809010000_drop_nps',
  '20260826120000_erp_neutro_omie_para_erp', // RENAME COLUMN (D50, OMIE → nomes neutros)
  '20260917210000_ritmo_texto_fixo_por_no',
  '20261006090000_vitrine_categorias',
]);

/** Comandos que fazem o container antigo pedir algo que deixou de existir. */
const DESTRUTIVOS: RegExp[] = [
  /\bDROP\s+COLUMN\b/i,
  /\bDROP\s+TABLE\b/i,
  /\bRENAME\s+COLUMN\b/i,
  // ALTER TABLE t RENAME TO x  (troca o nome da tabela)
  /\bALTER\s+TABLE\s+\S+\s+RENAME\s+TO\b/i,
  // ALTER TABLE t DROP "col" — Postgres aceita sem a palavra COLUMN
  /\bALTER\s+TABLE\s+\S+\s+DROP\s+(?!COLUMN\b|CONSTRAINT\b|DEFAULT\b|NOT\b|IDENTITY\b|EXPRESSION\b)"?\w/i,
];

// `[ \t]` e não `\s`: o motivo tem que estar NA MESMA linha — com `\s` o comentário
// vazio passava, pegando o comando da linha de baixo como se fosse o motivo.
const MARCA = /^[ \t]*--[ \t]*drop-seguro:[ \t]*\S+/im;

/** SQL sem os comentários de linha — "DROP" dentro de comentário não conta. */
function semComentarios(sql: string): string {
  return sql
    .split(/\r?\n/)
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');
}

export function violacoes(nome: string, sql: string): string[] {
  if (HISTORICAS.has(nome)) return [];
  const limpo = semComentarios(sql);
  const achados = DESTRUTIVOS.filter((re) => re.test(limpo)).map((re) => re.source);
  if (achados.length === 0 || MARCA.test(sql)) return [];
  return [`${nome}: comando destrutivo (${achados.join(' | ')}) sem "-- drop-seguro: <motivo>"`];
}

describe('migrations destrutivas exigem "-- drop-seguro:"', () => {
  it('nenhuma migration nova apaga/renomeia sem dizer por que é seguro', () => {
    const pastas = readdirSync(PASTA, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(PASTA, d.name, 'migration.sql')))
      .map((d) => d.name);
    expect(pastas.length).toBeGreaterThan(50); // achou a pasta certa

    const erros = pastas.flatMap((nome) =>
      violacoes(nome, readFileSync(join(PASTA, nome, 'migration.sql'), 'utf8')),
    );
    expect(erros).toEqual([]);
  });

  it('a lista de históricas é fechada: cada uma existe e de fato tem comando destrutivo', () => {
    for (const nome of HISTORICAS) {
      const sql = readFileSync(join(PASTA, nome, 'migration.sql'), 'utf8');
      expect(
        DESTRUTIVOS.some((re) => re.test(semComentarios(sql))),
        nome,
      ).toBe(true);
    }
  });
});

describe('a regra pega o que deve e solta o que não deve', () => {
  const nova = '20990101000000_teste';

  it.each([
    'ALTER TABLE "CatalogoModelo" DROP COLUMN "categoria";',
    'DROP TABLE "Nps";',
    'ALTER TABLE "Lead" RENAME COLUMN "nome" TO "nomeCompleto";',
    'ALTER TABLE "Lead" RENAME TO "Contato";',
    'ALTER TABLE "Lead" DROP "nome";',
  ])('pega: %s', (sql) => {
    expect(violacoes(nova, sql)).toHaveLength(1);
  });

  it.each([
    'ALTER TABLE "Lead" DROP CONSTRAINT "Lead_pkey";',
    'ALTER TABLE "Lead" ALTER COLUMN "nome" DROP NOT NULL;',
    'ALTER TABLE "Lead" ALTER COLUMN "nome" DROP DEFAULT;',
    'DROP INDEX "Lead_nome_idx";',
    'ALTER TABLE "Lead" ADD COLUMN "x" TEXT;',
    '-- DROP COLUMN "x" foi feito em outra migration',
  ])('solta: %s', (sql) => {
    expect(violacoes(nova, sql)).toEqual([]);
  });

  it('com o comentário de segurança, passa', () => {
    const sql =
      '-- drop-seguro: código parou de ler "categoria" no deploy do aae292b\n' +
      'ALTER TABLE "CatalogoModelo" DROP COLUMN "categoria";';
    expect(violacoes(nova, sql)).toEqual([]);
  });

  it('comentário vazio não vale', () => {
    const sql = '-- drop-seguro:\nALTER TABLE "CatalogoModelo" DROP COLUMN "categoria";';
    expect(violacoes(nova, sql)).toHaveLength(1);
  });
});
