import { describe, expect, it } from 'vitest';
import { ClickSignService } from './clicksign.service';

/**
 * O valor da variável chega com lixo mais vezes do que se imagina, e o efeito é
 * sempre o mesmo: 401 e contrato que não sai — falha invisível, porque nada
 * quebra na tela.
 *
 * O caso real (03/09): a instrução dizia `CLICKSIGN_ACCESS_TOKEN=<seu token>` e
 * o valor foi colado DENTRO dos sinais. 38 caracteres em vez de 36.
 */
const montar = (envs: Record<string, string>) =>
  new ClickSignService({ get: (k: string) => envs[k] } as never, {} as never) as unknown as {
    ler: (k: string) => string;
    configurado: boolean;
  };

describe('ClickSignService — leitura do ambiente', () => {
  const TOKEN = 'eafbdf20-05ef-43cc-a6ec-2b9de697d39d';

  it('tira os sinais <> do exemplo colados junto do valor', () => {
    expect(montar({ X: `<${TOKEN}>` }).ler('X')).toBe(TOKEN);
  });

  it('tira o nome da variável colado no valor', () => {
    expect(montar({ X: `CLICKSIGN_ACCESS_TOKEN=${TOKEN}` }).ler('X')).toBe(TOKEN);
  });

  it('tira aspas e espaço nas pontas', () => {
    expect(montar({ X: `  "${TOKEN}"  ` }).ler('X')).toBe(TOKEN);
  });

  it('valor limpo passa intacto', () => {
    expect(montar({ X: TOKEN }).ler('X')).toBe(TOKEN);
  });

  it('sem token e sem modelo, a integração se declara desligada', () => {
    expect(montar({}).configurado).toBe(false);
  });
});
