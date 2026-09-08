import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Nenhuma cor do PRODUTO cravada em tela.
 *
 * O app é white-label: quem entra pelo domínio de um tenant vê a marca dele. Cor
 * escrita em hex dentro de um componente escapa dessa regra em silêncio — a tela
 * abre, ninguém vê erro, e o representante da empresa X leva um roxo que não é
 * dela. Foi assim que sobraram o cartão do tour, o banner do PWA, o vidro da
 * tela de senha e a paleta de etiquetas depois do white-label ter "ficado
 * pronto".
 *
 * A regra: cor de marca vem de token (`var(--primary)`, `--secondary`,
 * `--magenta`, `--navy`) ou da `marca()`. Este teste varre o código e falha
 * apontando arquivo e linha.
 *
 * NÃO vale pra: cor de canal (WhatsApp, Instagram…), cor de dado escolhido por
 * gente (etiqueta já salva), semânticas (erro/sucesso) e as paletas neutras —
 * essas não são identidade de ninguém.
 */
const RAIZ = join(__dirname, '..');

/** Hex do brandbook do produto + os rgba() equivalentes. */
const CORES_DO_PRODUTO =
  /#201554|#2bcae5|#bd1fbf|#15093c|#5c88da|#a01aa1|#1ba8c0|#d33dd5|rgba\(\s*32,\s*21,\s*84|rgba\(\s*43,\s*202,\s*229|rgba\(\s*189,\s*31,\s*191/i;

/**
 * Onde a cor do produto PODE aparecer, e por quê:
 *  - `lib/marca.ts`: define o `MARCA_PADRAO` (o produto sem tenant vestido);
 *  - `components/styles.ts` e `index.css`: são a origem dos tokens;
 *  - `lib/canais-conteudo.ts`: cor de CANAL (blog, e-mail, carrossel), não de marca;
 *  - specs: descrevem o comportamento, inclusive este.
 */
const PERMITIDOS = [
  'lib/marca.ts',
  'components/styles.ts',
  'lib/canais-conteudo.ts',
];

function arquivosDeCodigo(dir: string, achados: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) {
      arquivosDeCodigo(caminho, achados);
    } else if (/\.(ts|tsx)$/.test(nome) && !/\.(spec|test)\.tsx?$/.test(nome)) {
      achados.push(caminho);
    }
  }
  return achados;
}

/** Comentário não pinta nada — citar o hex ao explicar a decisão é legítimo. */
const ehComentario = (linha: string) => /^\s*(\/\/|\*|\/\*)/.test(linha);

describe('white-label', () => {
  it('nenhuma tela pinta com a cor do produto cravada', () => {
    const vazamentos: string[] = [];

    for (const arquivo of arquivosDeCodigo(RAIZ)) {
      const rel = arquivo.slice(RAIZ.length + 1).replace(/\\/g, '/');
      if (PERMITIDOS.includes(rel)) continue;
      readFileSync(arquivo, 'utf8')
        .split('\n')
        .forEach((linha, i) => {
          if (CORES_DO_PRODUTO.test(linha) && !ehComentario(linha)) {
            vazamentos.push(`${rel}:${i + 1} → ${linha.trim().slice(0, 90)}`);
          }
        });
    }

    // A mensagem lista o que achou: quem quebrar o teste vê onde consertar.
    expect(vazamentos, `cor do produto cravada em:\n${vazamentos.join('\n')}`).toEqual([]);
  });
});
